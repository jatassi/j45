import { randomUUID } from 'node:crypto'

import {
  advanceIfDue,
  nextTransitionAt,
  pause as pauseTimer,
  prev as prevTimer,
  resume as resumeTimer,
  SessionId,
  SessionNotFound,
  SessionState,
  SessionSummary,
  skip as skipTimer,
  start as startTimer,
  type CompiledWorkout,
  type Participant,
  type SessionCommand,
  type TimerState,
  type UserId,
  type Workout,
} from '@j45/domain'
import * as Clock from 'effect/Clock'
import * as DateTime from 'effect/DateTime'
import * as Deferred from 'effect/Deferred'
import * as Duration from 'effect/Duration'
import * as Effect from 'effect/Effect'
import * as ExecutionStrategy from 'effect/ExecutionStrategy'
import * as Exit from 'effect/Exit'
import * as HashMap from 'effect/HashMap'
import * as Option from 'effect/Option'
import * as Queue from 'effect/Queue'
import * as Ref from 'effect/Ref'
import * as Schema from 'effect/Schema'
import * as Scope from 'effect/Scope'
import * as Stream from 'effect/Stream'
import * as SubscriptionRef from 'effect/SubscriptionRef'

import { completionRowsForSession, CompletionsRepo } from './completions-repo.js'

/**
 * A session with zero raw subscribers for this long is considered abandoned
 * (the host's phone died mid-drive, everyone navigated away) and is garbage
 * collected. Legacy parity: an unattended session must not live forever.
 */
const GC_IDLE: Duration.Duration = Duration.seconds(60)

/** Turns a raw UUID into a branded `SessionId` — every session gets a fresh one. */
const freshSessionId = Schema.decodeSync(SessionId)

/**
 * One user's presence in a session, plus how many live subscriptions they
 * hold. `participants` lists each user once (two tabs = one participant); a
 * user leaves the list only when their *last* subscription releases.
 */
type PresenceEntry = { readonly participant: Participant; readonly count: number }

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
type SessionHandle = {
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
  // Flips true the first time a published timer crosses into segment 1 (past
  // the ready segment) or reaches done; gates whether ending writes any rows.
  readonly progressed: Ref.Ref<boolean>
  readonly sem: Effect.Semaphore
  readonly wakeup: Queue.Queue<undefined>
  readonly ended: Deferred.Deferred<undefined>
  readonly scope: Scope.CloseableScope
}

/** The shared registry every session actor is filed under. */
type Registry = {
  readonly sessions: Ref.Ref<HashMap.HashMap<SessionId, SessionHandle>>
  readonly layerScope: Scope.Scope
  readonly completionsRepo: CompletionsRepo
}

type StartParams = {
  readonly host: Participant
  readonly workoutName: string
  readonly workout: Workout
  readonly compiled: CompiledWorkout
}

