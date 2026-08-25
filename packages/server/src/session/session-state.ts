import {
  CompletionProgress,
  SessionNotFound,
  SessionState,
  SessionSummary,
  start as startTimer,
  type CompiledWorkout,
  type Participant,
  type SessionEnd,
  type SessionId,
  type TimerState,
  type UserId,
  type Workout,
  type WorkoutId,
} from '@j45/domain'
import * as DateTime from 'effect/DateTime'
import type * as Deferred from 'effect/Deferred'
import * as Effect from 'effect/Effect'
import * as HashMap from 'effect/HashMap'
import type * as HashSet from 'effect/HashSet'
import * as Option from 'effect/Option'
import type * as Queue from 'effect/Queue'
import * as Ref from 'effect/Ref'
import type * as Scope from 'effect/Scope'
import * as SubscriptionRef from 'effect/SubscriptionRef'

import type { CompletionsRepo } from './completions-repo.js'

/**
 * The session model and the pure, handle-free helpers behind `LiveSessions` —
 * the `SessionHandle`/`Registry` shapes, presence bookkeeping, snapshot
 * rebuilding, and timer-position classification. Kept apart from
 * `live-sessions.ts` so the actor module (registry service, ticker, GC, leave)
 * stays under the line cap.
 */

/**
 * One user's presence in a session, plus how many live subscriptions they
 * hold. `participants` lists each user once (two tabs = one participant); a
 * user leaves the list only when their *last* subscription releases.
 */
export type PresenceEntry = { readonly participant: Participant; readonly count: number }

/**
 * One live `watch` subscription. `active` is the single claim token that keeps
 * a subscription's presence/`rawSubs` decrement exactly-once: whoever flips it
 * from `true` to `false` first (the stream's own release finalizer, or a
 * `leaveSession` detaching the user) owns the decrement; the loser skips it, so
 * a leave followed by the interrupted stream's release never double-decrements.
 * `interrupt` ends this subscription's stream when its user leaves.
 */
export type Sub = {
  readonly id: number
  readonly userId: UserId
  readonly active: Ref.Ref<boolean>
  readonly interrupt: Deferred.Deferred<undefined>
}

/**
 * The in-memory actor for one live session. Its `stateRef` is the single
 * source of truth streamed to watchers; every mutation — commands, ticker
 * advances, presence changes — is serialized through `sem`, so a command and
 * the ticker never interleave a read-modify-write. `wakeup` re-arms the
 * ticker when a command changes the deadline out from under its sleep;
 * `rawSubs` (counting every subscription, not distinct users) drives the GC;
 * `ended` releases the reaper, which closes `scope` (owner of the ticker and
 * GC fibers). It does not stop the watcher streams: they stop on the final
 * snapshot instead, which is the one that says why the session ended.
 */
