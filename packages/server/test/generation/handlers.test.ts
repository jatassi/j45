import { NodeContext } from '@effect/platform-node'
import { RpcTest } from '@effect/rpc'
import { SqliteClient } from '@effect/sql-sqlite-node'
import { describe, expect, it } from '@effect/vitest'
import {
  CompletionId,
  Exercise,
  Flow,
  GenerationConstraints,
  GenerationRpcs,
  LibraryRpcs,
  Participant,
  Pod,
  Round,
  SessionCompletion,
  SessionId,
  Station,
  Workout,
  type Equipment,
  type UserId,
  type Username,
} from '@j45/domain'
import * as DateTime from 'effect/DateTime'
import * as Effect from 'effect/Effect'
import * as Either from 'effect/Either'
import * as Layer from 'effect/Layer'
import * as Schema from 'effect/Schema'

import { AuthSessions } from '../../src/auth/auth-sessions.js'
import { SESSION_COOKIE_NAME } from '../../src/auth/cookie.js'
import { AuthMiddlewareLive } from '../../src/auth/middleware.js'
import { UserRepo } from '../../src/auth/user-repo.js'
import { GenerationHandlersLive } from '../../src/generation/handlers.js'
import { ExercisesRepo } from '../../src/library/exercises-repo.js'
import { LibraryHandlersLive } from '../../src/library/handlers.js'
import { PlanChanges } from '../../src/library/plan-changes.js'
import { WorkoutsRepo } from '../../src/library/workouts-repo.js'
import { CompletionsRepo } from '../../src/session/completions-repo.js'
import { MigratorLive } from '../../src/sql.js'

/**
 * The exact `MigratorLive` layer the server entrypoint runs at startup,
 * against an in-memory `@effect/sql-sqlite-node` driver — same pattern as
 * `test/session/history-handlers.test.ts`.
 */
const SqlTestLive = MigratorLive.pipe(
  Layer.provideMerge(SqliteClient.layer({ filename: ':memory:' })),
  Layer.provideMerge(NodeContext.layer),
)

/**
 * Every service this test drives directly (`UserRepo`/`AuthSessions` to seed
 * accounts and sessions, `ExercisesRepo`/`CompletionsRepo` to seed catalog
 * and history, `WorkoutsRepo` for the no-persist `ListWorkouts` criterion)
 * plus `AuthMiddlewareLive`, `GenerationHandlersLive`, and
 * `LibraryHandlersLive` — the handler layers under test, wired to the exact
 * middleware `server.ts` guards `GenerationRpcs`/`LibraryRpcs` with, sharing
 * one in-memory sqlite connection.
 */
const TestServicesLive = Layer.mergeAll(
  UserRepo.Default,
  AuthSessions.Default,
  ExercisesRepo.Default,
  CompletionsRepo.Default,
  WorkoutsRepo.Default,
  AuthMiddlewareLive.pipe(Layer.provide(Layer.mergeAll(AuthSessions.Default, UserRepo.Default))),
  GenerationHandlersLive.pipe(
    Layer.provide(Layer.mergeAll(ExercisesRepo.Default, CompletionsRepo.Default)),
  ),
  LibraryHandlersLive.pipe(
    Layer.provide(Layer.mergeAll(WorkoutsRepo.Default, PlanChanges.Default)),
  ),
).pipe(Layer.provideMerge(SqlTestLive))

const insertUser = (id: UserId, displayName = 'Test User') =>
  Effect.gen(function* () {
    const userRepo = yield* UserRepo
    // Username schema caps at 20 chars (`^[a-z0-9][a-z0-9._-]{2,19}$`).
    yield* userRepo.insert({
      id,
      username: `${id}-u` as Username,
      displayName,
      role: 'member',
      pinHash: 'irrelevant-for-this-test',
      createdAt: '2020-01-01T00:00:00.000Z',
    })
  })

const cookieHeaders = (token: string) => ({
  cookie: `${SESSION_COOKIE_NAME}=${token}`,
})

const makeExercise = (
  name: string,
  overrides: Partial<{
    modality: 'cardio' | 'strength'
    equipment: readonly Equipment[]
  }> = {},
) =>
  new Exercise({
    name,
    modality: overrides.modality ?? 'cardio',
    muscleGroups: ['full-body'],
    equipment: [...(overrides.equipment ?? [])],
    intensity: 'moderate',
  })

/** Enough bodyweight cardio names to fill any ~15 min template (4 or 6 stations). */
const UNIQUE_CARDIO_NAMES = [
  'Burpee',
  'Mountain Climber',
  'High Knees',
  'Jumping Jack',
  'Skater Hop',
  'Plank Jack',
  'Butt Kick',
  'Tuck Jump',
  'Lateral Shuffle',
  'Seal Jack',
  'Inchworm',
  'Broad Jump',
] as const