/** Structural equality on timer states — used to suppress no-op republishes. */
const timersEqual = (a: TimerState, b: TimerState): boolean => {
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
const withState = (
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

const addPresence =
  (participant: Participant) =>
  (map: HashMap.HashMap<UserId, PresenceEntry>): HashMap.HashMap<UserId, PresenceEntry> => {
    const count = Option.match(HashMap.get(map, participant.userId), {
      onNone: () => 0,
      onSome: (entry) => entry.count,
    })
    return HashMap.set(map, participant.userId, { participant, count: count + 1 })
  }

const removePresence =
  (userId: UserId) =>
  (map: HashMap.HashMap<UserId, PresenceEntry>): HashMap.HashMap<UserId, PresenceEntry> =>
    Option.match(HashMap.get(map, userId), {
      onNone: () => map,
      onSome: (entry) =>
        entry.count <= 1
          ? HashMap.remove(map, userId)
          : HashMap.set(map, userId, { participant: entry.participant, count: entry.count - 1 }),
    })

const participantsOf = (map: HashMap.HashMap<UserId, PresenceEntry>): readonly Participant[] =>
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
const isProgressed = (timer: TimerState): boolean =>
  timer._tag === 'done' ||
  ((timer._tag === 'running' || timer._tag === 'paused') && timer.segmentIndex >= 1)

const getHandle = (
  registry: Registry,
  id: SessionId,
): Effect.Effect<SessionHandle, SessionNotFound> =>
  Effect.flatMap(Ref.get(registry.sessions), (map) =>
    Option.match(HashMap.get(map, id), {
      onNone: () => Effect.fail(new SessionNotFound({ id })),
      onSome: Effect.succeed,
    }),
  )

const summaryOf = (handle: SessionHandle): Effect.Effect<SessionSummary> =>
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

// A single serialized read-modify-write over one session's timer. The ticker
// and every command funnel through here, so their writes never interleave. A
// no-op transition (a spurious ticker wakeup, a command that does not apply)
// publishes nothing.
const applyTimer = (
  handle: SessionHandle,
  f: (timer: TimerState, now: number) => TimerState,
): Effect.Effect<void> =>
  handle.sem.withPermits(1)(
    Effect.gen(function* () {
      const now = yield* Clock.currentTimeMillis
      const state = yield* SubscriptionRef.get(handle.stateRef)
      const next = f(state.timer, now)
      if (timersEqual(next, state.timer)) {
        return
      }
      yield* SubscriptionRef.set(handle.stateRef, withState(state, { serverNow: now, timer: next }))
      if (isProgressed(next)) {
        yield* Ref.set(handle.progressed, true)
      }
      yield* Queue.offer(handle.wakeup, undefined)
    }),
  )

// Recompute the participant list from presence and publish it (with a fresh
// `serverNow`), serialized against timer writes so a command and a join never
// clobber each other.
const republishParticipants = (handle: SessionHandle): Effect.Effect<void> =>
  handle.sem.withPermits(1)(
    Effect.gen(function* () {
      const now = yield* Clock.currentTimeMillis
      const presence = yield* Ref.get(handle.presence)
      const state = yield* SubscriptionRef.get(handle.stateRef)
      yield* SubscriptionRef.set(
        handle.stateRef,
        withState(state, { serverNow: now, participants: participantsOf(presence) }),
      )
    }),
  )

const join = (handle: SessionHandle, participant: Participant): Effect.Effect<void> =>
  Effect.gen(function* () {
    yield* SubscriptionRef.update(handle.rawSubs, (n) => n + 1)
    yield* Ref.update(handle.presence, addPresence(participant))
    // Add-only: a re-set refreshes their display name but never removes them.
    yield* Ref.update(handle.roster, HashMap.set(participant.userId, participant))
    yield* republishParticipants(handle)
  })

const leave = (handle: SessionHandle, userId: UserId): Effect.Effect<void> =>
  Effect.gen(function* () {
    yield* SubscriptionRef.update(handle.rawSubs, (n) => Math.max(0, n - 1))
    yield* Ref.update(handle.presence, removePresence(userId))
    yield* republishParticipants(handle)
  })

const endSession = (registry: Registry, handle: SessionHandle): Effect.Effect<void> =>
  Effect.gen(function* () {
    // --- session-ended seam -------------------------------------------------
    // A session that progressed past the ready segment leaves history: one
    // `SessionCompletion` per ever-participant (the roster), each with a fresh
    // id, all carrying the same as-run snapshot, host, participants, and span
    // (`completionRowsForSession` mints them). A session that never left the
    // ready segment writes nothing. Teardown (below) runs regardless — a
    // failed insert is logged and swallowed, never blocking the reaper.
    if (yield* Ref.get(handle.progressed)) {
      const rows = completionRowsForSession({
        sessionId: handle.id,
        workoutName: handle.workoutName,
        workout: handle.workout,
        host: handle.host,
        participants: [...HashMap.values(yield* Ref.get(handle.roster))],
        startedAt: handle.startedAt,
        endedAt: yield* DateTime.now,
      })
      yield* Effect.catchAllCause(registry.completionsRepo.insertAll(rows), (cause) =>
        Effect.logError('session completion write failed', cause),
      )
    }
    yield* Ref.update(registry.sessions, HashMap.remove(handle.id))
    yield* Deferred.succeed(handle.ended, undefined)
  })

// Sleep until the current segment's deadline, then advance; idle (no wakeups)
// while paused or done, re-armed by a command via `wakeup`. Because
// `advanceIfDue` chains deadlines, a single long clock jump lands on the
// correct segment, catching up across every boundary crossed.
const ticker = (handle: SessionHandle): Effect.Effect<void> =>
  Effect.gen(function* () {
    for (;;) {
      const state = yield* SubscriptionRef.get(handle.stateRef)
      const deadline = nextTransitionAt(state.timer)
      if (Option.isNone(deadline)) {
        yield* Queue.take(handle.wakeup)
        continue
      }
      const now = yield* Clock.currentTimeMillis
      const delay = deadline.value - now
      if (delay > 0) {
        yield* Effect.race(Clock.sleep(Duration.millis(delay)), Queue.take(handle.wakeup))
      }
      yield* applyTimer(handle, (timer, at) => advanceIfDue(timer, handle.compiled.segments, at))
    }
  })

// Wait until this session has no raw subscribers, then start the abandon
// clock: if it stays at zero for `GC_IDLE`, end the session; a resubscribe
// before then cancels and the watch resets.
const collect = (registry: Registry, handle: SessionHandle): Effect.Effect<void> => {
  const awaitCount = (predicate: (n: number) => boolean) =>
    handle.rawSubs.changes.pipe(Stream.filter(predicate), Stream.runHead, Effect.asVoid)
  return Effect.gen(function* () {
    for (;;) {
      yield* awaitCount((n) => n === 0)
      const idledOut = yield* Effect.race(
        Clock.sleep(GC_IDLE).pipe(Effect.as(true)),
        awaitCount((n) => n > 0).pipe(Effect.as(false)),
      )
      if (idledOut) {
        return yield* endSession(registry, handle)
      }
    }
  })
}

// Lives in the layer scope (not the session's), so it can safely close the
// session scope — tearing down the ticker and GC — once the session ends.
const reaper = (handle: SessionHandle): Effect.Effect<void> =>
  Deferred.await(handle.ended).pipe(Effect.zipRight(Scope.close(handle.scope, Exit.void)))

const start = (registry: Registry, params: StartParams): Effect.Effect<SessionSummary> =>
  Effect.gen(function* () {
    const now = yield* Clock.currentTimeMillis
    const startedAt = yield* DateTime.now
    const id = freshSessionId(randomUUID())
    const initial = new SessionState({
      id,
      host: params.host,
      workoutName: params.workoutName,
      compiled: params.compiled,
      timer: startTimer(params.compiled.segments, now),
      serverNow: now,
      participants: [],
    })
    const scope = yield* Scope.fork(registry.layerScope, ExecutionStrategy.sequential)
    const handle: SessionHandle = {
      id,
      host: params.host,
      workoutName: params.workoutName,
      workout: params.workout,
      compiled: params.compiled,
      startedAt,
      stateRef: yield* SubscriptionRef.make(initial),
      rawSubs: yield* SubscriptionRef.make(0),
      presence: yield* Ref.make(HashMap.empty<UserId, PresenceEntry>()),
      // Seeded with the host: they count as an ever-participant even if they
      // never open a watch stream themselves.
      roster: yield* Ref.make(HashMap.make([params.host.userId, params.host])),
      progressed: yield* Ref.make(false),
      sem: yield* Effect.makeSemaphore(1),
      wakeup: yield* Queue.unbounded<undefined>(),
      ended: yield* Deferred.make<undefined>(),
      scope,
    }
    yield* Ref.update(registry.sessions, HashMap.set(id, handle))
    yield* Effect.forkIn(ticker(handle), scope)
    yield* Effect.forkIn(collect(registry, handle), scope)
    yield* Effect.forkIn(reaper(handle), registry.layerScope)
    return yield* summaryOf(handle)
  })

const list = (registry: Registry): Effect.Effect<readonly SessionSummary[]> =>
  Effect.flatMap(Ref.get(registry.sessions), (map) =>
    Effect.forEach([...HashMap.values(map)], summaryOf),
  )

const snapshot = (
  registry: Registry,
  id: SessionId,
): Effect.Effect<SessionState, SessionNotFound> =>
  Effect.flatMap(getHandle(registry, id), (handle) => SubscriptionRef.get(handle.stateRef))

// Subscribing *is* joining: acquiring the stream adds the caller to
// participants, and the scope finalizer removes them even if the socket dies
// mid-stream. The first element is the current snapshot (already carrying the
// joiner), then every change, until the session ends.
const watch = (
  registry: Registry,
  id: SessionId,
  participant: Participant,
): Stream.Stream<SessionState, SessionNotFound> =>
  Stream.unwrapScoped(
    Effect.gen(function* () {
      const handle = yield* getHandle(registry, id)
      yield* Effect.acquireRelease(join(handle, participant), () =>
        leave(handle, participant.userId),
      )
      return handle.stateRef.changes.pipe(Stream.interruptWhenDeferred(handle.ended))
    }),
  )

const command = (
  registry: Registry,
  id: SessionId,
  cmd: SessionCommand,
): Effect.Effect<void, SessionNotFound> =>
  Effect.gen(function* () {
    const handle = yield* getHandle(registry, id)
    if (cmd === 'quit') {
      return yield* endSession(registry, handle)
    }
    const segments = handle.compiled.segments
    yield* applyTimer(handle, (timer, now) => {
      switch (cmd) {
        case 'pause': {
          return pauseTimer(timer, now)
        }
        case 'resume': {
          return resumeTimer(timer, now)
        }
        case 'skip': {
          return skipTimer(timer, segments, now)
        }
        case 'prev': {
          return prevTimer(timer, segments, now)
        }
      }
    })
  })

/**
 * The server-authoritative registry of live workout sessions — one in-memory
 * actor per running session, exactly as the architecture pins it: a
 * `Ref<HashMap<SessionId, handle>>`, each handle a `SubscriptionRef` mutated
 * only through serialized updates plus a ticker fiber owned by the session's
 * `Scope`. Nothing here is persisted: a rebuilt layer is an empty registry,
 * and a server restart drops every live session while durable data is
 * untouched.
 */
export class LiveSessions extends Effect.Service<LiveSessions>()('LiveSessions', {
  scoped: Effect.gen(function* () {
    const layerScope = yield* Effect.scope
    const sessions = yield* Ref.make(HashMap.empty<SessionId, SessionHandle>())
    const completionsRepo = yield* CompletionsRepo
    const registry: Registry = { sessions, layerScope, completionsRepo }

    return {
      start: (params: StartParams) => start(registry, params),
      list: () => list(registry),
      snapshot: (id: SessionId) => snapshot(registry, id),
      watch: (id: SessionId, participant: Participant) => watch(registry, id, participant),
      command: (id: SessionId, cmd: SessionCommand) => command(registry, id, cmd),
    } as const
  }),
}) {}
