import type { Rpc } from '@effect/rpc'
import type { SqlError } from '@effect/sql/SqlError'
import { compile, CurrentUser, Participant, SessionRpcs } from '@j45/domain'
import * as Effect from 'effect/Effect'
import type * as Layer from 'effect/Layer'
import * as Stream from 'effect/Stream'

import { WorkoutsRepo } from '../library/workouts-repo.js'
import { LiveSessions } from './live-sessions.js'

/**
 * A `SqlError` mid-request is infrastructure failing, not `WorkoutNotFound` —
 * turned into a defect so `StartSession`'s declared error channel stays
 * exactly `WorkoutNotFound`. Exactly `library/handlers.ts`'s `asDefect`
 * idiom.
 */
const asDefect = (error: SqlError): Effect.Effect<never> => Effect.die(error)

/**
 * Implements every `SessionRpcs` member in one `toLayer` — a thin
 * wire-through onto `LiveSessions` plus the ownership-gated compile on
 * `StartSession`. `StartSession` scopes its `WorkoutsRepo.getOwned` call to
 * `CurrentUser.id` (provided by `AuthMiddleware`, guaranteed in context by
 * `SessionRpcs`'s own `.middleware(AuthMiddleware)`), so a foreign id and an
 * absent one both fail `WorkoutNotFound` and never leak whether some other
 * user's workout exists. Presence join/leave is the watch stream's own
 * acquire/release inside `LiveSessions.watch` — this layer just hands the
 * caller through as a `Participant`. Commands are identity-agnostic: any
 * authenticated participant may pause/skip/quit, so `SendSessionCommand`
 * does not re-read `CurrentUser`.
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
      StartSession: ({ workoutId }) =>
        Effect.gen(function* () {
          const user = yield* CurrentUser
          const library = yield* workoutsRepo.getOwned(workoutId, user.id)
          const compiled = compile(library.workout)
          return yield* liveSessions.start({
            host: new Participant({ userId: user.id, displayName: user.displayName }),
            workoutName: library.workout.name,
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
