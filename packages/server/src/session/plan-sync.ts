import {
  compile,
  compiledEquals,
  enterSegment,
  remapPaused,
  remapPosition,
  TimerDone,
  Workout,
  type SessionEnd,
  type SessionState,
  type SessionSummary,
  type TimerState,
} from '@j45/domain'
import * as Clock from 'effect/Clock'
import * as Effect from 'effect/Effect'
import * as Either from 'effect/Either'
import * as Option from 'effect/Option'
import * as Ref from 'effect/Ref'
import * as SubscriptionRef from 'effect/SubscriptionRef'

import type { PlanChange } from '../library/plan-changes.js'
import { publishLobby } from './lobby.js'
import {
  getHandle,
  publishSnapshot,
  segmentIndexOf,
  sessionsOfWorkout,
  withState,
  type PendingPlan,
  type Registry,
  type SessionHandle,
  type SessionsOfWorkout,
} from './session-state.js'

/**
 * How a change to a stored plan reaches the live sessions that run it — the
 * consuming half of the `PlanChanges` seam in `library/plan-changes.ts`.
 *
 * Two rules hold for every kind of change, and a new kind must keep both:
 *
 * 1. A *content* change reaches only the sessions that track the workout. A
 *    session launched with a reflow overlay runs a plan the library never
 *    held, so an edit or a rename has nothing to apply to it. A delete is the
 *    one exception, and `targetsOf` states why.
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
 *
 * The lobby row of this session carries the workout name, and a change can
 * move it. The row is therefore republished here, under the same permit, so
 * it can never interleave with a ticker advance. A change that moved no name
 * publishes nothing: `publishLobby` compares before it sends.
 */
const whileLive = (
  registry: Registry,
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
      yield* publishLobby(registry)
    }),
  )

/**
 * Puts a new name on the session snapshot at once. There is no interval to
 * protect, so a name never waits for a segment boundary. The caller holds
 * the semaphore.
 *
 * The snapshot holds the current name. The lobby summary and the completion
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
  state.workoutName === name
    ? Effect.void
    : Effect.flatMap(Clock.currentTimeMillis, (now) =>
        SubscriptionRef.set(
          handle.stateRef,
          withState(state, { serverNow: now, workoutName: name }),
        ),
      )

/**
 * The `RenameWorkout` path: a new name and nothing else.
 *
 * The stored plan carries a name of its own, and a completion row writes
 * both. One row must not hold two names, so the rename reaches the plan as
 * well. Only the name moves: the stations stay as they are, and they stay
 * equal to the compiled plan that the ticker runs.
 */
const applyRename = (
  registry: Registry,
  handle: SessionHandle,
  name: string,
): Effect.Effect<void> =>
  whileLive(registry, handle, (state) =>
    Effect.zipRight(
      publishName(handle, state, name),
      Ref.update(
        handle.workout,
        (workout) =>
          new Workout({
            name,
            focus: workout.focus,
            note: workout.note,
            pods: workout.pods,
            flow: workout.flow,
          }),
      ),
    ),
  )

/**
 * A save that compiles to the plan already in force, put on the session. The
 * caller holds the semaphore.
 *
 * The whole stored plan goes onto the handle, not only its name. `focus` and
 * `note` are on the stored plan and in no compiled segment. A save that
 * corrects one of them therefore arrives here. A completion row carries the
 * whole plan. A row with the corrected name and the old focus holds two
 * versions of one plan, and the name write-through exists to prevent exactly
 * that.
 *
 * The revision does not move, and no notice is raised. Nothing that anybody
 * runs has changed.
 */
const publishStoredPlan = (
  handle: SessionHandle,
  state: SessionState,
  workout: Workout,
): Effect.Effect<void> =>
  Effect.zipRight(Ref.set(handle.workout, workout), publishName(handle, state, workout.name))

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
 * - **The time left.** A running timer takes an absolute deadline anchored on
 *   `now` for the whole of the mapped segment, because chaining anchors on
 *   the previous deadline and the segment now in force has a duration the old
 *   chain knew nothing about. A paused timer takes what `remapPaused`
 *   decides.
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
    const heldIndex = segmentIndexOf(from) ?? 0
    const mapped = remapPosition(state.compiled.segments, heldIndex, segments)
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
          ? remapPaused(from.remainingMillis, state.compiled.segments[heldIndex], {
              index: mapped.right,
              segments,
            })
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
 * whatever the editor sent. Three saves do this, and all must stay quiet: a
 * save that renames the workout and leaves the stations alone, a save that
 * corrects the focus or the note, and a save of content the user did not
 * touch. Each puts the stored plan on the session and raises no notice. The
 * held plan clears with them: the store now holds what the session runs.
 *
 * A paused session is the exception: it waits for nothing, so the edit goes
 * into force here rather than into the hold.
 */