export type SessionHandle = {
  readonly id: SessionId
  readonly host: Participant
  // The library workout that this session started from, and whether a
  // launch-time reflow overlay changed that workout. A reflow-launched
  // session runs a plan that the library never held. It keeps the id of its
  // source, but it tracks nothing, so `sessionsTracking` omits it.
  readonly workoutId: WorkoutId
  readonly reflowLaunched: boolean
  // The as-run plan: the last plan applied while the timer was still live.
  // A `Ref`, not a value, because a session is a live view of its workout —
  // an applied edit replaces it. The compiled form of the same plan lives on
  // `stateRef` alone, so the snapshot participants hold and the plan the
  // ticker runs are one value and can never disagree. The workout *name* is
  // likewise absent here: `stateRef` holds the one current name that the
  // snapshot, the lobby summary, and any completion row all read.
  readonly workout: Ref.Ref<Workout>
  // A content edit that waits for the next segment boundary. No interval is
  // cut short: an edit stays here until the next timer move that changes
  // segment, and that move puts it in force.
  readonly pending: Ref.Ref<Option.Option<PendingPlan>>
  readonly startedAt: DateTime.Utc
  readonly stateRef: SubscriptionRef.SubscriptionRef<SessionState>
  readonly rawSubs: SubscriptionRef.SubscriptionRef<number>
  readonly presence: Ref.Ref<HashMap.HashMap<UserId, PresenceEntry>>
  // Add-only: every user who ever joined stays, even after they unsubscribe —
  // by design distinct from `presence`, which shrinks on leave. Seeded with
  // the host, grown by `join`, never pruned. Drives who gets a completion row.
  readonly roster: Ref.Ref<HashMap.HashMap<UserId, Participant>>
  // Ever-participants who left explicitly. A roster member moves here on
  // `leaveSession`; a re-`watch` moves them back (join re-rosters and clears
  // the flag). Used only to decide the immediate end: presence empty and
  // roster empty (everyone who ever joined has departed).
  readonly departed: Ref.Ref<HashSet.HashSet<UserId>>
  // Every live subscription, keyed by a monotonic id, so `leaveSession` can
  // find and interrupt exactly the leaver's streams. `nextSubId` mints ids.
  readonly subs: Ref.Ref<HashMap.HashMap<number, Sub>>
  readonly nextSubId: Ref.Ref<number>
  // Flips true the first time a published timer crosses into segment 1 (past
  // the ready segment) or reaches done; gates whether ending writes any rows.
  readonly progressed: Ref.Ref<boolean>
  // The single claim token for ending: whoever flips it from `false` to
  // `true` first owns the end, and every later caller returns at once. The
  // garbage collector, the last leaver, and a deleted workout can all reach
  // the end, and two of them must not write the history rows twice.
  readonly ending: Ref.Ref<boolean>
  readonly sem: Effect.Semaphore
  readonly wakeup: Queue.Queue<undefined>
  readonly ended: Deferred.Deferred<undefined>
  readonly scope: Scope.CloseableScope
}

/**
 * A content edit that is accepted, but not yet in force: it waits for the
 * next segment boundary. `compiled` is built once, when the edit arrives,
 * so the boundary does no work that can be done early.
 */
export type PendingPlan = {
  readonly workout: Workout
  readonly compiled: CompiledWorkout
  /** Who saved the edit, carried onto the snapshot for the notice to name. */
  readonly changedBy: string
}

/** The shared registry every session actor is filed under. */
export type Registry = {
  readonly sessions: Ref.Ref<HashMap.HashMap<SessionId, SessionHandle>>
  readonly layerScope: Scope.Scope
  readonly completionsRepo: CompletionsRepo
}

/** The facts `LiveSessions.start` needs to stand up a fresh session actor. */
export type StartParams = {
  readonly host: Participant
  readonly workoutId: WorkoutId
  readonly reflowLaunched: boolean
  readonly workoutName: string
  readonly workout: Workout
  readonly compiled: CompiledWorkout
}

/**
 * The snapshot a fresh session opens on: the compiled plan it starts from,
 * its timer at the ready segment, nobody present yet, and no plan change
 * applied — so a client that joins at once has nothing to notice.
 */
export const initialState = (id: SessionId, params: StartParams, now: number): SessionState =>
  new SessionState({
    id,
    host: params.host,
    workoutName: params.workoutName,
    compiled: params.compiled,
    timer: startTimer(params.compiled.segments, now),
    serverNow: now,
    participants: [],
    planRevision: 0,
    planChangedBy: null,
    ended: null,
  })

/** The session actor filed under `id`, or `SessionNotFound` if there is none. */
export const getHandle = (
  registry: Registry,
  id: SessionId,
): Effect.Effect<SessionHandle, SessionNotFound> =>
  Effect.flatMap(Ref.get(registry.sessions), (map) =>
    Option.match(HashMap.get(map, id), {
      onNone: () => Effect.fail(new SessionNotFound({ id })),
      onSome: Effect.succeed,
    }),
  )

/**
 * The lobby-listing summary for one session, sized by current presence. The
 * name comes from the published snapshot, so the lobby row and the player
 * show the same name after a rename.
 */
