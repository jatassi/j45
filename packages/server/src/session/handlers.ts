import type { Rpc } from '@effect/rpc'
import type { SqlError } from '@effect/sql/SqlError'
import { applyReflow, compile, CurrentUser, Participant, SessionRpcs } from '@j45/domain'
import * as Effect from 'effect/Effect'
import * as Either from 'effect/Either'
import type * as Layer from 'effect/Layer'
import * as Stream from 'effect/Stream'

import { WorkoutsRepo } from '../library/workouts-repo.js'
import { LiveSessions } from './live-sessions.js'

/**
 * A `SqlError` mid-request is infrastructure failing, not a declared rpc
 * error — turned into a defect so `StartSession`'s declared error channel
 * stays exactly `WorkoutNotFound | ReflowInvalid`. Exactly
 * `library/handlers.ts`'s `asDefect` idiom.
 */
const asDefect = (error: SqlError): Effect.Effect<never> => Effect.die(error)

/**
 * Implements every `SessionRpcs` member in one `toLayer` — a thin
 * wire-through onto `LiveSessions` plus the ownership-gated compile on
 * `StartSession`. `StartSession` scopes its `WorkoutsRepo.getOwned` call to
 * `CurrentUser.id` (provided by `AuthMiddleware`, guaranteed in context by
 * `SessionRpcs`'s own `.middleware(AuthMiddleware)`), so a foreign id and an
 * absent one both fail `WorkoutNotFound` and never leak whether some other
 * user's workout exists. When a `reflow` is present it is applied to the
 * fetched workout before compile; an ill-fitting spec fails `ReflowInvalid`.
 * Presence join/leave is the watch stream's own acquire/release inside
 * `LiveSessions.watch` — this layer just hands the caller through as a
 * `Participant`. Commands are identity-agnostic: any authenticated
 * participant may pause/skip/quit, so `SendSessionCommand` does not re-read
 * `CurrentUser`.
 */
export const SessionHandlersLive: Layer.Layer<
  | Rpc.Handler<'StartSession'>
  | Rpc.Handler<'ListActiveSessions'>
  | Rpc.Handler<'WatchSession'>
  | Rpc.Handler<'SendSessionCommand'>,
  never,
  WorkoutsRepo | LiveSessions
> = SessionRpcs.toLayer(
  Effect.gen(function* () {
    const workoutsRepo = yield* WorkoutsRepo
    const liveSessions = yield* LiveSessions

    return {
      StartSession: ({ workoutId, reflow }) =>
        Effect.gen(function* () {
          const user = yield* CurrentUser
          const library = yield* workoutsRepo.getOwned(workoutId, user.id)
          let workout = library.workout
          if (reflow !== undefined) {
            const reflowed = applyReflow(library.workout, reflow)
            if (Either.isLeft(reflowed)) {
              return yield* Effect.fail(reflowed.left)
            }
            workout = reflowed.right
          }
          const compiled = compile(workout)
          return yield* liveSessions.start({
            host: new Participant({ userId: user.id, displayName: user.displayName }),
            workoutName: library.workout.name,
            // The as-run snapshot: the reflowed workout when a reflow applied,
            // else the stored plan — the same value `compile` just consumed.
            workout,
            compiled,
          })
        }).pipe(Effect.catchTag('SqlError', asDefect)),

      ListActiveSessions: () => liveSessions.list(),

      WatchSession: ({ id }) =>
        Stream.unwrap(
          Effect.map(CurrentUser, (user) =>
            liveSessions.watch(
              id,
              new Participant({ userId: user.id, displayName: user.displayName }),
            ),
          ),
        ),

      SendSessionCommand: ({ id, command }) => liveSessions.command(id, command),
    }
  }),
)
