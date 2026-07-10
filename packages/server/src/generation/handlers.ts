import type { Rpc } from '@effect/rpc'
import type { SqlError } from '@effect/sql/SqlError'
import { CurrentUser, generate, GenerationRpcs, type SessionCompletion } from '@j45/domain'
import * as Effect from 'effect/Effect'
import * as Either from 'effect/Either'
import type * as Layer from 'effect/Layer'

import { ExercisesRepo } from '../library/exercises-repo.js'
import { CompletionsRepo } from '../session/completions-repo.js'

/**
 * A `SqlError` mid-request is infrastructure failing, not a declared rpc
 * error — turned into a defect so `GenerateWorkout`'s declared error channel
 * stays exactly `GenerationInfeasible`. Exactly `session/history-handlers.ts`'s
 * `asDefect` idiom.
 */
const asDefect = (error: SqlError): Effect.Effect<never> => Effect.die(error)

/** Flatten every station name from a completion's as-run workout snapshot. */
const stationNamesFrom = (completion: SessionCompletion): readonly string[] =>
  completion.workout.pods.flatMap((pod) => pod.stations.map((station) => station.name))

/**
 * Distinct station names from the newest `n` completions (already
 * newest-`endedAt`-first). `n === 0` yields `[]` so domain `generate`
 * excludes nothing.
 */
const recentStationNames = (
  completions: readonly SessionCompletion[],
  n: number,
): readonly string[] => {
  const names: string[] = []
  const seen = new Set<string>()
  for (const name of completions.slice(0, n).flatMap(stationNamesFrom)) {
    if (seen.has(name)) {
      continue
    }
    seen.add(name)
    names.push(name)
  }
  return names
}

/**
 * Implements every `GenerationRpcs` member in one `toLayer` — a thin
 * read-only wire-through onto the caller's exercise catalog and completion
 * history, then the pure domain `generate`. Scoped to `CurrentUser.id`
 * (provided by `AuthMiddleware`, guaranteed in context by `GenerationRpcs`'s
 * own `.middleware(AuthMiddleware)`). Nothing is persisted.
 */
export const GenerationHandlersLive: Layer.Layer<
  Rpc.Handler<'GenerateWorkout'>,
  never,
  ExercisesRepo | CompletionsRepo
> = GenerationRpcs.toLayer(
  Effect.gen(function* () {
    const exercisesRepo = yield* ExercisesRepo
    const completionsRepo = yield* CompletionsRepo

    return {
      GenerateWorkout: (constraints) =>
        Effect.gen(function* () {
          const user = yield* CurrentUser
          const libraryExercises = yield* exercisesRepo.listForOwner(user.id)
          const catalog = libraryExercises.map((entry) => entry.exercise)

          const completions = yield* completionsRepo.listForUser(user.id)
          const recentNames = recentStationNames(completions, constraints.noRepeatSessions)

          const result = generate(catalog, recentNames, constraints)
          if (Either.isLeft(result)) {
            return yield* Effect.fail(result.left)
          }
          return result.right
        }).pipe(Effect.catchTag('SqlError', asDefect)),
    }
  }),
)
