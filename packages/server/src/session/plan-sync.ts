import {
  compile,
  compiledEquals,
  enterSegment,
  remapPosition,
  type SessionState,
  type TimerState,
} from '@j45/domain'
import * as Clock from 'effect/Clock'
import * as Effect from 'effect/Effect'
import * as Either from 'effect/Either'
import * as Option from 'effect/Option'
import * as Ref from 'effect/Ref'
import * as SubscriptionRef from 'effect/SubscriptionRef'

import type { PlanChange } from '../library/plan-changes.js'
import {
  getHandle,
  segmentIndexOf,
  sessionsOfWorkout,
  withState,
  type PendingPlan,
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
 * Runs `f` on the current snapshot, under the session's semaphore, unless
 * the timer is done. Every kind of change starts this way.
 *
 * A done session takes no more changes. Its plan is frozen, and the
 * completion row must record the plan that was in force while the timer was
 * live — not a change that came after the last rep.
 */
const whileLive = (
  handle: SessionHandle,
  f: (state: SessionState) => Effect.Effect<void>,
): Effect.Effect<void> =>
  handle.sem.withPermits(1)(
    Effect.gen(function* () {
      const state = yield* SubscriptionRef.get(handle.stateRef)
      if (state.timer._tag === 'done') {
        return
      }
      yield* f(state)
    }),
  )

/**
 * Puts a new name on the session snapshot at once. There is no interval to
 * protect, so a name never waits for a segment boundary. The caller holds
 * the semaphore.
 *
 * The name lives on the snapshot alone. The lobby summary and the completion
 * row both read it from there, so all three agree by construction.
 *
 * A new name raises no plan-changed notice, so the revision does not move.
 * The name is already on screen. A notice for it would make participants
 * ignore the notice that matters, when the stations change.
 */
const publishName = (
  handle: SessionHandle,
  state: SessionState,
  name: string,
): Effect.Effect<void> =>
  Effect.gen(function* () {
    if (state.workoutName === name) {
      return
    }
    const now = yield* Clock.currentTimeMillis
    yield* SubscriptionRef.set(
      handle.stateRef,
      withState(state, { serverNow: now, workoutName: name }),
    )
  })

/** The `RenameWorkout` path: a new name and nothing else. */
const applyRename = (handle: SessionHandle, name: string): Effect.Effect<void> =>
  whileLive(handle, (state) => publishName(handle, state, name))

/**
 * A saved edit, held for the next segment boundary.
 *
 * Nothing is published here. A participant keeps the plan they are running
 * until their current segment ends. At worst they run one more interval of
 * the old plan. `snapshotAfterMove` puts the held plan in force.
 *
 * A second edit before the first lands replaces it. The store holds one
 * current plan, and that is the plan the session must arrive at.
 *
 * A save that compiles to the plan already in force is not a plan change,
 * whatever the editor sent. Two saves do this, and both must stay quiet:
 * a save that renames the workout and leaves the stations alone, and a save
 * of content the user did not touch. Each publishes the name and no notice.
 * The held plan clears with them: the store now holds what the session runs.
 */
const applyEdit = (handle: SessionHandle, plan: PendingPlan): Effect.Effect<void> =>
  whileLive(handle, (state) =>
    compiledEquals(plan.compiled, state.compiled)
      ? Effect.zipRight(
          Ref.set(handle.pending, Option.none()),
          publishName(handle, state, plan.workout.name),
        )
      : Ref.set(handle.pending, Option.some(plan)),
  )

/**
 * Whether a timer move is a segment boundary — the instant a held plan may
 * take over. A pause, a resume, and a no-op advance all keep the segment, so
 * none of them is a boundary. Reaching `done` is not one either: the plan
 * freezes there.
 */
const crossesBoundary = (before: TimerState, after: TimerState): boolean =>
  after._tag === 'running' && segmentIndexOf(after) !== segmentIndexOf(before)

/**
 * The snapshot to publish for one timer move. Usually that is the move
 * alone. When the move changes segment, it is also the boundary a waiting
 * plan change asked for, so the new plan goes into the snapshot with it.
 *
 * The caller holds the session's semaphore, so this reads and clears
 * `pending` without racing the edit that filled it.
 *
 * Two things must be right here:
 *
 * - **The position.** `remapPosition` keeps the participant at the same work
 *   ordinal, so an edit never returns them to a station they finished.
 * - **The deadline.** The timer re-enters the mapped segment at full
 *   duration, anchored on `now`. Chaining is anchored on the previous
 *   deadline, and the segment now in force has a duration the old chain
 *   knew nothing about, so the absolute deadline has to be recomputed.
 */
export const snapshotAfterMove = (
  handle: SessionHandle,
  move: { readonly state: SessionState; readonly moved: TimerState; readonly now: number },
): Effect.Effect<SessionState> =>
  Effect.gen(function* () {
    const { moved, now, state } = move
    const pending = yield* Ref.get(handle.pending)
    const plain = withState(state, { serverNow: now, timer: moved })
    if (Option.isNone(pending) || !crossesBoundary(state.timer, moved)) {
      // A move that ends the session's timer drops the held plan. A done
      // session's plan is frozen, and the completion row must record what
      // was in force while the timer was live.
      if (moved._tag === 'done') {
        yield* Ref.set(handle.pending, Option.none())
      }
      return plain
    }
    const plan = pending.value
    const mapped = remapPosition(
      state.compiled.segments,
      segmentIndexOf(moved) ?? 0,
      plan.compiled.segments,
    )
    yield* Ref.set(handle.pending, Option.none())
    if (Either.isLeft(mapped)) {
      // The new plan has fewer works than the session already ran. Clamping
      // backwards would replay a finished station, so nothing is applied.
      // The session keeps the plan it has, and the held plan is dropped
      // rather than retried at every later boundary. The plan-exhaustion
      // ticket replaces this branch with a move to done.
      yield* Effect.logInfo('plan change exhausted the session position').pipe(
        Effect.annotateLogs({ sessionId: handle.id, workIndex: mapped.left.workIndex }),
      )
      return plain
    }
    yield* Ref.set(handle.workout, plan.workout)
    return withState(state, {
      serverNow: now,
      compiled: plan.compiled,
      timer: enterSegment(mapped.right, plan.compiled.segments, now),
      workoutName: plan.workout.name,
      planChange: { revision: state.planRevision + 1, changedBy: plan.changedBy },
    })
  })

/**
 * The one thing a plan change needs that this module cannot do: end a
 * session. Ending writes the completion rows and tears the actor down, which
 * `live-sessions.ts` owns, so it is passed in rather than imported. That
 * keeps the dependency running one way — `live-sessions.ts` calls into this
 * module, never the reverse.
 */
export type PlanSyncOps = {
  /** Ends one session because the workout it runs was deleted. */
  readonly endForPlanDeleted: (handle: SessionHandle) => Effect.Effect<void>
}

/**
 * The `DeleteWorkout` path: the session ends.
 *
 * There is no `whileLive` gate here. A done session takes no more *plan*
 * changes, because its plan is frozen — but a deleted workout leaves no
 * session behind it, done or not. Whoever is still watching lands on home
 * with the delete's own notice.
 *
 * The semaphore is taken like any other mutation, so the end never
 * interleaves with a ticker advance. Ending writes the completion rows from
 * the plan the session last applied while its timer was live; the deleted
 * library row is not read, and the completions table does not reference it.
 */
const applyDelete = (handle: SessionHandle, ops: PlanSyncOps): Effect.Effect<void> =>
  handle.sem.withPermits(1)(ops.endForPlanDeleted(handle))

/**
 * What one change does to one session — the `apply…` function for its kind,
 * built once for the whole fan-out. One workout can run in several live
 * sessions at once, and an edit compiles here rather than in each of them, so
 * every session arrives at the very same plan.
 *
 * A new kind of change is a new case here plus its own `apply…` above.
 */
const applierFor = (
  change: PlanChange,
  ops: PlanSyncOps,
): ((handle: SessionHandle) => Effect.Effect<void>) => {
  switch (change._tag) {
    case 'renamed': {
      return (handle) => applyRename(handle, change.name)
    }
    case 'edited': {
      const plan: PendingPlan = {
        workout: change.workout,
        compiled: compile(change.workout),
        changedBy: change.changedBy,
      }
      return (handle) => applyEdit(handle, plan)
    }
    case 'deleted': {
      return (handle) => applyDelete(handle, ops)
    }
  }
}

/**
 * Applies one plan change to every live session that tracks the changed
 * workout. A session that ends between the lookup and the apply is skipped.
 * It has nothing left to update.
 */
export const applyPlanChange = (
  registry: Registry,
  change: PlanChange,
  ops: PlanSyncOps,
): Effect.Effect<void> =>
  Effect.gen(function* () {
    const { tracking } = yield* sessionsOfWorkout(registry, change.workoutId)
    const apply = applierFor(change, ops)
    yield* Effect.forEach(
      tracking,
      (summary) => Effect.flatMap(getHandle(registry, summary.id), apply).pipe(Effect.ignore),
      { discard: true },
    )
  })
