import { RpcTest } from '@effect/rpc'
import { describe, expect, it } from '@effect/vitest'
import { GenerationRpcs, LibraryRpcs, type MuscleGroup, type UserId } from '@j45/domain'
import * as DateTime from 'effect/DateTime'
import * as Effect from 'effect/Effect'
import * as Either from 'effect/Either'

import { AuthSessions } from '../../src/auth/auth-sessions.js'
import { WorkoutsRepo } from '../../src/library/workouts-repo.js'
import { CompletionsRepo } from '../../src/session/completions-repo.js'
import {
  baseConstraints,
  cookieHeaders,
  EMPHASIS_CATALOG,
  emphasisSourceOf,
  hasStationNamed,
  insertUser,
  makeCompletion,
  makeWorkoutWithStations,
  seedCatalog,
  seedExercises,
  stationNamesOf,
  TestServicesLive,
  UNIQUE_CARDIO_NAMES,
} from './handlers-harness.js'

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

  it.scoped('GenerateWorkout takes a two-group emphasis, and admits either group', () =>
    Effect.gen(function* () {
      const userId = 'user-emph' as UserId
      yield* insertUser(userId)
      yield* seedExercises(userId, EMPHASIS_CATALOG)

      const authSessions = yield* AuthSessions
      const token = yield* authSessions.create(userId)
      const headers = cookieHeaders(token)

      const client = yield* RpcTest.makeClient(GenerationRpcs)
      // The list decodes on the wire — that is half of what this case proves.
      const workout = yield* client.GenerateWorkout(
        baseConstraints({
          focus: 'hybrid',
          noRepeatSessions: 0,
          emphasis: ['glutes', 'hamstrings'],
          seed: 5,
        }),
        { headers },
      )

      const selected = new Set<MuscleGroup>(['glutes', 'hamstrings'])
      let strengthPicks = 0
      for (const name of stationNamesOf(workout)) {
        const source = emphasisSourceOf(name)
        expect(source, name).toBeDefined()
        if (source?.modality === 'strength') {
          strengthPicks++
          expect(
            source.muscleGroups.some((group) => selected.has(group)),
            name,
          ).toBe(true)
        }
      }
      // The case must not pass by drawing cardio alone.
      expect(strengthPicks).toBeGreaterThan(0)
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
