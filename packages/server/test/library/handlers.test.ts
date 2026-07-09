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
  type WorkoutId,
} from '@j45/domain'
import * as DateTime from 'effect/DateTime'
import * as Duration from 'effect/Duration'
import * as Effect from 'effect/Effect'
import * as Either from 'effect/Either'
import * as Layer from 'effect/Layer'
import * as TestClock from 'effect/TestClock'

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

  it.scoped(
    'CreateWorkout returns a LibraryWorkout with a fresh id and equal created/updated timestamps',
    () =>
      Effect.gen(function* () {
        const ownerId = 'owner-c' as UserId
        yield* insertUser(ownerId)

        const authSessions = yield* AuthSessions
        const token = yield* authSessions.create(ownerId)
        const headers = { cookie: `${SESSION_COOKIE_NAME}=${token}` }

        const client = yield* RpcTest.makeClient(LibraryRpcs)
        const payload = makeWorkout('Brand New')
        const created = yield* client.CreateWorkout({ workout: payload }, { headers })

        expect(created.id).toBeTruthy()
        expect(created.workout).toEqual(payload)
        expect(DateTime.toEpochMillis(created.createdAt)).toBe(
          DateTime.toEpochMillis(created.updatedAt),
        )

        // Visible via ListWorkouts under the caller's ownership.
        const listed = yield* client.ListWorkouts(undefined, { headers })
        expect(listed).toHaveLength(1)
        expect(listed[0]?.id).toBe(created.id)
        expect(listed[0]?.workout.name).toBe('Brand New')
      }).pipe(Effect.provide(TestServicesLive)),
  )

  it.scoped(
    'UpdateWorkout replaces the body, bumps updated_at, preserves id + created_at; ListWorkouts reflects the edit',
    () =>
      Effect.gen(function* () {
        const ownerId = 'owner-u' as UserId
        yield* insertUser(ownerId)

        const workoutsRepo = yield* WorkoutsRepo
        const original = yield* workoutsRepo.insert(ownerId, makeWorkout('Original Name'))

        yield* TestClock.adjust(Duration.seconds(5))

        const authSessions = yield* AuthSessions
        const token = yield* authSessions.create(ownerId)
        const headers = { cookie: `${SESSION_COOKIE_NAME}=${token}` }

        const client = yield* RpcTest.makeClient(LibraryRpcs)
        const replacement = new Workout({
          name: 'Edited Name',
          focus: 'strength',
          note: 'rpc-level whole-body swap',
          pods: [new Pod({ name: 'Pod X', stations: [new Station({ name: 'Bike' })] })],
          flow: new Flow({
            type: 'sets',
            rounds: [new Round({ workSeconds: 45, restSeconds: 15 })],
          }),
        })
        const updated = yield* client.UpdateWorkout(
          { id: original.id, workout: replacement },
          { headers },
        )

        expect(updated.id).toBe(original.id)
        expect(DateTime.toEpochMillis(updated.createdAt)).toBe(
          DateTime.toEpochMillis(original.createdAt),
        )
        expect(DateTime.toEpochMillis(updated.updatedAt)).not.toBe(
          DateTime.toEpochMillis(original.updatedAt),
        )
        expect(updated.workout).toEqual(replacement)

        // Re-fetch via ListWorkouts rather than trusting the mutation return alone.
        const listed = yield* client.ListWorkouts(undefined, { headers })
        expect(listed).toHaveLength(1)
        const listedOne = listed[0]
        expect(listedOne).toBeDefined()
        if (listedOne === undefined) {
          return
        }
        expect(listedOne.id).toBe(original.id)
        expect(listedOne.workout).toEqual(replacement)
        expect(DateTime.toEpochMillis(listedOne.createdAt)).toBe(
          DateTime.toEpochMillis(original.createdAt),
        )
        expect(DateTime.toEpochMillis(listedOne.updatedAt)).toBe(
          DateTime.toEpochMillis(updated.updatedAt),
        )
      }).pipe(Effect.provide(TestServicesLive)),
  )

  it.scoped(
    'UpdateWorkout against a foreign or absent id fails with WorkoutNotFound — never Forbidden',
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
        const replacement = makeWorkout('Hijacked')

        const foreignAttempt = yield* Effect.either(
          client.UpdateWorkout({ id: bWorkout.id, workout: replacement }, { headers }),
        )
        expect(Either.isLeft(foreignAttempt)).toBe(true)
        if (Either.isLeft(foreignAttempt)) {
          expect(foreignAttempt.left._tag).toBe('WorkoutNotFound')
        }

        const absentId = '00000000-0000-4000-8000-000000000099' as WorkoutId
        const absentAttempt = yield* Effect.either(
          client.UpdateWorkout({ id: absentId, workout: replacement }, { headers }),
        )
        expect(Either.isLeft(absentAttempt)).toBe(true)
        if (Either.isLeft(absentAttempt)) {
          expect(absentAttempt.left._tag).toBe('WorkoutNotFound')
        }

        // Untouched: owner B's workout is still there, under its original name.
        const stillThere = yield* workoutsRepo.getOwned(bWorkout.id, ownerB)
        expect(stillThere.workout.name).toBe('Owner B’s Workout')
      }).pipe(Effect.provide(TestServicesLive)),
  )
})
