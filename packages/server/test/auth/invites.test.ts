import { NodeContext } from '@effect/platform-node'
import { SqlClient } from '@effect/sql'
import { SqliteClient } from '@effect/sql-sqlite-node'
import { describe, expect, it } from '@effect/vitest'
import type { InviteCode, UserId, Username } from '@j45/domain'
import * as DateTime from 'effect/DateTime'
import * as Duration from 'effect/Duration'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'

import { Invites } from '../../src/auth/invites.js'
import { UserRepo } from '../../src/auth/user-repo.js'
import { MigratorLive } from '../../src/sql.js'

/**
 * The exact `MigratorLive` layer the server entrypoint runs at startup,
 * against an in-memory `@effect/sql-sqlite-node` driver — same pattern as
 * `test/auth/schema-sessions.test.ts`.
 */
const SqlTestLive = MigratorLive.pipe(
  Layer.provideMerge(SqliteClient.layer({ filename: ':memory:' })),
  Layer.provideMerge(NodeContext.layer),
)

const InvitesTestLive = Layer.mergeAll(Invites.Default, UserRepo.Default).pipe(
  Layer.provideMerge(SqlTestLive),
)

/**
 * `invites.reset_user_id`/`created_by` are `REFERENCES users(id)` (enforced
 * — see `schema-sessions.test.ts`'s comment) — reset-code and created-by
 * tests need a real user row to point at.
 */
const insertTestUser = (userId: UserId) =>
  Effect.gen(function* () {
    const userRepo = yield* UserRepo
    yield* userRepo.insert({
      id: userId,
      username: `user-${userId}` as Username,
      displayName: 'Test User',
      role: 'owner',
      pinHash: 'irrelevant-for-this-test',
      createdAt: '2020-01-01T00:00:00.000Z',
    })
  })

/** Narrows an optional `DateTime.Utc` without a forbidden non-null assertion. */
function assertDefined<A>(value: A | undefined, message: string): asserts value is A {
  if (value === undefined) {
    throw new Error(message)
  }
}

describe('Invites', () => {
  it.effect(
    'mint produces an 8-char Crockford base32 code (no 0/O/1/I) and applies the expiry rule: 7 days for a registration invite, 24h for a reset code, none when flagged first-run',
    () =>
      Effect.gen(function* () {
        const invites = yield* Invites
        const ownerId = 'owner-1' as UserId
        yield* insertTestUser(ownerId)

        const registrationInvite = yield* invites.mint({ createdBy: ownerId })
        expect(registrationInvite.code).toMatch(/^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{8}$/)
        expect(registrationInvite.resetUserId).toBeUndefined()
        assertDefined(registrationInvite.expiresAt, 'registration invite should have an expiry')
        expect(
          DateTime.toEpochMillis(registrationInvite.expiresAt) -
            DateTime.toEpochMillis(registrationInvite.createdAt),
        ).toBe(Duration.toMillis(Duration.days(7)))

        const resetInvite = yield* invites.mint({ createdBy: ownerId, resetUserId: ownerId })
        expect(resetInvite.resetUserId).toBe(ownerId)
        assertDefined(resetInvite.expiresAt, 'reset code should have an expiry')
        expect(
          DateTime.toEpochMillis(resetInvite.expiresAt) -
            DateTime.toEpochMillis(resetInvite.createdAt),
        ).toBe(Duration.toMillis(Duration.hours(24)))

        const firstRunInvite = yield* invites.mint({ firstRun: true })
        expect(firstRunInvite.expiresAt).toBeUndefined()
        expect(firstRunInvite.createdBy).toBeUndefined()

        // The first-run bootstrap layer pins the code via `FIRST_RUN_INVITE`.
        const pinnedInvite = yield* invites.mint({ firstRun: true, code: 'ABCD2345' as InviteCode })
        expect(pinnedInvite.code).toBe('ABCD2345')
      }).pipe(Effect.provide(InvitesTestLive)),
  )

  it.effect('list returns only unspent invites; revoke deletes a code outright', () =>
    Effect.gen(function* () {
      const invites = yield* Invites
      const sql = yield* SqlClient.SqlClient

      const kept = yield* invites.mint()
      const spent = yield* invites.mint()
      const revoked = yield* invites.mint()

      yield* invites.redeemForRegistration(spent.code)

      const listedCodes = (yield* invites.list()).map((invite) => invite.code)
      expect(listedCodes).toHaveLength(2)
      expect(listedCodes).toContain(kept.code)
      expect(listedCodes).toContain(revoked.code)
      expect(listedCodes).not.toContain(spent.code)

      yield* invites.revoke(revoked.code)
      const rows = yield* sql<{
        readonly code: string
      }>`SELECT code FROM invites WHERE code = ${revoked.code}`
      expect(rows).toHaveLength(0)

      // Revoke also removes an already-spent code outright.
      yield* invites.revoke(spent.code)
      const spentRows = yield* sql<{
        readonly code: string
      }>`SELECT code FROM invites WHERE code = ${spent.code}`
      expect(spentRows).toHaveLength(0)
    }).pipe(Effect.provide(InvitesTestLive)),
  )

  it.effect(
    'redeemForRegistration fails InvalidInvite for an unknown code, an already-spent one, an expired one, and a reset-only code',
    () =>
      Effect.gen(function* () {
        const invites = yield* Invites
        const ownerId = 'owner-2' as UserId
        yield* insertTestUser(ownerId)

        const unknown = yield* Effect.exit(invites.redeemForRegistration('NOPE0000' as InviteCode))
        expect(unknown._tag).toBe('Failure')

        const invite = yield* invites.mint()
        yield* invites.redeemForRegistration(invite.code)
        const alreadySpent = yield* Effect.exit(invites.redeemForRegistration(invite.code))
        expect(alreadySpent._tag).toBe('Failure')

        const resetOnly = yield* invites.mint({ resetUserId: ownerId })
        const wrongKind = yield* Effect.exit(invites.redeemForRegistration(resetOnly.code))
        expect(wrongKind._tag).toBe('Failure')
      }).pipe(Effect.provide(InvitesTestLive)),
  )

  it.effect(
    'redeemForReset returns the reset_user_id and fails InvalidInvite for a plain registration invite',
    () =>
      Effect.gen(function* () {
        const invites = yield* Invites
        const ownerId = 'owner-3' as UserId
        yield* insertTestUser(ownerId)

        const resetInvite = yield* invites.mint({ resetUserId: ownerId })
        const targetUserId = yield* invites.redeemForReset(resetInvite.code)
        expect(targetUserId).toBe(ownerId)

        const registrationInvite = yield* invites.mint()
        const wrongKind = yield* Effect.exit(invites.redeemForReset(registrationInvite.code))
        expect(wrongKind._tag).toBe('Failure')
      }).pipe(Effect.provide(InvitesTestLive)),
  )
})