export const summaryOf = (handle: SessionHandle): Effect.Effect<SessionSummary> =>
  Effect.map(
    Effect.all({ presence: Ref.get(handle.presence), state: SubscriptionRef.get(handle.stateRef) }),
    ({ presence, state }) =>
      new SessionSummary({
        id: handle.id,
        workoutId: handle.workoutId,
        hostDisplayName: handle.host.displayName,
        workoutName: state.workoutName,
        startedAt: handle.startedAt,
        participantCount: HashMap.size(presence),
      }),
  )

/**
 * The lobby summaries of every live session that `keep` accepts. Both registry
 * queries are this one scan with a different predicate.
 */
const summarize = (
  registry: Registry,
  keep: (handle: SessionHandle) => boolean,
): Effect.Effect<readonly SessionSummary[]> =>
  Effect.flatMap(Ref.get(registry.sessions), (map) =>
    Effect.forEach([...HashMap.values(map)].filter(keep), summaryOf),
  )

/** Every live session on this server, as lobby summaries. */
export const listSessions = (registry: Registry): Effect.Effect<readonly SessionSummary[]> =>
  summarize(registry, () => true)

/**
 * The live sessions of one library workout, split by what a change to that
 * workout can reach. `tracking` holds the sessions that run the stored plan.
 * `reflowLaunched` holds the sessions that started with a launch-time reflow
 * overlay: they hold the same source id, but their compiled plan was never in
 * the library, so a change to it has nothing to apply to them.
 */
export type SessionsOfWorkout = {
  readonly tracking: readonly SessionSummary[]
  readonly reflowLaunched: readonly SessionSummary[]
}

/**
 * Every live session that started from `workoutId`, in the two groups above.
 * This is the reverse of the source id that each handle holds.
 *
 * A scan of the registry gives the answer. A second map does not hold it: the
 * registry has one entry for each live session, which is a small set, and a
 * derived answer cannot become stale when a session ends.
 */
export const sessionsOfWorkout = (
  registry: Registry,
  workoutId: WorkoutId,
): Effect.Effect<SessionsOfWorkout> =>
  Effect.all({
    tracking: summarize(
      registry,
      (handle) => handle.workoutId === workoutId && !handle.reflowLaunched,
    ),
    reflowLaunched: summarize(
      registry,
      (handle) => handle.workoutId === workoutId && handle.reflowLaunched,
    ),
  })

/**
 * The facts every completion row of one session shares, read at the moment
 * the row is written: the plan and the name last in force while the timer was
 * live, the roster as it stands, and how far the published timer reached.
 * The session end and a single leaver both mint rows from this one reading.
 *
 * The plan comes off the handle and the snapshot, never off the library. A
 * workout that was deleted while the session ran therefore takes nothing away
 * from the rows the session leaves behind.
 */
export const completionInputs = (handle: SessionHandle, state: SessionState) =>
  Effect.gen(function* () {
    return {
      sessionId: handle.id,
      workoutName: state.workoutName,
      workout: yield* Ref.get(handle.workout),
      host: handle.host,
      participants: [...HashMap.values(yield* Ref.get(handle.roster))],
      startedAt: handle.startedAt,
      endedAt: yield* DateTime.now,
      progress: progressOf(state.timer, state.compiled.segments.length),
    } as const
  })

/** Structural equality on timer states — used to suppress no-op republishes. */
export const timersEqual = (a: TimerState, b: TimerState): boolean => {
  if (a._tag !== b._tag) {
    return false
  }
  if (a._tag === 'running' && b._tag === 'running') {
    return a.segmentIndex === b.segmentIndex && a.endsAtMillis === b.endsAtMillis
  }
  if (a._tag === 'paused' && b._tag === 'paused') {
    return a.segmentIndex === b.segmentIndex && a.remainingMillis === b.remainingMillis
  }
  return true
}

/**
 * A fresh snapshot with a new `serverNow` plus whichever fields the caller
 * overrides — everything else carried from `state`. A timer advance varies
 * `timer`; a presence change varies `participants`; a rename varies
 * `workoutName`; an applied content edit varies the rest together.
 */
