import { SqlClient } from '@effect/sql'
import {
  type InviteCode,
  type Pin,
  User,
  type UserId,
  type Username,
  UsernameTaken,
} from '@j45/domain'
import type * as Context from 'effect/Context'
import * as DateTime from 'effect/DateTime'
import * as Effect from 'effect/Effect'
import * as Option from 'effect/Option'
import { randomUUID } from 'node:crypto'

import { AuthSessions } from './auth-sessions.js'
import { PinHashing } from './hashing.js'
import { Invites } from './invites.js'
import { UserRepo, type UserRole } from './user-repo.js'

export type RegisterInput = {
  readonly code: InviteCode
  readonly username: Username
  readonly displayName: string
  readonly pin: Pin
}

export type ResetInput = {
  readonly code: InviteCode
  readonly newPin: Pin
}

/** What `register`/`reset` hand back — the http-routes task turns `token` into a `Set-Cookie`. */
export type AuthResult = {
  readonly user: User
  readonly token: string
}

/** The services `register`/`reset` compose, grouped into one param (`max-params`). */
type AccountServices = {
  readonly sql: SqlClient.SqlClient
  readonly invites: Invites
  readonly userRepo: UserRepo
  readonly authSessions: AuthSessions
  readonly pinHashing: Context.Tag.Service<typeof PinHashing>
}

/**
 * Redeems a registration invite and creates the account it grants, all in
 * one `sql.withTransaction`. The first user ever created (an empty `users`
 * table at the moment this transaction runs) becomes `owner`; every later
 * one `member`. Fails `InvalidInvite` (from `invites.redeemForRegistration`)
 * for a spent/unknown/expired/reset-only code, and `UsernameTaken` for a
 * name collision — either failure rolls back the whole transaction, so a
 * rejected attempt spends nothing and creates no user row.
 */
const register = (services: AccountServices, input: RegisterInput) => {
  const { sql, invites, userRepo, authSessions, pinHashing } = services
  return sql.withTransaction(
    Effect.gen(function* () {
      yield* invites.redeemForRegistration(input.code)

      const existing = yield* userRepo.findByUsername(input.username)
      if (Option.isSome(existing)) {
        return yield* Effect.fail(new UsernameTaken())
      }

      const totalUsers = yield* userRepo.count()
      const role: UserRole = totalUsers === 0 ? 'owner' : 'member'

      const now = yield* DateTime.now
      const pinHash = yield* pinHashing.hash(input.pin)
      const userId = randomUUID() as UserId

      yield* userRepo.insert({
        id: userId,
        username: input.username,
        displayName: input.displayName,
        role,
        pinHash,
        createdAt: DateTime.formatIso(now),
      })

      const token = yield* authSessions.create(userId)

      const result: AuthResult = {
        user: new User({
          id: userId,
          username: input.username,
          displayName: input.displayName,
          role,
        }),
        token,
      }
      return result
    }),
  )
}

/**
 * Redeems a reset code, sets the target user's new PIN, revokes every
 * existing session for that user (a stolen old cookie stops working the
 * instant the PIN resets), and mints a fresh session — all in one
 * `sql.withTransaction`. Fails `InvalidInvite` (from
 * `invites.redeemForReset`) for an unknown/spent/expired code or a plain
 * registration invite.
 */
const reset = (services: AccountServices, input: ResetInput) => {
  const { sql, invites, userRepo, authSessions, pinHashing } = services
  return sql.withTransaction(
    Effect.gen(function* () {
      const userId = yield* invites.redeemForReset(input.code)

      const userOption = yield* userRepo.findById(userId)
      const user = yield* Option.match(userOption, {
        onNone: () =>
          Effect.dieMessage(`Accounts.reset: reset_user_id ${userId} references a missing user`),
        onSome: Effect.succeed,
      })

      const pinHash = yield* pinHashing.hash(input.newPin)
      yield* sql`UPDATE users SET pin_hash = ${pinHash} WHERE id = ${userId}`
      yield* authSessions.revokeAllForUser(userId)

      const token = yield* authSessions.create(userId)

      const result: AuthResult = {
        user: new User({
          id: user.id,
          username: user.username,
          displayName: user.displayName,
          role: user.role,
        }),
        token,
      }
      return result
    }),
  )
}

/**
 * The two transactional account operations the design pins to a single
 * `sql.withTransaction` boundary each: `register` (spend invite + insert
 * user + insert session) and `reset` (spend reset code + update pin_hash +
 * revoke every session + insert a fresh one). Composes `Invites`,
 * `UserRepo`, and `AuthSessions` — all through the generic
 * `SqlClient.SqlClient` tag — plus `PinHashing` for the plaintext PIN.
 */
export class Accounts extends Effect.Service<Accounts>()('Accounts', {
  effect: Effect.gen(function* () {
    const services: AccountServices = {
      sql: yield* SqlClient.SqlClient,
      invites: yield* Invites,
      userRepo: yield* UserRepo,
      authSessions: yield* AuthSessions,
      pinHashing: yield* PinHashing,
    }

    return {
      register: (input: RegisterInput) => register(services, input),
      reset: (input: ResetInput) => reset(services, input),
    } as const
  }),
}) {}
