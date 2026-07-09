import { NodeContext } from '@effect/platform-node'
import { RpcTest } from '@effect/rpc'
import { SqliteClient } from '@effect/sql-sqlite-node'
import { describe, expect, it } from '@effect/vitest'
import {
  Flow,
  LibraryRpcs,
  Pod,
  Round,
  Station,
  Workout,
  type UserId,
  type Username,
} from '@j45/domain'
import * as Effect from 'effect/Effect'
import * as Either from 'effect/Either'
import * as Layer from 'effect/Layer'

import { AuthSessions } from '../../src/auth/auth-sessions.js'
import { SESSION_COOKIE_NAME } from '../../src/auth/cookie.js'
import { AuthMiddlewareLive } from '../../src/auth/middleware.js'
import { UserRepo } from '../../src/auth/user-repo.js'
import { LibraryHandlersLive } from '../../src/library/handlers.js'
import { WorkoutsRepo } from '../../src/library/workouts-repo.js'
import { MigratorLive } from '../../src/sql.js'

/**
 * The exact `MigratorLive` layer the server entrypoint runs at startup,
 * against an in-memory `@effect/sql-sqlite-node` driver — same pattern as
 * `test/library/workouts-repo.test.ts` and `test/auth/middleware.test.ts`.
 */
const SqlTestLive = MigratorLive.pipe(
  Layer.provideMerge(SqliteClient.layer({ filename: ':memory:' })),
  Layer.provideMerge(NodeContext.layer),
)

/**
 * Every service this test drives directly (`UserRepo`/`AuthSessions` to
 * seed accounts and sessions, `WorkoutsRepo` to seed fixture workouts)
 * plus `AuthMiddlewareLive` and `LibraryHandlersLive` themselves — the
 * exact handler layer this task lands, wired to the exact middleware
 * `server.ts` guards `LibraryRpcs` with, sharing one in-memory sqlite
 * connection.
 */
const TestServicesLive = Layer.mergeAll(
  UserRepo.Default,
  AuthSessions.Default,
  WorkoutsRepo.Default,
  AuthMiddlewareLive.pipe(Layer.provide(Layer.mergeAll(AuthSessions.Default, UserRepo.Default))),
  LibraryHandlersLive.pipe(Layer.provide(WorkoutsRepo.Default)),
).pipe(Layer.provideMerge(SqlTestLive))

const makeWorkout = (name: string) =>
  new Workout({
    name,
    focus: 'cardio',
    pods: [new Pod({ name: 'Pod 1', stations: [new Station({ name: 'Rower' })] })],
    flow: new Flow({ type: 'laps', rounds: [new Round({ workSeconds: 40, restSeconds: 20 })] }),
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

describe('LibraryHandlersLive', () => {
  it.scoped(
    'ListWorkouts returns only the caller’s workouts, sorted by workout name case-insensitively after decode',
    () =>
      Effect.gen(function* () {
        const ownerA = 'owner-a' as UserId
        const ownerB = 'owner-b' as UserId
        yield* insertUser(ownerA)
        yield* insertUser(ownerB)

        const workoutsRepo = yield* WorkoutsRepo
        yield* workoutsRepo.insert(ownerA, makeWorkout('banana Blast'))
        yield* workoutsRepo.insert(ownerA, makeWorkout('Apple Attack'))
        yield* workoutsRepo.insert(ownerA, makeWorkout('cherry Crush'))
        yield* workoutsRepo.insert(ownerB, makeWorkout('Zebra Zap'))

        const authSessions = yield* AuthSessions
        const token = yield* authSessions.create(ownerA)

        const client = yield* RpcTest.makeClient(LibraryRpcs)
        const workouts = yield* client.ListWorkouts(undefined, {
          headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
        })

        expect(workouts.map((workout) => workout.workout.name)).toEqual([
          'Apple Attack',
          'banana Blast',
          'cherry Crush',
        ])
      }).pipe(Effect.provide(TestServicesLive)),
  )

  it.scoped(
    'GetWorkout, DuplicateWorkout, RenameWorkout, and DeleteWorkout against another user’s workout id each fail with WorkoutNotFound — never Forbidden',
    () =>
      Effect.gen(function* () {
        const ownerA = 'owner-a' as UserId
        const ownerB = 'owner-b' as UserId
        yield* insertUser(ownerA)
        yield* insertUser(ownerB)

        const workoutsRepo = yield* WorkoutsRepo
        const bWorkout = yield* workoutsRepo.insert(ownerB, makeWorkout('Owner B’s Workout'))

        const authSessions = yield* AuthSessions
        const tokenA = yield* authSessions.create(ownerA)
        const headers = { cookie: `${SESSION_COOKIE_NAME}=${tokenA}` }

        const client = yield* RpcTest.makeClient(LibraryRpcs)

        const getAttempt = yield* Effect.either(client.GetWorkout({ id: bWorkout.id }, { headers }))
        const duplicateAttempt = yield* Effect.either(
          client.DuplicateWorkout({ id: bWorkout.id }, { headers }),
        )
        const renameAttempt = yield* Effect.either(
          client.RenameWorkout({ id: bWorkout.id, name: 'Hijacked' }, { headers }),
        )
        const deleteAttempt = yield* Effect.either(
          client.DeleteWorkout({ id: bWorkout.id }, { headers }),
        )

        for (const tag of [
          Either.isLeft(getAttempt) ? getAttempt.left._tag : getAttempt,
          Either.isLeft(duplicateAttempt) ? duplicateAttempt.left._tag : duplicateAttempt,
          Either.isLeft(renameAttempt) ? renameAttempt.left._tag : renameAttempt,
          Either.isLeft(deleteAttempt) ? deleteAttempt.left._tag : deleteAttempt,
        ]) {
          expect(tag).toBe('WorkoutNotFound')
        }

        // Untouched: owner B's workout is still there, under its original name.
        const stillThere = yield* workoutsRepo.getOwned(bWorkout.id, ownerB)
        expect(stillThere.workout.name).toBe('Owner B’s Workout')
      }).pipe(Effect.provide(TestServicesLive)),
  )
})