const seedCatalog = (ownerId: UserId, names: readonly string[]) =>
  Effect.gen(function* () {
    const exercisesRepo = yield* ExercisesRepo
    for (const name of names) {
      yield* exercisesRepo.insert(ownerId, makeExercise(name))
    }
  })

const makeWorkoutWithStations = (workoutName: string, stationNames: readonly string[]) =>
  new Workout({
    name: workoutName,
    focus: 'cardio',
    pods: [
      new Pod({
        name: 'Pod 1',
        stations: stationNames.map((name) => new Station({ name })) as [Station, ...Station[]],
      }),
    ],
    flow: new Flow({
      type: 'laps',
      rounds: [new Round({ workSeconds: 40, restSeconds: 20 })],
    }),
  })

const makeCompletion = (input: {
  readonly id: string
  readonly sessionId: string
  readonly workoutName: string
  readonly stationNames: readonly string[]
  readonly hostUserId: UserId
  readonly startedAt: DateTime.Utc
  readonly endedAt: DateTime.Utc
}) => {
  const host = new Participant({
    userId: input.hostUserId,
    displayName: 'Host',
  })
  return new SessionCompletion({
    id: Schema.decodeSync(CompletionId)(input.id),
    sessionId: Schema.decodeSync(SessionId)(input.sessionId),
    workoutName: input.workoutName,
    workout: makeWorkoutWithStations(input.workoutName, input.stationNames),
    host,
    participants: [host],
    startedAt: input.startedAt,
    endedAt: input.endedAt,
  })
}

const baseConstraints = (
  overrides: Partial<{
    noRepeatSessions: number
    seed: number
    targetMinutes: number
    equipment: readonly Equipment[]
    focus: 'cardio' | 'strength' | 'hybrid'
  }> = {},
) =>
  new GenerationConstraints({
    focus: overrides.focus ?? 'cardio',
    targetMinutes: overrides.targetMinutes ?? 15,
    equipment: [...(overrides.equipment ?? [])],
    noRepeatSessions: overrides.noRepeatSessions ?? 1,
    seed: overrides.seed ?? 42,
  })

const stationNamesOf = (workout: Workout): string[] =>
  workout.pods.flatMap((pod) => pod.stations.map((station) => station.name))

const hasStationNamed = (workout: Workout, name: string): boolean =>
  stationNamesOf(workout).some((n) => n.toLowerCase() === name.toLowerCase())

