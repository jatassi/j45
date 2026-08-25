import {
  CompletionProgress,
  SessionNotFound,
  SessionState,
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
  // ticker runs are one value and can never disagree. `stateRef` holds the
  // one current name that the snapshot, the lobby summary, and a completion
  // row all read; a rename writes it through to the name on this plan too,
  // because a completion row carries both and must not hold two names.
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
  // The furthest segment that a published snapshot entered, counted in the
  // plan now in force. A completion row records it as progress.
  //
  // The final timer does not give this number. A `done` timer holds no
  // segment index. A plan that exhausts the session sets `done` before the
  // participant reached the end of the plan that the row records. Only a
  // published position counts here. An intermediate move that a plan change
  // replaced was never on a screen.
  //
  // An applied plan change sets this to the segment that the remap gives, so
  // the number always names a segment of the plan that it is counted in.
  readonly reachedSegment: Ref.Ref<number>
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

/**
 * How many endings the server remembers after the sessions themselves are
 * gone.
 *
 * The bound is a count, not an age. A count needs no clock and no sweeper
 * fiber, and it gives an exact ceiling on the memory the record can hold. An
 * age bound gives no such ceiling: between two reads the record can still
 * take any number of endings.
 *
 * The record has one reader: a participant who retries a watch some seconds
 * after the session ended, because the connection was lost. At the scale this
 * server runs, 64 endings are much more than such a window holds.
 */
export const RECENTLY_ENDED_LIMIT = 64

/** One session that ended, and why. */
type EndedSession = { readonly id: SessionId; readonly reason: SessionEnd }

/** The shared registry every session actor is filed under. */
export type Registry = {
  // A `SubscriptionRef`, not a plain `Ref`, so the lobby feed can watch the
  // live set change. Every existing `Ref` operation still reads and writes it;
  // the only difference is that a write is also published.
  readonly sessions: SubscriptionRef.SubscriptionRef<HashMap.HashMap<SessionId, SessionHandle>>
  // The last `RECENTLY_ENDED_LIMIT` endings, newest first. A session that
  // ends leaves the registry, so nothing about it can be read off a handle
  // any more; this is what a lookup of a gone session answers from.
  readonly recentlyEnded: Ref.Ref<readonly EndedSession[]>
  readonly layerScope: Scope.Scope
  readonly completionsRepo: CompletionsRepo
}

/**
 * Puts one ending into the short record, and drops the oldest to stay inside
 * the bound. The caller is the code that removes the session from the
 * registry, so the two moves are one act. A session is live, or remembered,
 * but never both.
 */
export const rememberEnded = (
  registry: Registry,
  id: SessionId,
  reason: SessionEnd,
): Effect.Effect<void> =>
  Ref.update(registry.recentlyEnded, (recent) =>
    [{ id, reason }, ...recent].slice(0, RECENTLY_ENDED_LIMIT),
  )

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

/**
 * The session actor filed under `id`, or `SessionNotFound` if there is none.
 *
 * The failure carries why that session ended, when the short record still
 * holds it. Every path that looks a session up — a watch, a command, a leave —
 * therefore tells a caller as much as the server can still say, rather than
 * only that the session is gone.
 */
export const getHandle = (
  registry: Registry,
  id: SessionId,
): Effect.Effect<SessionHandle, SessionNotFound> =>
  Effect.flatMap(Ref.get(registry.sessions), (map) =>
    Option.match(HashMap.get(map, id), {
      onNone: () =>
        Effect.flatMap(Ref.get(registry.recentlyEnded), (recent) =>
          Effect.fail(
            new SessionNotFound({
              id,
              endedAs: recent.find((ended) => ended.id === id)?.reason ?? null,
            }),
          ),
        ),
      onSome: Effect.succeed,
    }),
  )

/**
 * The facts every completion row of one session shares, read at the moment
 * the row is written: the plan and the name last in force while the timer was
 * live, the roster as it stands, and how far the published timer reached.
 * The session end and a single leaver both mint rows from this one reading.
 *
 * The plan comes off the handle and the snapshot, never off the library. A
 * workout that was deleted while the session ran therefore takes nothing away
 * from the rows the session leaves behind.
 *
 * `sourceWorkoutId` is not a plan. It is the identity of the library workout
 * this session started from, held on the handle since launch. The id is the
 * host's. A guest's row thus holds an id that resolves to nothing in their own
 * library. That is the true answer, and it is why a reader must join on the
 * id and not on the name.
 *
 * Progress is counted in that same plan. The total is the segment count of
 * the plan, and the position is the furthest segment that the session
 * published while it ran that plan. Both numbers come from one plan, so
 * "segment N of M" has one meaning.
 */
export const completionInputs = (handle: SessionHandle, state: SessionState) =>
  Effect.gen(function* () {
    return {
      sessionId: handle.id,
      workoutName: state.workoutName,
      sourceWorkoutId: handle.workoutId,
      workout: yield* Ref.get(handle.workout),
      host: handle.host,
      participants: [...HashMap.values(yield* Ref.get(handle.roster))],
      startedAt: handle.startedAt,
      endedAt: yield* DateTime.now,
      progress: yield* progressOf(
        handle.id,
        yield* Ref.get(handle.reachedSegment),
        state.compiled.segments.length,
      ),
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
 * Publishes one snapshot to the watchers, with the bookkeeping that every
 * published timer move needs. A timer that left the ready segment, or that
 * finished, sets `progressed`, and that flag alone decides whether the
 * session leaves any history behind. A timer that holds a segment index
 * raises `reachedSegment`, which is the progress that history records.
 *
 * The caller holds the session's semaphore. It also owns the ticker wakeup:
 * only a move that changes the deadline needs one.
 */
export const publishSnapshot = (handle: SessionHandle, state: SessionState): Effect.Effect<void> =>
  Effect.gen(function* () {
    yield* SubscriptionRef.set(handle.stateRef, state)
    if (isProgressed(state.timer)) {
      yield* Ref.set(handle.progressed, true)
    }
    const segmentIndex = segmentIndexOf(state.timer)
    if (segmentIndex !== undefined) {
      yield* Ref.update(handle.reachedSegment, (furthest) => Math.max(furthest, segmentIndex))
    }
  })

/**
 * The progress that a completion row records: how far the session got,
 * counted in the plan that the row carries. `reachedSegment` is the furthest
 * segment that the session published (the ready segment is `0`).
 * `totalSegments` is the segment count of that same plan.
 *
 * The clamp guards an invariant, and it must never do work. Every plan that
 * comes into force sets `reachedSegment` to a segment of itself, so the two
 * numbers always agree. If they do not, the state is a defect: the row would
 * name a segment that its own plan does not hold. The defect is logged as an
 * error, and the row is still written with a clamped count — a participant
 * must not lose the record of a session because a count was wrong.
 */
const progressOf = (
  sessionId: SessionId,
  reachedSegment: number,
  totalSegments: number,
): Effect.Effect<CompletionProgress> =>
  Effect.gen(function* () {
    const segmentsCompleted = Math.max(0, Math.min(reachedSegment, totalSegments - 1))
    if (segmentsCompleted !== reachedSegment) {
      yield* Effect.logError('completion progress fell outside the plan it is counted in').pipe(
        Effect.annotateLogs({ sessionId, reachedSegment, totalSegments }),
      )
    }
    return new CompletionProgress({ segmentsCompleted, totalSegments })
  })
