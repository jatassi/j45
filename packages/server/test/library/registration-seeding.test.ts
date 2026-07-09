import { NodeContext } from '@effect/platform-node'
import { SqliteClient } from '@effect/sql-sqlite-node'
import { describe, expect, it } from '@effect/vitest'
import type { InviteCode, Pin, Username } from '@j45/domain'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'

import { Accounts } from '../../src/auth/accounts.js'
import { AuthSessions } from '../../src/auth/auth-sessions.js'
import { PinHashing } from '../../src/auth/hashing.js'
import { Invites } from '../../src/auth/invites.js'
import { UserRepo } from '../../src/auth/user-repo.js'
import { ExercisesRepo } from '../../src/library/exercises-repo.js'
import { seedExercises } from '../../src/library/seed-exercises.js'
import { WorkoutsRepo } from '../../src/library/workouts-repo.js'
import { MigratorLive } from '../../src/sql.js'

/**
 * The exact `MigratorLive` layer the server entrypoint runs at startup —
 * every migration including `0003_library` and `0004_exercises` — against
 * an in-memory `@effect/sql-sqlite-node` driver, so these tests exercise
 * `register` against a genuinely fresh, fully-migrated database, same
 * pattern as `test/auth/accounts.test.ts` and
 * `test/library/migration-0003.test.ts`.
 */
const SqlTestLive = MigratorLive.pipe(
  Layer.provideMerge(SqliteClient.layer({ filename: ':memory:' })),
  Layer.provideMerge(NodeContext.layer),
)

/**
 * A fast reversible stand-in for the real `Bun.password`-backed
 * `PinHashing` — same rationale as `accounts.test.ts`'s `TestPinHashing`:
 * these tests are about registration's seeded library, not the hashing
 * algorithm.
 */
const TestPinHashing = Layer.succeed(PinHashing, {
  hash: (pin) => Effect.succeed(`hashed:${pin}`),
  verify: (pin, hash) => Effect.succeed(hash === `hashed:${pin}`),
})

const SharedServicesLive = Layer.mergeAll(
  Invites.Default,
  UserRepo.Default,
  AuthSessions.Default,
  WorkoutsRepo.Default,
  ExercisesRepo.Default,
).pipe(Layer.provideMerge(SqlTestLive))

const AccountsTestLive = Accounts.Default.pipe(
  Layer.provideMerge(SharedServicesLive),
  Layer.provideMerge(TestPinHashing),
)

const asUsername = (value: string) => value as Username
const asPin = (value: string) => value as Pin

/** The 12 legacy F45 workout names, exactly as `docs/designs/plan-library/design.md` names them. */
const EXPECTED_SEED_NAMES = [
  'Athletica',
  'Romans',
  'Miami Nights',
  'Panthers',
  'Docklands',
  'Red Diamond',
  'Crossfire',
  'Hammer',
  'Pipeline',
  'Medusa',
  'SoCal',
  'Apex',
]

const EXPECTED_EXERCISE_COUNT = seedExercises.length

