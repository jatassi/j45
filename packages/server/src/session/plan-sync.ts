import {
  compile,
  compiledEquals,
  enterSegment,
  enterSegmentPaused,
  remapPosition,
  TimerDone,
  Workout,
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
  publishSnapshot,
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
 * The snapshot holds the current name. The lobby summary and the completion
 * row both read it from there, so all three agree by construction. The
 * stored plan carries a name of its own, and it is written through here for
 * the same reason.
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
    // The stored plan carries a name of its own, and a completion row writes
    // both. One row must not hold two names, so the rename reaches the plan
    // as well. Only the name moves: the stations stay as they are, and they
    // stay equal to the compiled plan that the ticker runs.
    yield* Ref.update(
      handle.workout,
      (workout) =>
        new Workout({
          name,
          focus: workout.focus,
          note: workout.note,
          pods: workout.pods,
          flow: workout.flow,
        }),
    )
  })

/** The `RenameWorkout` path: a new name and nothing else. */
const applyRename = (handle: SessionHandle, name: string): Effect.Effect<void> =>
  whileLive(handle, (state) => publishName(handle, state, name))

/**
 * The snapshot that puts `plan` in force, re-entering it at the position the
 * timer `from` holds. Every path that applies a content edit ends here — a
 * held plan at the moment it is released, and an edit that arrives on a
 * paused session — so all of them land the participant in one place. The
 * hold clears here too, for the same reason.
 *
 * Three things must be right:
 *
 * - **The position.** `remapPosition` keeps the participant at the same work
 *   ordinal, so an edit never returns them to a station they finished.
 * - **The time left.** The timer re-enters the mapped segment with that
 *   segment's whole duration. A running timer takes an absolute deadline
 *   anchored on `now`, because chaining anchors on the previous deadline and
 *   the segment now in force has a duration the old chain knew nothing
 *   about. A paused timer keeps its frozen milliseconds, re-derived the same
 *   way: milliseconds carried across would count down a duration that the
 *   segment now in force never had.
 * - **The end of the plan.** A new plan that no longer reaches this position
 *   has fewer works than the session already ran. A clamp backwards would
 *   replay a finished station, so the session finishes instead.
 *
 * The finish is a plain `done` timer on the plan the session was already
 * running: the same snapshot the last segment of that plan would have
 * produced. Its participants are told nothing, and nothing else moves — the
 * plan, the name and the revision all stay as they are. To everyone
 * watching, the session finished normally.
 *
 * The completion row is the one thing that shows the difference, and it must
 * show it. The row records the plan that the session ran, at the furthest
 * segment that the session published in that plan. That segment is where the
 * participant stopped. It is not the end of the plan. A session that a host
 * trims at the second station of five would otherwise record five stations of
 * five. The screen hides the difference to keep the finish clean. The record
 * must still state it.
 */
const putPlanInForce = (
  handle: SessionHandle,
  args: {
    readonly state: SessionState
    readonly plan: PendingPlan
    readonly from: TimerState
    readonly now: number
  },
): Effect.Effect<SessionState> =>
  Effect.gen(function* () {
    const { from, now, plan, state } = args
    const segments = plan.compiled.segments
    const mapped = remapPosition(state.compiled.segments, segmentIndexOf(from) ?? 0, segments)
    yield* Ref.set(handle.pending, Option.none())
    if (Either.isLeft(mapped)) {
      yield* Effect.logInfo('plan change exhausted the session position').pipe(
        Effect.annotateLogs({ sessionId: handle.id, workIndex: mapped.left.workIndex }),
      )
      return withState(state, { serverNow: now, timer: new TimerDone({}) })
    }
    yield* Ref.set(handle.workout, plan.workout)
    // The furthest segment is counted in the plan in force, so it moves with
    // the plan. A number carried across can name a segment that the new plan
    // does not have, because a shorter plan reaches the same work at a lower
    // index. The completion row would then claim more than its own plan
    // holds.
    yield* Ref.set(handle.reachedSegment, mapped.right)
    return withState(state, {
      serverNow: now,
      compiled: plan.compiled,
      timer:
        from._tag === 'paused'
          ? enterSegmentPaused(mapped.right, segments)
          : enterSegment(mapped.right, segments, now),
      workoutName: plan.workout.name,
      planChange: { revision: state.planRevision + 1, changedBy: plan.changedBy },
    })
  })

/**
 * Puts a plan in force on a paused session and publishes it. The caller
 * holds the semaphore.
 *
 * A paused session runs no interval, so there is no interval to protect and
 * nothing to wait for: the next boundary comes only if somebody resumes, and
 * nobody has to. The change lands now, and the resume that follows counts
 * down the segment it lands in.
 *
 * The published timer needs no wakeup. A paused timer has no deadline, and
 * neither has the `done` an exhausting plan produces, so the ticker has
 * nothing to re-arm on.
 */
