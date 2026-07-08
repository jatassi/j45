import { SqlClient } from '@effect/sql'
import type { UserId } from '@j45/domain'
import * as DateTime from 'effect/DateTime'
import * as Duration from 'effect/Duration'
import * as Effect from 'effect/Effect'
import * as Option from 'effect/Option'
import { createHash, randomBytes } from 'node:crypto'

/**
 * The session cookie's lifetime — also the `Max-Age` `cookie.ts` renders,
 * so the browser's cookie and the `auth_sessions` row expire together.
 */
export const SESSION_LIFETIME: Duration.Duration = Duration.days(365)

const sha256Hex = (value: string): string => createHash('sha256').update(value).digest('hex')

type AuthSessionRow = {
  readonly token_hash: string
  readonly user_id: string
  readonly created_at: string
  readonly expires_at: string
}

/**
 * Persistence and token lifecycle for the `auth_sessions` table (migration
 * `0002_auth`). The raw session token — 32 random bytes, base64url — is
 * returned to the caller exactly once, from `create`; only its SHA-256
 * digest is ever written to or read from the row, so a leaked database
 * dump cannot be replayed as a cookie. Depends only on the generic
 * `SqlClient.SqlClient` tag; all timestamps come from Effect `DateTime.now`
 * (backed by `Clock`), never `new Date()`, so `TestClock` drives expiry.
 */
export class AuthSessions extends Effect.Service<AuthSessions>()('AuthSessions', {
  effect: Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient

    /** Mints a fresh session for `userId`, returning the raw cookie token. */
    const create = (userId: UserId) =>
      Effect.gen(function* () {
        const token = randomBytes(32).toString('base64url')
        const now = yield* DateTime.now
        const expiresAt = DateTime.addDuration(now, SESSION_LIFETIME)

        yield* sql`INSERT INTO auth_sessions ${sql.insert({
          token_hash: sha256Hex(token),
          user_id: userId,
          created_at: DateTime.formatIso(now),
          expires_at: DateTime.formatIso(expiresAt),
        })}`

        return token
      })

    /**
     * Hashes the raw token and looks up its row, returning the owning
     * user's id — `Option.none()` for an unknown token or one whose
     * `expires_at` has passed (an expired row is never resurrected).
     */
    const lookupAndTouch = (token: string) =>
      Effect.gen(function* () {
        const rows = yield* sql<AuthSessionRow>`
          SELECT * FROM auth_sessions WHERE token_hash = ${sha256Hex(token)}
        `
        const row = rows[0]
        if (row === undefined) {
          return Option.none<UserId>()
        }

        const now = yield* DateTime.now
        const expiresAt = DateTime.unsafeMake(row.expires_at)
        if (DateTime.lessThanOrEqualTo(expiresAt, now)) {
          return Option.none<UserId>()
        }

        return Option.some(row.user_id as UserId)
      })

    /** Deletes every session belonging to `userId` (used by PIN reset). */
    const revokeAllForUser = (userId: UserId) =>
      sql`DELETE FROM auth_sessions WHERE user_id = ${userId}`.pipe(Effect.asVoid)

    /** Deletes the single session for `token` (used by logout). */
    const deleteSession = (token: string) =>
      sql`DELETE FROM auth_sessions WHERE token_hash = ${sha256Hex(token)}`.pipe(Effect.asVoid)

    return {
      create,
      lookupAndTouch,
      revokeAllForUser,
      delete: deleteSession,
    } as const
  }),
}) {}