describe('registration seeding', () => {
  it.effect(
    'register creates exactly 12 workouts and the full seed exercise catalog owned by the new user; a failed registration (UsernameTaken or unknown invite) rolls back — no user row, no workouts, no exercises',
    () =>
      Effect.gen(function* () {
        const invites = yield* Invites
        const userRepo = yield* UserRepo
        const workoutsRepo = yield* WorkoutsRepo
        const exercisesRepo = yield* ExercisesRepo
        const accounts = yield* Accounts

        // Unknown invite fails before any writes — zero users, zero library rows.
        const unknownAttempt = yield* Effect.exit(
          accounts.register({
            code: 'UNKN0WN2' as InviteCode,
            username: asUsername('ghost'),
            displayName: 'Ghost',
            pin: asPin('0000'),
          }),
        )
        expect(unknownAttempt._tag).toBe('Failure')
        expect(yield* userRepo.count()).toBe(0)

        const invite = yield* invites.mint()
        const registered = yield* accounts.register({
          code: invite.code,
          username: asUsername('alice'),
          displayName: 'Alice',
          pin: asPin('1234'),
        })

        const library = yield* workoutsRepo.listForOwner(registered.user.id)
        expect(library).toHaveLength(12)
        expect(new Set(library.map((entry) => entry.id)).size).toBe(12)
        expect(new Set(library.map((entry) => entry.workout.name))).toStrictEqual(
          new Set(EXPECTED_SEED_NAMES),
        )

        const exerciseCatalog = yield* exercisesRepo.listForOwner(registered.user.id)
        expect(exerciseCatalog).toHaveLength(EXPECTED_EXERCISE_COUNT)
        expect(new Set(exerciseCatalog.map((entry) => entry.id)).size).toBe(EXPECTED_EXERCISE_COUNT)

        // A second attempt at the same username fails UsernameTaken and rolls
        // back the whole transaction — no second user row, no extra workouts,
        // no extra exercises (still exactly the first user's catalogs).
        const secondInvite = yield* invites.mint()
        const collision = yield* Effect.exit(
          accounts.register({
            code: secondInvite.code,
            username: asUsername('alice'),
            displayName: 'Impostor',
            pin: asPin('9999'),
          }),
        )
        expect(collision._tag).toBe('Failure')
        expect(yield* userRepo.count()).toBe(1)

        const libraryAfterFailure = yield* workoutsRepo.listForOwner(registered.user.id)
        expect(libraryAfterFailure).toHaveLength(12)

        const exercisesAfterFailure = yield* exercisesRepo.listForOwner(registered.user.id)
        expect(exercisesAfterFailure).toHaveLength(EXPECTED_EXERCISE_COUNT)
      }).pipe(Effect.provide(AccountsTestLive)),
  )

  it.effect(
    'two registrations each get their own 12-workout library and exercise catalog with distinct ids; deleting a workout or exercise from one leaves the other’s catalogs untouched',
    () =>
      Effect.gen(function* () {
        const invites = yield* Invites
        const workoutsRepo = yield* WorkoutsRepo
        const exercisesRepo = yield* ExercisesRepo
        const accounts = yield* Accounts

        const firstInvite = yield* invites.mint()
        const first = yield* accounts.register({
          code: firstInvite.code,
          username: asUsername('alice'),
          displayName: 'Alice',
          pin: asPin('1111'),
        })

        const secondInvite = yield* invites.mint()
        const second = yield* accounts.register({
          code: secondInvite.code,
          username: asUsername('bob'),
          displayName: 'Bob',
          pin: asPin('2222'),
        })

        const firstLibrary = yield* workoutsRepo.listForOwner(first.user.id)
        const secondLibrary = yield* workoutsRepo.listForOwner(second.user.id)
        expect(firstLibrary).toHaveLength(12)
        expect(secondLibrary).toHaveLength(12)

        const firstIds = new Set(firstLibrary.map((entry) => entry.id))
        const secondIds = new Set(secondLibrary.map((entry) => entry.id))
        expect(firstIds.size).toBe(12)
        expect(secondIds.size).toBe(12)
        for (const id of firstIds) {
          expect(secondIds.has(id)).toBe(false)
        }

        const firstExercises = yield* exercisesRepo.listForOwner(first.user.id)
        const secondExercises = yield* exercisesRepo.listForOwner(second.user.id)
        expect(firstExercises).toHaveLength(EXPECTED_EXERCISE_COUNT)
        expect(secondExercises).toHaveLength(EXPECTED_EXERCISE_COUNT)

        const firstExerciseIds = new Set(firstExercises.map((entry) => entry.id))
        const secondExerciseIds = new Set(secondExercises.map((entry) => entry.id))
        expect(firstExerciseIds.size).toBe(EXPECTED_EXERCISE_COUNT)
        expect(secondExerciseIds.size).toBe(EXPECTED_EXERCISE_COUNT)
        for (const id of firstExerciseIds) {
          expect(secondExerciseIds.has(id)).toBe(false)
        }

        const toDeleteWorkout = firstLibrary[0]
        if (toDeleteWorkout === undefined) {
          throw new Error('expected a workout to delete')
        }
        yield* workoutsRepo.delete(toDeleteWorkout.id, first.user.id)

        const firstLibraryAfterDelete = yield* workoutsRepo.listForOwner(first.user.id)
        expect(firstLibraryAfterDelete).toHaveLength(11)

        const secondLibraryAfterDelete = yield* workoutsRepo.listForOwner(second.user.id)
        expect(secondLibraryAfterDelete).toHaveLength(12)
        expect(new Set(secondLibraryAfterDelete.map((entry) => entry.id))).toStrictEqual(secondIds)

        const toDeleteExercise = firstExercises[0]
        if (toDeleteExercise === undefined) {
          throw new Error('expected an exercise to delete')
        }
        yield* exercisesRepo.delete(toDeleteExercise.id, first.user.id)

        const firstExercisesAfterDelete = yield* exercisesRepo.listForOwner(first.user.id)
        expect(firstExercisesAfterDelete).toHaveLength(EXPECTED_EXERCISE_COUNT - 1)

        const secondExercisesAfterDelete = yield* exercisesRepo.listForOwner(second.user.id)
        expect(secondExercisesAfterDelete).toHaveLength(EXPECTED_EXERCISE_COUNT)
        expect(new Set(secondExercisesAfterDelete.map((entry) => entry.id))).toStrictEqual(
          secondExerciseIds,
        )
      }).pipe(Effect.provide(AccountsTestLive)),
  )
})