const applyWhilePaused = (
  handle: SessionHandle,
  state: SessionState,
  plan: PendingPlan,
): Effect.Effect<void> =>
  Effect.gen(function* () {
    const now = yield* Clock.currentTimeMillis
    const published = yield* putPlanInForce(handle, { state, plan, from: state.timer, now })
    yield* publishSnapshot(handle, published)
  })

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
 *
 * A paused session is the exception: it waits for nothing, so the edit goes
 * into force here rather than into the hold.
 */
const applyEdit = (handle: SessionHandle, plan: PendingPlan): Effect.Effect<void> =>
  whileLive(handle, (state) => {
    if (compiledEquals(plan.compiled, state.compiled)) {
      return Effect.zipRight(
        Ref.set(handle.pending, Option.none()),
        publishName(handle, state, plan.workout.name),
      )
    }
    return state.timer._tag === 'paused'
      ? applyWhilePaused(handle, state, plan)
      : Ref.set(handle.pending, Option.some(plan))
  })

/**
 * Whether a timer move releases a held plan.
 *
 * Two moves do. The first is the segment boundary the plan waited for: the
 * interval it must not cut short is over. The second is a pause, because a
 * paused session runs no interval at all, and the boundary the plan waits
 * for comes only if somebody resumes — which nobody has to do.
 *
 * A resume and a no-op advance both keep the segment, so neither releases
 * anything. Reaching `done` releases nothing either: the plan freezes there.
 */
const releasesHeldPlan = (before: TimerState, after: TimerState): boolean =>
  after._tag === 'paused' ||
  (after._tag === 'running' && segmentIndexOf(after) !== segmentIndexOf(before))

/**
 * The snapshot to publish for one timer move. Usually that is the move
 * alone. When the move releases a held plan, the new plan goes into the
 * snapshot with it, entered at the position the move itself holds.
 *
 * The caller holds the session's semaphore, so this reads and clears
 * `pending` without racing the edit that filled it.
 */
export const snapshotAfterMove = (
  handle: SessionHandle,
  move: { readonly state: SessionState; readonly moved: TimerState; readonly now: number },
): Effect.Effect<SessionState> =>
  Effect.gen(function* () {
    const { moved, now, state } = move
    const pending = yield* Ref.get(handle.pending)
    if (Option.isNone(pending) || !releasesHeldPlan(state.timer, moved)) {
      // A move that ends the session's timer drops the held plan. A done
      // session's plan is frozen, and the completion row must record what
      // was in force while the timer was live.
      //
      // A timer that reaches done here ran out of segments, so the session
      // entered the last segment of the plan in force. The move itself must
      // say so: `advanceIfDue` catches up across every boundary that the
      // clock crossed, so a late wake can reach done without a snapshot for
      // each segment on the way. The plan that a shorter plan exhausts is the
      // other case, and it is deliberately not this one: that session never
      // reached the end, and `putPlanInForce` leaves the mark where the last
      // published snapshot put it.
      if (moved._tag === 'done') {
        yield* Ref.set(handle.pending, Option.none())
        yield* Ref.set(handle.reachedSegment, Math.max(0, state.compiled.segments.length - 1))
      }
      return withState(state, { serverNow: now, timer: moved })
    }
    return yield* putPlanInForce(handle, { state, plan: pending.value, from: moved, now })
  })

/**
 * Ends one session because the workout it runs was deleted.
 *
 * This is the one thing a plan change needs that this module cannot do:
 * ending writes the completion rows and tears the actor down, which
 * `live-sessions.ts` owns. It is passed in rather than imported, so the
 * dependency keeps running one way — `live-sessions.ts` calls into this
 * module, never the reverse.
 */
export type EndForPlanDeleted = (handle: SessionHandle) => Effect.Effect<void>

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
const applyDelete = (handle: SessionHandle, end: EndForPlanDeleted): Effect.Effect<void> =>
  handle.sem.withPermits(1)(end(handle))

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
  end: EndForPlanDeleted,
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
      return (handle) => applyDelete(handle, end)
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
  end: EndForPlanDeleted,
): Effect.Effect<void> =>
  Effect.gen(function* () {
    const { tracking } = yield* sessionsOfWorkout(registry, change.workoutId)
    const apply = applierFor(change, end)
    yield* Effect.forEach(
      tracking,
      (summary) => Effect.flatMap(getHandle(registry, summary.id), apply).pipe(Effect.ignore),
      { discard: true },
    )
  })
