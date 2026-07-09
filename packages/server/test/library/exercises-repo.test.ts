import { NodeContext } from '@effect/platform-node'
import { SqliteClient } from '@effect/sql-sqlite-node'
import { describe, expect, it } from '@effect/vitest'
import { Exercise, ExerciseNotFound, type UserId, type Username } from '@j45/domain'
import * as DateTime from 'effect/DateTime'
import * as Duration from 'effect/Duration'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import * as TestClock from 'effect/TestClock'

import { UserRepo } from '../../src/auth/user-repo.js'
import { ExercisesRepo } from '../../src/library/exercises-repo.js'
import { MigratorLive } from '../../src/sql.js'

/**
 * The exact `MigratorLive` layer the server entrypoint runs at startup,
 * against an in-memory `@effect/sql-sqlite-node` driver — same pattern as
 * `test/library/workouts-repo.test.ts`.
 */
const SqlTestLive = MigratorLive.pipe(
  Layer.provideMerge(SqliteClient.layer({ filename: ':memory:' })),
  Layer.provideMerge(NodeContext.layer),
)

/** `exercises.owner_id REFERENCES users(id)` — `UserRepo` seeds the owner rows these tests attach exercises to. */
const ExercisesRepoTestLive = Layer.mergeAll(UserRepo.Default, ExercisesRepo.Default).pipe(
  Layer.provideMerge(SqlTestLive),
)

const makeExercise = (name: string) =>
  new Exercise({
    name,
    modality: 'strength',
    muscleGroups: ['chest'],
    equipment: ['dumbbell'],
    intensity: 'moderate',
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

describe('ExercisesRepo', () => {
  it.effect(
    'insert then update rewrites the body and bumps updated_at without touching created_at; delete removes the row',
    () =>
      Effect.gen(function* () {
        const exercisesRepo = yield* ExercisesRepo
        const ownerId = 'owner-1' as UserId
        yield* insertOwner(ownerId)

        const original = yield* exercisesRepo.insert(ownerId, makeExercise('Rower'))
        expect(original.exercise.name).toBe('Rower')
        expect(DateTime.toEpochMillis(original.updatedAt)).toBe(
          DateTime.toEpochMillis(original.createdAt),
        )

        yield* TestClock.adjust(Duration.seconds(5))

        const updated = yield* exercisesRepo.update(original.id, ownerId, makeExercise('Bike'))
        expect(updated.exercise.name).toBe('Bike')
        expect(DateTime.toEpochMillis(updated.createdAt)).toBe(
          DateTime.toEpochMillis(original.createdAt),
        )
        expect(DateTime.toEpochMillis(updated.updatedAt)).not.toBe(
          DateTime.toEpochMillis(original.updatedAt),
        )

        // Persisted, not just returned — a fresh list confirms body.name changed.
        const listed = yield* exercisesRepo.listForOwner(ownerId)
        expect(listed.map((entry) => entry.exercise.name)).toStrictEqual(['Bike'])
        expect(listed.map((entry) => DateTime.toEpochMillis(entry.createdAt))).toStrictEqual([
          DateTime.toEpochMillis(original.createdAt),
        ])

        yield* exercisesRepo.delete(original.id, ownerId)
        const afterDelete = yield* exercisesRepo.listForOwner(ownerId)
        expect(afterDelete).toHaveLength(0)
      }).pipe(Effect.provide(ExercisesRepoTestLive)),
  )

  it.effect('listForOwner returns only the caller’s rows — two owners keep independent lists', () =>
    Effect.gen(function* () {
      const exercisesRepo = yield* ExercisesRepo
      const ownerA = 'owner-a' as UserId
      const ownerB = 'owner-b' as UserId
      yield* insertOwner(ownerA)
      yield* insertOwner(ownerB)

      yield* exercisesRepo.insert(ownerA, makeExercise('Rower'))
      yield* exercisesRepo.insert(ownerA, makeExercise('Bike'))
      yield* exercisesRepo.insert(ownerB, makeExercise('Squat'))

      const listA = yield* exercisesRepo.listForOwner(ownerA)
      const listB = yield* exercisesRepo.listForOwner(ownerB)

      expect(listA).toHaveLength(2)
      expect(new Set(listA.map((entry) => entry.exercise.name))).toStrictEqual(
        new Set(['Rower', 'Bike']),
      )
      expect(listB).toHaveLength(1)
      expect(listB[0]?.exercise.name).toBe('Squat')
    }).pipe(Effect.provide(ExercisesRepoTestLive)),
  )

  it.effect(
    'update/delete against another owner’s id both fail ExerciseNotFound — a foreign id is indistinguishable from an absent one',
    () =>
      Effect.gen(function* () {
        const exercisesRepo = yield* ExercisesRepo
        const ownerA = 'owner-a' as UserId
        const ownerB = 'owner-b' as UserId
        yield* insertOwner(ownerA)
        yield* insertOwner(ownerB)

        const exercise = yield* exercisesRepo.insert(ownerA, makeExercise('Rower'))

        const updateAttempt = yield* Effect.either(
          exercisesRepo.update(exercise.id, ownerB, makeExercise('Hijacked')),
        )
        expect(updateAttempt._tag).toBe('Left')
        if (updateAttempt._tag === 'Left') {
          expect(updateAttempt.left).toBeInstanceOf(ExerciseNotFound)
          expect(updateAttempt.left._tag).toBe('ExerciseNotFound')
        }

        const deleteAttempt = yield* Effect.either(exercisesRepo.delete(exercise.id, ownerB))
        expect(deleteAttempt._tag).toBe('Left')
        if (deleteAttempt._tag === 'Left') {
          expect(deleteAttempt.left).toBeInstanceOf(ExerciseNotFound)
          expect(deleteAttempt.left._tag).toBe('ExerciseNotFound')
        }

        // Untouched: owner A's exercise is still there, under its original name.
        const stillThere = yield* exercisesRepo.listForOwner(ownerA)
        expect(stillThere).toHaveLength(1)
        expect(stillThere[0]?.exercise.name).toBe('Rower')
      }).pipe(Effect.provide(ExercisesRepoTestLive)),
  )
})
