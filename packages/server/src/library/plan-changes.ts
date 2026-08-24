import type { WorkoutId } from '@j45/domain'
import * as Effect from 'effect/Effect'
import * as HashMap from 'effect/HashMap'
import * as Ref from 'effect/Ref'
import type * as Scope from 'effect/Scope'

/**
 * One change to a stored plan, announced by the library handlers so that
 * whoever runs that plan can follow it.
 *
 * This is the seam that keeps the library from knowing about live sessions.
 * The library depends on `PlanChanges` only. `session/plan-sync.ts` is the
 * one consumer. The session side reaches across to the library; the library
 * side never reaches back.
 *
 * The session-ended seam in `live-sessions.ts` runs the other way. There the
 * session module depends on the history store, and the history module knows
 * nothing of sessions.
 *
 * A new kind of change is a new member of this union. Add the member here,
 * publish it from the handler that makes the change, and give it a case in
 * `applyPlanChange`.
 */
export type PlanChange = {
  /** The workout kept its content and took a new name. */
  readonly _tag: 'renamed'
  readonly workoutId: WorkoutId
  readonly name: string
}

/**
 * What a consumer does with one change. The signature has no error channel:
 * a consumer must handle its own expected failures. Only a defect can escape,
 * and `publish` logs it.
 */
export type PlanChangeConsumer = (change: PlanChange) => Effect.Effect<void>

const publish = (
  consumers: Ref.Ref<HashMap.HashMap<number, PlanChangeConsumer>>,
  change: PlanChange,
): Effect.Effect<void> =>
  Effect.flatMap(Ref.get(consumers), (map) =>
    Effect.forEach(
      HashMap.values(map),
      (consume) =>
        // A broken consumer must not fail the write that announced the
        // change. The plan is already stored. This is the same rule as the
        // completion write on the session-ended seam: log the cause, and
        // continue with the other consumers.
        Effect.catchAllCause(consume(change), (cause) =>
          Effect.logError('plan change consumer failed', cause),
        ),
      { discard: true },
    ),
  )

const subscribe = (
  consumers: Ref.Ref<HashMap.HashMap<number, PlanChangeConsumer>>,
  nextId: Ref.Ref<number>,
  consumer: PlanChangeConsumer,
): Effect.Effect<void, never, Scope.Scope> =>
  Effect.asVoid(
    Effect.acquireRelease(
      Effect.tap(
        Ref.modify(nextId, (n) => [n, n + 1]),
        (id) => Ref.update(consumers, HashMap.set(id, consumer)),
      ),
      (id) => Ref.update(consumers, HashMap.remove(id)),
    ),
  )

/**
 * The in-process announcement of changes to stored plans.
 *
 * Delivery is synchronous: `publish` returns only after every consumer has
 * finished with the change. A rename rpc therefore answers the host after
 * every live session already carries the new name, so there is no window in
 * which the library and the sessions running it disagree, and a test needs
 * no polling to see the result.
 *
 * `subscribe` registers a consumer for the life of a scope, so a consumer
 * never outlives the service that registered it.
 */
export class PlanChanges extends Effect.Service<PlanChanges>()('PlanChanges', {
  effect: Effect.gen(function* () {
    const consumers = yield* Ref.make(HashMap.empty<number, PlanChangeConsumer>())
    const nextId = yield* Ref.make(0)

    return {
      publish: (change: PlanChange) => publish(consumers, change),
      subscribe: (consumer: PlanChangeConsumer) => subscribe(consumers, nextId, consumer),
    } as const
  }),
}) {}