describe('GenerationHandlersLive', () => {
  it.scoped(
    'GenerateWorkout excludes a station name present in the caller’s newest noRepeatSessions completions',
    () =>
      Effect.gen(function* () {
        const userId = 'user-ex' as UserId
        yield* insertUser(userId)
        yield* seedCatalog(userId, UNIQUE_CARDIO_NAMES)

        const endedAt = DateTime.unsafeMake('2020-01-01T12:00:00.000Z')
        const startedAt = DateTime.unsafeMake('2020-01-01T11:30:00.000Z')
        const completion = makeCompletion({
          id: 'completion-burpee',
          sessionId: 'session-burpee',
          workoutName: 'Prior Session',
          stationNames: ['Burpee'],
          hostUserId: userId,
          startedAt,
          endedAt,
        })
        const completionsRepo = yield* CompletionsRepo
        yield* completionsRepo.insertAll([{ userId, completion }])

        const authSessions = yield* AuthSessions
        const token = yield* authSessions.create(userId)
        const headers = cookieHeaders(token)

        const client = yield* RpcTest.makeClient(GenerationRpcs)
        const workout = yield* client.GenerateWorkout(baseConstraints({ noRepeatSessions: 1 }), {
          headers,
        })

        expect(hasStationNamed(workout, 'Burpee')).toBe(false)
        // Result stations must come from the caller's catalog.
        for (const name of stationNamesOf(workout)) {
          expect(UNIQUE_CARDIO_NAMES.map((n) => n.toLowerCase())).toContain(name.toLowerCase())
        }
      }).pipe(Effect.provide(TestServicesLive)),
  )

  it.scoped(
    'an identical completion history on a second account does not affect the first caller’s result',
    () =>
      Effect.gen(function* () {
        const userA = 'user-a' as UserId
        const userB = 'user-b' as UserId
        yield* insertUser(userA)
        yield* insertUser(userB)
        yield* seedCatalog(userA, UNIQUE_CARDIO_NAMES)
        yield* seedCatalog(userB, UNIQUE_CARDIO_NAMES)

        const authSessions = yield* AuthSessions
        const tokenA = yield* authSessions.create(userA)
        const headersA = cookieHeaders(tokenA)

        const client = yield* RpcTest.makeClient(GenerationRpcs)
        const constraints = baseConstraints({ noRepeatSessions: 1, seed: 99 })

        // Baseline: user A has no history — result includes whatever the seed samples.
        const before = yield* client.GenerateWorkout(constraints, { headers: headersA })

        // Seed user B with a Burpee completion (identical shape to what would
        // exclude for A). A's result must stay bit-identical.
        const endedAt = DateTime.unsafeMake('2020-01-01T12:00:00.000Z')
        const startedAt = DateTime.unsafeMake('2020-01-01T11:30:00.000Z')
        const bCompletion = makeCompletion({
          id: 'completion-b-burpee',
          sessionId: 'session-b-burpee',
          workoutName: 'B Prior',
          stationNames: ['Burpee'],
          hostUserId: userB,
          startedAt,
          endedAt,
        })
        const completionsRepo = yield* CompletionsRepo
        yield* completionsRepo.insertAll([{ userId: userB, completion: bCompletion }])

        const after = yield* client.GenerateWorkout(constraints, { headers: headersA })
        expect(after).toStrictEqual(before)
      }).pipe(Effect.provide(TestServicesLive)),
  )

  it.scoped(
    'noRepeatSessions of 0 disables exclusion so a recently-completed name may appear',
    () =>
      Effect.gen(function* () {
        const userId = 'user-nr0' as UserId
        yield* insertUser(userId)

        // Catalog of only "Burpee" rows — every station must be named Burpee
        // when generation succeeds, proving the name is not excluded.
        const onlyBurpee = Array.from({ length: 12 }, () => 'Burpee')
        yield* seedCatalog(userId, onlyBurpee)

        const endedAt = DateTime.unsafeMake('2020-01-01T12:00:00.000Z')
        const startedAt = DateTime.unsafeMake('2020-01-01T11:30:00.000Z')
        const completion = makeCompletion({
          id: 'completion-only-burpee',
          sessionId: 'session-only-burpee',
          workoutName: 'Prior',
          stationNames: ['Burpee'],
          hostUserId: userId,
          startedAt,
          endedAt,
        })
        const completionsRepo = yield* CompletionsRepo
        yield* completionsRepo.insertAll([{ userId, completion }])

        const authSessions = yield* AuthSessions
        const token = yield* authSessions.create(userId)
        const headers = cookieHeaders(token)

        const client = yield* RpcTest.makeClient(GenerationRpcs)
        const workout = yield* client.GenerateWorkout(
          baseConstraints({ noRepeatSessions: 0, seed: 7 }),
          { headers },
        )

        expect(hasStationNamed(workout, 'Burpee')).toBe(true)
      }).pipe(Effect.provide(TestServicesLive)),
  )

  it.scoped('ListWorkouts is unchanged before and after GenerateWorkout (nothing persisted)', () =>
    Effect.gen(function* () {
      const userId = 'user-np' as UserId
      yield* insertUser(userId)
      yield* seedCatalog(userId, UNIQUE_CARDIO_NAMES)

      const workoutsRepo = yield* WorkoutsRepo
      yield* workoutsRepo.insert(
        userId,
        makeWorkoutWithStations('Existing Library Workout', ['High Knees']),
      )

      const authSessions = yield* AuthSessions
      const token = yield* authSessions.create(userId)
      const headers = cookieHeaders(token)

      const libraryClient = yield* RpcTest.makeClient(LibraryRpcs)
      const before = yield* libraryClient.ListWorkouts(undefined, { headers })

      const generationClient = yield* RpcTest.makeClient(GenerationRpcs)
      yield* generationClient.GenerateWorkout(baseConstraints({ noRepeatSessions: 0 }), {
        headers,
      })

      const after = yield* libraryClient.ListWorkouts(undefined, { headers })
      expect(after).toStrictEqual(before)
    }).pipe(Effect.provide(TestServicesLive)),
  )

  it.scoped('infeasible constraints surface as GenerationInfeasible, not a defect', () =>
    Effect.gen(function* () {
      const userId = 'user-inf' as UserId
      yield* insertUser(userId)
      yield* seedCatalog(userId, UNIQUE_CARDIO_NAMES)

      const authSessions = yield* AuthSessions
      const token = yield* authSessions.create(userId)
      const headers = cookieHeaders(token)

      const client = yield* RpcTest.makeClient(GenerationRpcs)
      // No template fits targetMinutes: 1 (±10%).
      const attempt = yield* Effect.either(
        client.GenerateWorkout(
          baseConstraints({
            noRepeatSessions: 0,
            targetMinutes: 1,
          }),
          { headers },
        ),
      )

      expect(Either.isLeft(attempt)).toBe(true)
      if (Either.isLeft(attempt)) {
        expect(attempt.left._tag).toBe('GenerationInfeasible')
        if (attempt.left._tag === 'GenerationInfeasible') {
          expect(typeof attempt.left.reason).toBe('string')
          expect(attempt.left.reason.length).toBeGreaterThan(0)
        }
      }
    }).pipe(Effect.provide(TestServicesLive)),
  )
})
