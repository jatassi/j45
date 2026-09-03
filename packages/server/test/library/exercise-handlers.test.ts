import { NodeContext } from '@effect/platform-node'
import { RpcTest } from '@effect/rpc'
import { SqliteClient } from '@effect/sql-sqlite-node'
import { describe, expect, it } from '@effect/vitest'
import { Exercise, ExerciseRpcs, type ExerciseId, type UserId, type Username } from '@j45/domain'
import * as Effect from 'effect/Effect'
import * as Either from 'effect/Either'
import * as Layer from 'effect/Layer'

import { AuthSessions } from '../../src/auth/auth-sessions.js'
import { SESSION_COOKIE_NAME } from '../../src/auth/cookie.js'
import { AuthMiddlewareLive } from '../../src/auth/middleware.js'
import { UserRepo } from '../../src/auth/user-repo.js'
import { ExerciseHandlersLive } from '../../src/library/exercise-handlers.js'
import { ExercisesRepo } from '../../src/library/exercises-repo.js'
import { MigratorLive } from '../../src/sql.js'

/**
 * The exact `MigratorLive` layer the server entrypoint runs at startup,
 * against an in-memory `@effect/sql-sqlite-node` driver — same pattern as
 * `test/library/handlers.test.ts` and `test/auth/middleware.test.ts`.
 */
const SqlTestLive = MigratorLive.pipe(
  Layer.provideMerge(SqliteClient.layer({ filename: ':memory:' })),
  Layer.provideMerge(NodeContext.layer),
)

/**
 * Every service this test drives directly (`UserRepo`/`AuthSessions` to
 * seed accounts and sessions, `ExercisesRepo` to seed fixture exercises)
 * plus `AuthMiddlewareLive` and `ExerciseHandlersLive` themselves — the
 * exact handler layer this task lands, wired to the exact middleware
 * `server.ts` guards `ExerciseRpcs` with, sharing one in-memory sqlite
 * connection.
 */
const TestServicesLive = Layer.mergeAll(
  UserRepo.Default,
  AuthSessions.Default,
  ExercisesRepo.Default,
  AuthMiddlewareLive.pipe(Layer.provide(Layer.mergeAll(AuthSessions.Default, UserRepo.Default))),
  ExerciseHandlersLive.pipe(Layer.provide(ExercisesRepo.Default)),
).pipe(Layer.provideMerge(SqlTestLive))

const makeExercise = (name: string) =>
  new Exercise({
    name,
    modality: 'strength',
    muscleGroups: ['chest'],
    equipment: ['dumbbell'],
  })

const insertUser = (id: UserId) =>
  Effect.gen(function* () {
    const userRepo = yield* UserRepo
    yield* userRepo.insert({
      id,
      username: `${id}-username` as Username,
      displayName: 'Test User',
      role: 'member',
      pinHash: 'irrelevant-for-this-test',
      createdAt: '2020-01-01T00:00:00.000Z',
    })
  })

describe('ExerciseHandlersLive', () => {
  it.scoped(
    'ListExercises returns only the caller’s exercises, sorted by exercise name case-insensitively after decode',
    () =>
      Effect.gen(function* () {
        const ownerA = 'owner-a' as UserId
        const ownerB = 'owner-b' as UserId
        yield* insertUser(ownerA)
        yield* insertUser(ownerB)

        const exercisesRepo = yield* ExercisesRepo
        yield* exercisesRepo.insert(ownerA, makeExercise('banana Blast'))
        yield* exercisesRepo.insert(ownerA, makeExercise('Apple Attack'))
        yield* exercisesRepo.insert(ownerA, makeExercise('cherry Crush'))
        yield* exercisesRepo.insert(ownerB, makeExercise('Zebra Zap'))

        const authSessions = yield* AuthSessions
        const token = yield* authSessions.create(ownerA)

        const client = yield* RpcTest.makeClient(ExerciseRpcs)
        const exercises = yield* client.ListExercises(undefined, {
          headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
        })

        expect(exercises.map((entry) => entry.exercise.name)).toEqual([
          'Apple Attack',
          'banana Blast',
          'cherry Crush',
        ])
      }).pipe(Effect.provide(TestServicesLive)),
  )

  it.scoped(
    'UpdateExercise and DeleteExercise against another user’s exercise id each fail with ExerciseNotFound — never Forbidden',
    () =>
      Effect.gen(function* () {
        const ownerA = 'owner-a' as UserId
        const ownerB = 'owner-b' as UserId
        yield* insertUser(ownerA)
        yield* insertUser(ownerB)

        const exercisesRepo = yield* ExercisesRepo
        const bExercise = yield* exercisesRepo.insert(ownerB, makeExercise('Owner B’s Exercise'))

        const authSessions = yield* AuthSessions
        const tokenA = yield* authSessions.create(ownerA)
        const headers = { cookie: `${SESSION_COOKIE_NAME}=${tokenA}` }

        const client = yield* RpcTest.makeClient(ExerciseRpcs)
        const unknownId = '00000000-0000-0000-0000-000000000000' as ExerciseId
        const hijack = makeExercise('Hijacked')

        const updateForeign = yield* Effect.either(
          client.UpdateExercise({ id: bExercise.id, exercise: hijack }, { headers }),
        )
        const deleteForeign = yield* Effect.either(
          client.DeleteExercise({ id: bExercise.id }, { headers }),
        )
        const updateUnknown = yield* Effect.either(
          client.UpdateExercise({ id: unknownId, exercise: hijack }, { headers }),
        )
        const deleteUnknown = yield* Effect.either(
          client.DeleteExercise({ id: unknownId }, { headers }),
        )

        for (const tag of [
          Either.isLeft(updateForeign) ? updateForeign.left._tag : updateForeign,
          Either.isLeft(deleteForeign) ? deleteForeign.left._tag : deleteForeign,
          Either.isLeft(updateUnknown) ? updateUnknown.left._tag : updateUnknown,
          Either.isLeft(deleteUnknown) ? deleteUnknown.left._tag : deleteUnknown,
        ]) {
          expect(tag).toBe('ExerciseNotFound')
        }

        // Untouched: owner B's exercise is still there, under its original name.
        const stillThere = yield* exercisesRepo.listForOwner(ownerB)
        expect(stillThere).toHaveLength(1)
        expect(stillThere[0]?.exercise.name).toBe('Owner B’s Exercise')
      }).pipe(Effect.provide(TestServicesLive)),
  )
})
