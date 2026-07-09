import { NodeContext } from '@effect/platform-node'
import { SqliteClient } from '@effect/sql-sqlite-node'
import { describe, expect, it } from '@effect/vitest'
import { Flow, Pod, Round, Station, Workout, type UserId, type Username } from '@j45/domain'
import * as DateTime from 'effect/DateTime'
import * as Duration from 'effect/Duration'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import * as TestClock from 'effect/TestClock'

import { UserRepo } from '../../src/auth/user-repo.js'
import { WorkoutsRepo } from '../../src/library/workouts-repo.js'
import { MigratorLive } from '../../src/sql.js'

/**
 * The exact `MigratorLive` layer the server entrypoint runs at startup,
 * against an in-memory `@effect/sql-sqlite-node` driver — same pattern as
 * `test/auth/accounts.test.ts`.
 */
const SqlTestLive = MigratorLive.pipe(
  Layer.provideMerge(SqliteClient.layer({ filename: ':memory:' })),
  Layer.provideMerge(NodeContext.layer),
)

/** `workouts.owner_id REFERENCES users(id)` — `UserRepo` seeds the owner rows these tests attach workouts to. */
const WorkoutsRepoTestLive = Layer.mergeAll(UserRepo.Default, WorkoutsRepo.Default).pipe(
  Layer.provideMerge(SqlTestLive),
)

const makeWorkout = (name: string) =>
  new Workout({
    name,
    focus: 'cardio',
    pods: [new Pod({ name: 'Pod 1', stations: [new Station({ name: 'Rower' })] })],
    flow: new Flow({ type: 'laps', rounds: [new Round({ workSeconds: 40, restSeconds: 20 })] }),
  })

const insertOwner = (id: UserId) =>
  Effect.gen(function* () {
    const userRepo = yield* UserRepo
    yield* userRepo.insert({
      id,
      username: `${id}-username` as Username,
      displayName: 'Test Owner',
      role: 'member',
      pinHash: 'irrelevant-for-this-test',
      createdAt: '2020-01-01T00:00:00.000Z',
    })
  })

describe('WorkoutsRepo', () => {
  it.effect(
    'duplicate inserts a caller-owned copy named with suffix " (copy)" and a fresh id/timestamps; rename rewrites body.name and bumps updated_at without touching created_at',
    () =>
      Effect.gen(function* () {
        const workoutsRepo = yield* WorkoutsRepo
        const ownerId = 'owner-1' as UserId
        yield* insertOwner(ownerId)

        const original = yield* workoutsRepo.insert(ownerId, makeWorkout('Athletica'))

        yield* TestClock.adjust(Duration.seconds(5))

        const copy = yield* workoutsRepo.duplicate(original.id, ownerId)
        expect(copy.id).not.toBe(original.id)
        expect(copy.workout.name).toBe('Athletica (copy)')
        expect(DateTime.toEpochMillis(copy.createdAt)).not.toBe(
          DateTime.toEpochMillis(original.createdAt),
        )
        expect(DateTime.toEpochMillis(copy.updatedAt)).toBe(DateTime.toEpochMillis(copy.createdAt))

        yield* TestClock.adjust(Duration.seconds(5))

        const renamed = yield* workoutsRepo.rename(original.id, ownerId, 'Athletica Renamed')
        expect(renamed.workout.name).toBe('Athletica Renamed')
        expect(DateTime.toEpochMillis(renamed.createdAt)).toBe(
          DateTime.toEpochMillis(original.createdAt),
        )
        expect(DateTime.toEpochMillis(renamed.updatedAt)).not.toBe(
          DateTime.toEpochMillis(original.updatedAt),
        )

        // Persisted, not just returned — a fresh read confirms body.name changed.
        const reread = yield* workoutsRepo.getOwned(original.id, ownerId)
        expect(reread.workout.name).toBe('Athletica Renamed')
      }).pipe(Effect.provide(WorkoutsRepoTestLive)),
  )

  it.effect(
    'getOwned/rename/delete/duplicate against another owner’s id all report WorkoutNotFound — a foreign id is indistinguishable from an absent one',
    () =>
      Effect.gen(function* () {
        const workoutsRepo = yield* WorkoutsRepo
        const ownerA = 'owner-a' as UserId
        const ownerB = 'owner-b' as UserId
        yield* insertOwner(ownerA)
        yield* insertOwner(ownerB)

        const workout = yield* workoutsRepo.insert(ownerA, makeWorkout('Romans'))

        const getAttempt = yield* Effect.exit(workoutsRepo.getOwned(workout.id, ownerB))
        expect(getAttempt._tag).toBe('Failure')

        const renameAttempt = yield* Effect.exit(
          workoutsRepo.rename(workout.id, ownerB, 'Hijacked'),
        )
        expect(renameAttempt._tag).toBe('Failure')

        const duplicateAttempt = yield* Effect.exit(workoutsRepo.duplicate(workout.id, ownerB))
        expect(duplicateAttempt._tag).toBe('Failure')

        const deleteAttempt = yield* Effect.exit(workoutsRepo.delete(workout.id, ownerB))
        expect(deleteAttempt._tag).toBe('Failure')

        // Untouched: owner A's workout is still there, under its original name.
        const stillThere = yield* workoutsRepo.getOwned(workout.id, ownerA)
        expect(stillThere.workout.name).toBe('Romans')
      }).pipe(Effect.provide(WorkoutsRepoTestLive)),
  )
})
