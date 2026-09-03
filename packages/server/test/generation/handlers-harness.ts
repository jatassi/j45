import { NodeContext } from '@effect/platform-node'
import { SqliteClient } from '@effect/sql-sqlite-node'
import {
  CompletionId,
  Exercise,
  Flow,
  GenerationConstraints,
  Participant,
  Pod,
  Round,
  SessionCompletion,
  SessionId,
  Station,
  Workout,
  type Equipment,
  type MuscleGroup,
  type UserId,
  type Username,
} from '@j45/domain'
import type * as DateTime from 'effect/DateTime'
import * as Effect from 'effect/Effect'
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
 * The scaffolding that the generation handler suites share: the live sql +
 * handler layers, the account and catalog seeding, the constraint builder and
 * the fixtures that resolve a station name back to the exercise it came from.
 *
 * It lived in `handlers.test.ts` until the emphasis case took that file over
 * the line limit. It moves here in the same way `generate-harness.tsx` carries
 * the generate-screen scaffolding on the client side.
 *
 * The move is not a pure transcription. `makeExercise` gained a `muscleGroups`
 * override and `baseConstraints` gained an `emphasis` override, both for the
 * emphasis case; `seedExercises` is new, and `seedCatalog` now calls it; and
 * `EMPHASIS_CATALOG` with its lookup is new.
 */

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
export const TestServicesLive = Layer.mergeAll(
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

export const insertUser = (id: UserId, displayName = 'Test User') =>
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

export const cookieHeaders = (token: string) => ({
  cookie: `${SESSION_COOKIE_NAME}=${token}`,
})

const makeExercise = (
  name: string,
  overrides: Partial<{
    modality: 'cardio' | 'strength'
    equipment: readonly Equipment[]
    muscleGroups: readonly [MuscleGroup, ...MuscleGroup[]]
  }> = {},
) =>
  new Exercise({
    name,
    modality: overrides.modality ?? 'cardio',
    muscleGroups: overrides.muscleGroups === undefined ? ['core'] : [...overrides.muscleGroups],
    equipment: [...(overrides.equipment ?? [])],
  })

/** Enough bodyweight cardio names to fill any ~15 min template (4 or 6 stations). */
export const UNIQUE_CARDIO_NAMES = [
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

export const seedExercises = (ownerId: UserId, exercises: readonly Exercise[]) =>
  Effect.gen(function* () {
    const exercisesRepo = yield* ExercisesRepo
    for (const exercise of exercises) {
      yield* exercisesRepo.insert(ownerId, exercise)
    }
  })

export const seedCatalog = (ownerId: UserId, names: readonly string[]) =>
  seedExercises(
    ownerId,
    names.map((name) => makeExercise(name)),
  )

/**
 * A catalog for the emphasis case: strength exercises tagged one group each,
 * and cardio that carries none of them. A station is free text, so the
 * assertion resolves the name back to this list.
 */
const strengthOf = (names: readonly string[], group: MuscleGroup): Exercise[] =>
  names.map((name) => makeExercise(name, { modality: 'strength', muscleGroups: [group] }))

export const EMPHASIS_CATALOG: readonly Exercise[] = [
  ...strengthOf(['Glute Bridge', 'Hip Thrust', 'Sumo Squat'], 'glutes'),
  ...strengthOf(['Leg Curl', 'Good Morning', 'Romanian Deadlift'], 'hamstrings'),
  ...strengthOf(['Push Up', 'Chest Fly', 'Floor Press'], 'chest'),
  ...UNIQUE_CARDIO_NAMES.slice(0, 6).map((name) => makeExercise(name)),
]

export const emphasisSourceOf = (name: string): Exercise | undefined =>
  EMPHASIS_CATALOG.find((exercise) => exercise.name.toLowerCase() === name.toLowerCase())

export const makeWorkoutWithStations = (workoutName: string, stationNames: readonly string[]) =>
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

export const makeCompletion = (input: {
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

export const baseConstraints = (
  overrides: Partial<{
    noRepeatSessions: number
    seed: number
    targetMinutes: number
    equipment: readonly Equipment[]
    focus: 'cardio' | 'strength' | 'hybrid'
    emphasis: readonly [MuscleGroup, ...MuscleGroup[]]
  }> = {},
) =>
  new GenerationConstraints({
    focus: overrides.focus ?? 'cardio',
    targetMinutes: overrides.targetMinutes ?? 15,
    equipment: [...(overrides.equipment ?? [])],
    ...(overrides.emphasis === undefined ? {} : { emphasis: overrides.emphasis }),
    noRepeatSessions: overrides.noRepeatSessions ?? 1,
    seed: overrides.seed ?? 42,
  })

export const stationNamesOf = (workout: Workout): string[] =>
  workout.pods.flatMap((pod) => pod.stations.map((station) => station.name))

export const hasStationNamed = (workout: Workout, name: string): boolean =>
  stationNamesOf(workout).some((n) => n.toLowerCase() === name.toLowerCase())