export const withState = (
  state: SessionState,
  over: {
    readonly serverNow: number
    readonly timer?: TimerState
    readonly participants?: readonly Participant[]
    readonly workoutName?: string
    readonly compiled?: CompiledWorkout
    // The two plan-change fields travel together or not at all, so a
    // snapshot can never say "changed by nobody" at a raised revision.
    readonly planChange?: { readonly revision: number; readonly changedBy: string }
    // Set once, on the last snapshot a session ever publishes.
    readonly ended?: SessionEnd
  },
): SessionState =>
  new SessionState({
    id: state.id,
    host: state.host,
    workoutName: over.workoutName ?? state.workoutName,
    compiled: over.compiled ?? state.compiled,
    timer: over.timer ?? state.timer,
    serverNow: over.serverNow,
    participants: over.participants ?? state.participants,
    // Carried, never derived: a join, a leave, and a timer advance all
    // republish the snapshot, and none of them is a plan change.
    planRevision: over.planChange?.revision ?? state.planRevision,
    planChangedBy: over.planChange?.changedBy ?? state.planChangedBy,
    // Carried, so no ordinary republish can revive an ended session.
    ended: over.ended ?? state.ended,
  })

export const addPresence =
  (participant: Participant) =>
  (map: HashMap.HashMap<UserId, PresenceEntry>): HashMap.HashMap<UserId, PresenceEntry> => {
    const count = Option.match(HashMap.get(map, participant.userId), {
      onNone: () => 0,
      onSome: (entry) => entry.count,
    })
    return HashMap.set(map, participant.userId, { participant, count: count + 1 })
  }

export const removePresence =
  (userId: UserId) =>
  (map: HashMap.HashMap<UserId, PresenceEntry>): HashMap.HashMap<UserId, PresenceEntry> =>
    Option.match(HashMap.get(map, userId), {
      onNone: () => map,
      onSome: (entry) =>
        entry.count <= 1
          ? HashMap.remove(map, userId)
          : HashMap.set(map, userId, { participant: entry.participant, count: entry.count - 1 }),
    })

export const participantsOf = (
  map: HashMap.HashMap<UserId, PresenceEntry>,
): readonly Participant[] =>
  [...HashMap.values(map)]
    .map((entry) => entry.participant)
    .sort((a, b) =>
      a.displayName === b.displayName
        ? a.userId.localeCompare(b.userId)
        : a.displayName.localeCompare(b.displayName),
    )

/**
 * The segment a timer sits in, or `undefined` when it is idle or done. The
 * one place that reads a segment index off a timer state.
 */
export const segmentIndexOf = (timer: TimerState): number | undefined =>
  timer._tag === 'running' || timer._tag === 'paused' ? timer.segmentIndex : undefined

/**
 * Whether a timer state counts as having progressed past the ready segment —
 * any running/paused segment beyond index 0, or a finished workout. A session
 * that only ever sat at the ready segment never progressed.
 */
export const isProgressed = (timer: TimerState): boolean =>
  timer._tag === 'done' || (segmentIndexOf(timer) ?? 0) >= 1

/**
 * The index of the furthest segment entered for a timer position (the ready
 * segment is `0`). A done workout entered its last segment, so it reports
 * `totalSegments - 1`; `idle` never occurs for a live session but maps to the
 * ready segment for totality.
 */
const furthestSegment = (timer: TimerState, totalSegments: number): number => {
  const segmentIndex = segmentIndexOf(timer)
  if (segmentIndex !== undefined) {
    return segmentIndex
  }
  return timer._tag === 'done' ? Math.max(0, totalSegments - 1) : 0
}

/**
 * The furthest-segment progress a completion row records for a given timer
 * position — `segmentsCompleted` as the furthest segment entered against the
 * as-run workout's `totalSegments` segment count.
 */
export const progressOf = (timer: TimerState, totalSegments: number): CompletionProgress =>
  new CompletionProgress({
    segmentsCompleted: furthestSegment(timer, totalSegments),
    totalSegments,
  })