const applyEdit = (
  registry: Registry,
  handle: SessionHandle,
  plan: PendingPlan,
): Effect.Effect<void> =>
  whileLive(registry, handle, (state) => {
    if (compiledEquals(plan.compiled, state.compiled)) {
      return Effect.zipRight(
        Ref.set(handle.pending, Option.none()),
        publishStoredPlan(handle, state, plan.workout),
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
 * Ends one session, for the stated reason.
 *
 * This is the one thing a plan change needs that this module cannot do:
 * ending writes the completion rows and tears the actor down, which
 * `live-sessions.ts` owns. It is passed in rather than imported, so the
 * dependency keeps running one way — `live-sessions.ts` calls into this
 * module, never the reverse.
 */
export type EndSession = (handle: SessionHandle, reason: SessionEnd) => Effect.Effect<void>

/**
 * The `DeleteWorkout` path: the session ends.
 *
 * There is no `whileLive` gate here. A done session takes no more *plan*
 * changes, because its plan is frozen — but a deleted workout leaves no
 * session behind it, done or not.
 *
 * The reason is not the same for both. A session that still runs loses the
 * plan below it, and its participants must be told: `plan-deleted`. A session
 * whose timer already reached the end has nothing left to interrupt. Its
 * participants completed the workout, and they sit on the finished screen. A
 * plan-deleted notice would tell them that their session was cut short, which
 * is not true. That session ends as `closed`.
 *
 * The semaphore is taken like any other mutation, so the end never
 * interleaves with a ticker advance. Ending writes the completion rows from
 * the plan the session last applied while its timer was live; the deleted
 * library row is not read, and the completions table does not reference it.
 */
const applyDelete = (handle: SessionHandle, end: EndSession): Effect.Effect<void> =>
  handle.sem.withPermits(1)(
    Effect.gen(function* () {
      const state = yield* SubscriptionRef.get(handle.stateRef)
      yield* end(handle, state.timer._tag === 'done' ? 'closed' : 'plan-deleted')
    }),
  )

/**
 * What one change does to one session — the `apply…` function for its kind,
 * built once for the whole fan-out. One workout can run in several live
 * sessions at once, and an edit compiles here rather than in each of them, so
 * every session arrives at the very same plan.
 *
 * A new kind of change is a new case here plus its own `apply…` above.
 */
const applierFor = (
  registry: Registry,
  change: PlanChange,
  end: EndSession,
): ((handle: SessionHandle) => Effect.Effect<void>) => {
  switch (change._tag) {
    case 'renamed': {
      return (handle) => applyRename(registry, handle, change.name)
    }
    case 'edited': {
      const plan: PendingPlan = {
        workout: change.workout,
        compiled: compile(change.workout),
        changedBy: change.changedBy,
      }
      return (handle) => applyEdit(registry, handle, plan)
    }
    case 'deleted': {
      return (handle) => applyDelete(handle, end)
    }
  }
}

/**
 * Which live sessions of the changed workout one change reaches.
 *
 * An edit and a rename reach the tracking sessions only. This is the reflow
 * exemption: a session launched with a reflow overlay runs a plan that the
 * library never held, so a change to the library content can never apply to
 * it.
 *
 * A delete reaches every session of the workout. The reflow-launched
 * sessions go with the rest. This difference is deliberate. A reflow session
 * runs an overlay of a plan that is now gone, so it has no source left to
 * follow. A *content* change to that source can never apply to it, but a
 * delete is not a content change. Before the delete, the host is told how
 * many sessions stop. That count comes from lobby rows, and a lobby row does
 * not say which sessions are reflow-launched. A session left running here is
 * thus a session that the host was told would stop.
 */
const targetsOf = (change: PlanChange, sessions: SessionsOfWorkout): readonly SessionSummary[] =>
  change._tag === 'deleted' ? [...sessions.tracking, ...sessions.reflowLaunched] : sessions.tracking

/**
 * Applies one plan change to every live session of the changed workout that
 * the change reaches. A session that ends between the lookup and the apply is
 * skipped. It has nothing left to update.
 */
export const applyPlanChange = (
  registry: Registry,
  change: PlanChange,
  end: EndSession,
): Effect.Effect<void> =>
  Effect.gen(function* () {
    const targets = targetsOf(change, yield* sessionsOfWorkout(registry, change.workoutId))
    const apply = applierFor(registry, change, end)
    yield* Effect.forEach(
      targets,
      (summary) => Effect.flatMap(getHandle(registry, summary.id), apply).pipe(Effect.ignore),
      { discard: true },
    )
  })
