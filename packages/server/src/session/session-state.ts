import {
  CompletionProgress,
  SessionNotFound,
  SessionState,
  SessionSummary,
  type CompiledWorkout,
  type Participant,
  type SessionId,
  type TimerState,
  type UserId,
  type Workout,
} from '@j45/domain'
import type * as DateTime from 'effect/DateTime'
import type * as Deferred from 'effect/Deferred'
import * as Effect from 'effect/Effect'
import * as HashMap from 'effect/HashMap'
import type * as HashSet from 'effect/HashSet'
import * as Option from 'effect/Option'
import type * as Queue from 'effect/Queue'
import * as Ref from 'effect/Ref'
import type * as Scope from 'effect/Scope'
import type * as SubscriptionRef from 'effect/SubscriptionRef'

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
 * `ended` completes every watcher stream and, via the reaper, closes `scope`
 * (which owns the ticker and GC fibers).
 */
export type SessionHandle = {
  readonly id: SessionId
  readonly host: Participant
  readonly workoutName: string
  readonly workout: Workout
  readonly compiled: CompiledWorkout
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
  readonly sem: Effect.Semaphore
  readonly wakeup: Queue.Queue<undefined>
  readonly ended: Deferred.Deferred<undefined>
  readonly scope: Scope.CloseableScope
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
  readonly workoutName: string
  readonly workout: Workout
  readonly compiled: CompiledWorkout
}

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

/** The lobby-listing summary for one session, sized by current presence. */
export const summaryOf = (handle: SessionHandle): Effect.Effect<SessionSummary> =>
  Effect.map(
    Ref.get(handle.presence),
    (map) =>
      new SessionSummary({
        id: handle.id,
        hostDisplayName: handle.host.displayName,
        workoutName: handle.workoutName,
        startedAt: handle.startedAt,
        participantCount: HashMap.size(map),
      }),
  )

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
 * A fresh snapshot with a new `serverNow` plus whichever of `timer` /
 * `participants` the caller overrides — everything else carried from `state`.
 * The two publish paths (a timer advance, a presence change) each vary one.
 */
export const withState = (
  state: SessionState,
  over: {
    readonly serverNow: number
    readonly timer?: TimerState
    readonly participants?: readonly Participant[]
  },
): SessionState =>
  new SessionState({
    id: state.id,
    host: state.host,
    workoutName: state.workoutName,
    compiled: state.compiled,
    timer: over.timer ?? state.timer,
    serverNow: over.serverNow,
    participants: over.participants ?? state.participants,
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
 * Whether a timer state counts as having progressed past the ready segment —
 * any running/paused segment beyond index 0, or a finished workout. A session
 * that only ever sat at the ready segment never progressed.
 */
export const isProgressed = (timer: TimerState): boolean =>
  timer._tag === 'done' ||
  ((timer._tag === 'running' || timer._tag === 'paused') && timer.segmentIndex >= 1)

/**
 * The index of the furthest segment entered for a timer position (the ready
 * segment is `0`). A done workout entered its last segment, so it reports
 * `totalSegments - 1`; `idle` never occurs for a live session but maps to the
 * ready segment for totality.
 */
const furthestSegment = (timer: TimerState, totalSegments: number): number => {
  if (timer._tag === 'running' || timer._tag === 'paused') {
    return timer.segmentIndex
  }
  if (timer._tag === 'done') {
    return Math.max(0, totalSegments - 1)
  }
  return 0
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
