import { NodeContext } from '@effect/platform-node'
import { SqliteClient } from '@effect/sql-sqlite-node'
import { describe, expect, it } from '@effect/vitest'
import type { InviteCode, Pin, Username } from '@j45/domain'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import * as Option from 'effect/Option'

import { Accounts } from '../../src/auth/accounts.js'
import { AuthSessions } from '../../src/auth/auth-sessions.js'
import { PinHashing } from '../../src/auth/hashing.js'
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

/**
 * `PinHashing`'s only real implementation is `Bun.password`-backed
 * (`hashing.ts`'s `PinHashingLive`), which only runs under a genuine Bun
 * process — `schema-sessions.test.ts` covers that seam by spawning `bun
 * run`. These tests are about the transactional register/reset *logic*
 * (role assignment, invite spending, session revocation), not the hashing
 * algorithm itself, so a fast reversible stand-in is provided here at
 * test-time only; `Accounts` itself only ever sees the `PinHashing`
 * `Context.Tag` and has no idea which layer is behind it.
 */
const TestPinHashing = Layer.succeed(PinHashing, {
  hash: (pin) => Effect.succeed(`hashed:${pin}`),
  verify: (pin, hash) => Effect.succeed(hash === `hashed:${pin}`),
})

/**
 * `Invites`/`UserRepo`/`AuthSessions` each depend only on `SqlClient` — this
 * merges the three against one shared in-memory database, mirroring
 * `AuthTestLive` in `schema-sessions.test.ts`.
 */
const SharedServicesLive = Layer.mergeAll(
  Invites.Default,
  UserRepo.Default,
  AuthSessions.Default,
).pipe(Layer.provideMerge(SqlTestLive))

/**
 * `Accounts` depends on all three services above plus `PinHashing`;
 * `provideMerge` (not a plain `mergeAll`) is what actually wires those
 * dependencies into `Accounts.Default` rather than merely running the
 * layers in parallel — the tests below also `yield*` `Invites`,
 * `UserRepo`, `AuthSessions`, and `PinHashing` directly, so all of their
 * outputs stay in the final context too.
 */
const AccountsTestLive = Accounts.Default.pipe(
  Layer.provideMerge(SharedServicesLive),
  Layer.provideMerge(TestPinHashing),
)

const asUsername = (value: string) => value as Username
const asPin = (value: string) => value as Pin

describe('Accounts.register', () => {
  it.effect(
    'fails InvalidInvite for an unknown or already-spent code, creating no user row either time (a second redemption of the same code also fails)',
    () =>
      Effect.gen(function* () {
        const invites = yield* Invites
        const userRepo = yield* UserRepo
        const accounts = yield* Accounts

        const unknownAttempt = yield* Effect.exit(
          accounts.register({
            code: 'UNKN0WN2' as InviteCode,
            username: asUsername('alice'),
            displayName: 'Alice',
            pin: asPin('1234'),
          }),
        )
        expect(unknownAttempt._tag).toBe('Failure')
        expect(yield* userRepo.count()).toBe(0)

        const invite = yield* invites.mint()
        const firstAttempt = yield* accounts.register({
          code: invite.code,
          username: asUsername('alice'),
          displayName: 'Alice',
          pin: asPin('1234'),
        })
        expect(firstAttempt.user.username).toBe('alice')
        expect(yield* userRepo.count()).toBe(1)

        // The invite is already spent — a second redemption fails and creates no second user.
        const secondAttempt = yield* Effect.exit(
          accounts.register({
            code: invite.code,
            username: asUsername('bob'),
            displayName: 'Bob',
            pin: asPin('5678'),
          }),
        )
        expect(secondAttempt._tag).toBe('Failure')
        expect(yield* userRepo.count()).toBe(1)
      }).pipe(Effect.provide(AccountsTestLive)),
  )

  it.effect(
    'the first user ever registered gets role owner, every later one gets role member; a taken username fails UsernameTaken and rolls back the whole transaction',
    () =>
      Effect.gen(function* () {
        const invites = yield* Invites
        const userRepo = yield* UserRepo
        const accounts = yield* Accounts

        const firstInvite = yield* invites.mint()
        const owner = yield* accounts.register({
          code: firstInvite.code,
          username: asUsername('alice'),
          displayName: 'Alice',
          pin: asPin('1111'),
        })
        expect(owner.user.role).toBe('owner')

        const secondInvite = yield* invites.mint()
        const member = yield* accounts.register({
          code: secondInvite.code,
          username: asUsername('bob'),
          displayName: 'Bob',
          pin: asPin('2222'),
        })
        expect(member.user.role).toBe('member')

        const thirdInvite = yield* invites.mint()
        // COLLATE NOCASE — "Alice" collides with the already-registered "alice".
        const collision = yield* Effect.exit(
          accounts.register({
            code: thirdInvite.code,
            username: asUsername('Alice'),
            displayName: 'Impostor',
            pin: asPin('3333'),
          }),
        )
        expect(collision._tag).toBe('Failure')

        // Rolled back in full: still exactly two users, and the invite the
        // failed attempt tried to spend is still unspent (usable again).
        expect(yield* userRepo.count()).toBe(2)
        const unspent = yield* invites.list()
        expect(unspent.map((i) => i.code)).toContain(thirdInvite.code)
      }).pipe(Effect.provide(AccountsTestLive)),
  )
})

describe('Accounts.reset', () => {
  it.effect(
    'validates the reset code, sets the new pin_hash, revokes every existing session, spends the code, and returns a fresh working session (the old PIN no longer verifies and old sessions are gone)',
    () =>
      Effect.gen(function* () {
        const invites = yield* Invites
        const accounts = yield* Accounts
        const authSessions = yield* AuthSessions
        const pinHashing = yield* PinHashing
        const userRepo = yield* UserRepo

        const registrationInvite = yield* invites.mint()
        const registered = yield* accounts.register({
          code: registrationInvite.code,
          username: asUsername('carol'),
          displayName: 'Carol',
          pin: asPin('1234'),
        })
        const oldToken = registered.token

        // A second, independent session for the same user — "revokes all"
        // must remove this one too, not just the one from registration.
        const extraToken = yield* authSessions.create(registered.user.id)

        const resetInvite = yield* invites.mint({ resetUserId: registered.user.id })
        const resetResult = yield* accounts.reset({ code: resetInvite.code, newPin: asPin('9999') })

        expect(resetResult.user.id).toBe(registered.user.id)

        // Old sessions are gone.
        expect(Option.isNone(yield* authSessions.lookupAndTouch(oldToken))).toBe(true)
        expect(Option.isNone(yield* authSessions.lookupAndTouch(extraToken))).toBe(true)

        // The fresh session works.
        const loggedInUserId = yield* authSessions.lookupAndTouch(resetResult.token)
        expect(Option.getOrNull(loggedInUserId)).toBe(registered.user.id)

        // The old PIN no longer verifies; the new one does.
        const userRow = yield* userRepo.findById(registered.user.id)
        const storedHash = Option.getOrThrow(userRow).pinHash
        expect(yield* pinHashing.verify('1234', storedHash)).toBe(false)
        expect(yield* pinHashing.verify('9999', storedHash)).toBe(true)

        // The reset code is spent — redeeming it again fails.
        const secondReset = yield* Effect.exit(
          accounts.reset({ code: resetInvite.code, newPin: asPin('0000') }),
        )
        expect(secondReset._tag).toBe('Failure')
      }).pipe(Effect.provide(AccountsTestLive)),
  )
})
