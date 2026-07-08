import { randomInt } from 'node:crypto'

import { SqlClient } from '@effect/sql'
import { InvalidInvite, Invite, type InviteCode, type UserId } from '@j45/domain'
import * as DateTime from 'effect/DateTime'
import * as Duration from 'effect/Duration'
import * as Effect from 'effect/Effect'
import * as Option from 'effect/Option'

/**
 * Crockford base32 minus the four characters the design calls out as
 * visually ambiguous (`0`/`O`, `1`/`I`) — 36 alphanumerics less those four
 * leaves exactly 32 symbols, so an 8-char code drawn from this alphabet is
 * a genuine base32 code.
 */
const INVITE_CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'
const INVITE_CODE_LENGTH = 8

const generateInviteCode = (): string =>
  Array.from(
    { length: INVITE_CODE_LENGTH },
    () => INVITE_CODE_ALPHABET[randomInt(INVITE_CODE_ALPHABET.length)],
  ).join('')

/** Registration invites expire in 7 days; reset codes (`reset_user_id` set) in 24h. */
const REGISTRATION_INVITE_LIFETIME: Duration.Duration = Duration.days(7)
const RESET_CODE_LIFETIME: Duration.Duration = Duration.hours(24)

type InviteTableRow = {
  readonly code: string
  readonly reset_user_id: string | null
  readonly created_by: string | null
  readonly created_at: string
  readonly expires_at: string | null
  readonly used_by: string | null
  readonly used_at: string | null
}

const toInvite = (row: InviteTableRow): Invite =>
  new Invite({
    code: row.code as InviteCode,
    resetUserId: row.reset_user_id === null ? undefined : (row.reset_user_id as UserId),
    createdBy: row.created_by === null ? undefined : (row.created_by as UserId),
    createdAt: DateTime.unsafeMake(row.created_at),
    expiresAt: row.expires_at === null ? undefined : DateTime.unsafeMake(row.expires_at),
  })

/**
 * What `mint` is minting: a plain registration invite (both fields unset),
 * a reset code (`resetUserId` set — its expiry is 24h regardless of
 * `firstRun`), or the first-run bootstrap invite (`firstRun: true` — never
 * expires; `code` lets the bootstrap layer honor `FIRST_RUN_INVITE`).
 */
export type MintInviteInput = {
  readonly createdBy?: UserId
  readonly resetUserId?: UserId
  readonly firstRun?: boolean
  readonly code?: InviteCode
}

/** Mints a fresh invite/reset code, applying the expiry rule documented on `MintInviteInput`. */
const mint = (sql: SqlClient.SqlClient, input: MintInviteInput = {}) =>
  Effect.gen(function* () {
    const now = yield* DateTime.now
    const code = input.code ?? (generateInviteCode() as InviteCode)
    const expiresAt = input.firstRun
      ? Option.none<DateTime.Utc>()
      : Option.some(
          DateTime.addDuration(
            now,
            input.resetUserId === undefined ? REGISTRATION_INVITE_LIFETIME : RESET_CODE_LIFETIME,
          ),
        )

    yield* sql`INSERT INTO invites ${sql.insert({
      code,
      reset_user_id: input.resetUserId ?? null,
      created_by: input.createdBy ?? null,
      created_at: DateTime.formatIso(now),
      expires_at: Option.match(expiresAt, { onNone: () => null, onSome: DateTime.formatIso }),
      used_by: null,
      used_at: null,
    })}`

    return new Invite({
      code,
      resetUserId: input.resetUserId,
      createdBy: input.createdBy,
      createdAt: now,
      expiresAt: Option.getOrUndefined(expiresAt),
    })
  })

/** Every unspent (`used_at IS NULL`) invite/reset code, oldest first. */
const list = (sql: SqlClient.SqlClient) =>
  sql<InviteTableRow>`SELECT * FROM invites WHERE used_at IS NULL ORDER BY created_at`.pipe(
    Effect.map((rows) => rows.map(toInvite)),
  )

/** Deletes a code outright — spent or not. */
const revoke = (sql: SqlClient.SqlClient, code: InviteCode) =>
  sql`DELETE FROM invites WHERE code = ${code}`.pipe(Effect.asVoid)

/**
 * Atomically marks a registration invite as spent — fails `InvalidInvite`
 * for an unknown code, one already spent, an expired one, or a reset code
 * (`reset_user_id` set, not redeemable this way). The `RETURNING *` clause
 * is what makes this atomic: the `WHERE` guard and the write happen in the
 * same statement, so two concurrent redemptions of the same code can't
 * both see it as spendable.
 */
const redeemForRegistration = (sql: SqlClient.SqlClient, code: InviteCode) =>
  Effect.gen(function* () {
    const nowIso = DateTime.formatIso(yield* DateTime.now)
    const rows = yield* sql<InviteTableRow>`
      UPDATE invites
      SET used_at = ${nowIso}
      WHERE code = ${code}
        AND used_at IS NULL
        AND reset_user_id IS NULL
        AND (expires_at IS NULL OR expires_at > ${nowIso})
      RETURNING *
    `
    if (rows.length === 0) {
      return yield* Effect.fail(new InvalidInvite())
    }
  })

/**
 * Atomically marks a reset code as spent and returns the `UserId` it
 * targets — fails `InvalidInvite` for an unknown/spent/expired code or a
 * plain registration invite (`reset_user_id` unset). `used_by` is set to
 * `reset_user_id` in the same statement (that user already exists, unlike
 * a brand-new registration, so the `users` foreign key is satisfied
 * immediately).
 */
const redeemForReset = (sql: SqlClient.SqlClient, code: InviteCode) =>
  Effect.gen(function* () {
    const nowIso = DateTime.formatIso(yield* DateTime.now)
    const rows = yield* sql<InviteTableRow>`
      UPDATE invites
      SET used_at = ${nowIso}, used_by = reset_user_id
      WHERE code = ${code}
        AND used_at IS NULL
        AND reset_user_id IS NOT NULL
        AND (expires_at IS NULL OR expires_at > ${nowIso})
      RETURNING *
    `
    const row = rows[0]
    if (row === undefined) {
      return yield* Effect.fail(new InvalidInvite())
    }
    if (row.reset_user_id === null) {
      return yield* Effect.fail(new InvalidInvite())
    }
    return row.reset_user_id as UserId
  })

/**
 * Persistence and lifecycle for the `invites` table (migration `0002_auth`)
 * — minting, listing unspent codes, revoking, and the two atomic
 * redemption paths `register`/`reset` (`accounts.ts`) call inside their own
 * `sql.withTransaction` boundary. Depends only on the generic
 * `SqlClient.SqlClient` tag.
 */
export class Invites extends Effect.Service<Invites>()('Invites', {
  effect: Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient

    return {
      mint: (input?: MintInviteInput) => mint(sql, input),
      list: () => list(sql),
      revoke: (code: InviteCode) => revoke(sql, code),
      redeemForRegistration: (code: InviteCode) => redeemForRegistration(sql, code),
      redeemForReset: (code: InviteCode) => redeemForReset(sql, code),
    } as const
  }),
}) {}
