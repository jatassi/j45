import * as Clock from 'effect/Clock'
import * as Effect from 'effect/Effect'
import * as SubscriptionRef from 'effect/SubscriptionRef'

import type { PlanChange } from '../library/plan-changes.js'
import {
  getHandle,
  sessionsOfWorkout,
  withState,
  type Registry,
  type SessionHandle,
} from './session-state.js'

/**
 * How a change to a stored plan reaches the live sessions that run it — the
 * consuming half of the `PlanChanges` seam in `library/plan-changes.ts`.
 *
 * Two rules hold for every kind of change, and a new kind must keep both:
 *
 * 1. Only the sessions that *track* the workout are reached. A session
 *    launched with a reflow overlay runs a plan the library never held, so a
 *    change to the library has nothing to apply to it.
 * 2. An applied change is a state mutation like a timer advance, so it takes
 *    the session's semaphore. A change and a ticker advance can then never
 *    interleave a read-modify-write.
 */

/**
 * A new name on the session snapshot, published at once. There is no interval
 * to protect, so a rename never waits for a segment boundary.
 *
 * The name lives on the snapshot alone. The lobby summary and the completion
 * row both read it from there, so all three agree by construction.
 */
const applyRename = (handle: SessionHandle, name: string): Effect.Effect<void> =>
  handle.sem.withPermits(1)(
    Effect.gen(function* () {
      const now = yield* Clock.currentTimeMillis
      const state = yield* SubscriptionRef.get(handle.stateRef)
      if (state.workoutName === name) {
        return
      }
      // Only the name changes. A rename raises no plan-changed notice: the
      // new name is already on screen, and a notice for it would teach
      // participants to ignore the one that matters when stations change.
      yield* SubscriptionRef.set(
        handle.stateRef,
        withState(state, { serverNow: now, workoutName: name }),
      )
    }),
  )

/**
 * One change, applied to one session that tracks the changed workout.
 *
 * `renamed` is the only kind of change today, so this reads as a direct
 * call. A second kind makes it a `switch` on `change._tag`, with one
 * `apply…` function for each kind.
 */
const applyToSession = (handle: SessionHandle, change: PlanChange): Effect.Effect<void> =>
  applyRename(handle, change.name)

/**
 * Applies one plan change to every live session that tracks the changed
 * workout. A session that ends between the lookup and the apply is skipped
 * rather than failing the change — it has nothing left to update.
 */
export const applyPlanChange = (registry: Registry, change: PlanChange): Effect.Effect<void> =>
  Effect.gen(function* () {
    const { tracking } = yield* sessionsOfWorkout(registry, change.workoutId)
    yield* Effect.forEach(
      tracking,
      (summary) =>
        Effect.flatMap(getHandle(registry, summary.id), (handle) =>
          applyToSession(handle, change),
        ).pipe(Effect.ignore),
      { discard: true },
    )
  })
