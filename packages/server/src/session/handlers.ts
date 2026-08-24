import type { Rpc } from '@effect/rpc'
import type { SqlError } from '@effect/sql/SqlError'
import {
  applyReflow,
  compile,
  CurrentUser,
  Participant,
  ReflowInvalid,
  SessionRpcs,
} from '@j45/domain'
import * as DateTime from 'effect/DateTime'
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
 * participant may pause/skip, so `SendSessionCommand` does not re-read
 * `CurrentUser`. `LeaveSession`, by contrast, is inherently about who you are,
 * so its handler reads `CurrentUser` and leaves the session as that user.
 */
export const SessionHandlersLive: Layer.Layer<
  | Rpc.Handler<'StartSession'>
  | Rpc.Handler<'ListActiveSessions'>
  | Rpc.Handler<'WatchSession'>
  | Rpc.Handler<'SendSessionCommand'>
  | Rpc.Handler<'LeaveSession'>,
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
            // A `Reflow` is positional indices into the source's flattened
            // stations, so a spec built against one version of the plan
            // resolves against another to a valid-but-different set of
            // stations — silently the wrong workout. The version the launch
            // screen built the spec from has to still be the stored one.
            if (!DateTime.Equivalence(reflow.sourceUpdatedAt, library.updatedAt)) {
              return yield* Effect.fail(
                new ReflowInvalid({
                  reason:
                    'This workout changed since the launch setup was built — reopen it and set the launch up again',
                }),
              )
            }
            const reflowed = applyReflow(library.workout, reflow.spec)
            if (Either.isLeft(reflowed)) {
              return yield* Effect.fail(reflowed.left)
            }
            workout = reflowed.right
          }
          const compiled = compile(workout)
          return yield* liveSessions.start({
            host: new Participant({ userId: user.id, displayName: user.displayName }),
            // The source workout, and whether the session runs an overlay of
            // it rather than the stored plan itself.
            workoutId: library.id,
            reflowLaunched: reflow !== undefined,
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

      LeaveSession: ({ id }) =>
        Effect.flatMap(CurrentUser, (user) => liveSessions.leaveSession(id, user.id)),
    }
  }),
)
