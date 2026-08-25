import { randomUUID } from 'node:crypto'

import {
  advanceIfDue,
  nextTransitionAt,
  pause as pauseTimer,
  prev as prevTimer,
  resume as resumeTimer,
  SessionId,
  skip as skipTimer,
  type Participant,
  type Segment,
  type SessionCommand,
  type SessionEnd,
  type SessionNotFound,
  type SessionState,
  type SessionSummary,
  type TimerState,
  type UserId,
  type WorkoutId,
} from '@j45/domain'
import * as Clock from 'effect/Clock'
import * as DateTime from 'effect/DateTime'
import * as Deferred from 'effect/Deferred'
import * as Duration from 'effect/Duration'
import * as Effect from 'effect/Effect'
import * as ExecutionStrategy from 'effect/ExecutionStrategy'
import * as Exit from 'effect/Exit'
import * as HashMap from 'effect/HashMap'
import * as HashSet from 'effect/HashSet'
import * as Option from 'effect/Option'
import * as Queue from 'effect/Queue'
import * as Ref from 'effect/Ref'
import * as Schema from 'effect/Schema'
import * as Scope from 'effect/Scope'
import * as Stream from 'effect/Stream'
import * as SubscriptionRef from 'effect/SubscriptionRef'

import { PlanChanges } from '../library/plan-changes.js'
import {
  completionRowForUser,
  completionRowsForSession,
  CompletionsRepo,
} from './completions-repo.js'
import { lobbyFeed, makeLobby, publishLobby } from './lobby.js'
import { applyPlanChange, snapshotAfterMove } from './plan-sync.js'
import { detachUser, join, leave } from './presence.js'
import {
  completionInputs,
  getHandle,
  initialState,
  listSessions,
  publishSnapshot,
  rememberEnded,
  sessionsOfWorkout,
  summaryOf,
  timersEqual,
  withState,
  type PendingPlan,
  type PresenceEntry,
  type Registry,
  type SessionHandle,
  type StartParams,
  type Sub,
} from './session-state.js'

/**
 * A session with zero raw subscribers for this long is considered abandoned
 * (the host's phone died mid-drive, everyone navigated away) and is garbage
 * collected. Legacy parity: an unattended session must not live forever.
 */
const GC_IDLE: Duration.Duration = Duration.seconds(60)

/** Turns a raw UUID into a branded `SessionId` — every session gets a fresh one. */
const freshSessionId = Schema.decodeSync(SessionId)

// A single serialized read-modify-write over one session's timer. The ticker
// and every command funnel through here, so their writes never interleave. A
// no-op transition (a spurious ticker wakeup, a command that does not apply)
// publishes nothing.
//
// `f` reads the segments off the snapshot rather than off the handle, because
// an applied plan change replaces them: the plan in force and the plan the
// timer moves through are one value.
//
// A move that changes segment is also the boundary a waiting plan change
// asked for, so the published snapshot comes from `snapshotAfterMove`. That
// is also the one timer move a lobby row can see: the released plan carries
// its own workout name. The lobby is therefore republished under the same
// permit — and stays silent for every ordinary advance, because the summary
// it rebuilds says exactly what the last one said.
const applyTimer = (
  registry: Registry,
  handle: SessionHandle,
  f: (timer: TimerState, segments: readonly Segment[], now: number) => TimerState,
): Effect.Effect<void> =>
  handle.sem.withPermits(1)(
    Effect.gen(function* () {
      const now = yield* Clock.currentTimeMillis
      const state = yield* SubscriptionRef.get(handle.stateRef)
      const next = f(state.timer, state.compiled.segments, now)
      if (timersEqual(next, state.timer)) {
        return
      }
      const published = yield* snapshotAfterMove(handle, { state, moved: next, now })
      yield* publishSnapshot(handle, published)
      yield* publishLobby(registry)
      yield* Queue.offer(handle.wakeup, undefined)
    }),
  )

// Ends one session, for the stated reason. Three paths reach here — the
// garbage collector, the last participant leaving, and the deletion of the
// workout the session runs — and `handle.ending` is the single claim token
// that lets exactly one of them through. Two ends would write the rows twice.
//
// The last act is one final snapshot carrying `ended`. Every watcher's stream
// stops on it (see `watch`), so a participant learns that the session is over,
// and why, without asking.
const endSession = (
  registry: Registry,
  handle: SessionHandle,
  reason: SessionEnd,
): Effect.Effect<void> =>
  Effect.gen(function* () {
    if (yield* Ref.getAndSet(handle.ending, true)) {
      return
    }
    // --- session-ended seam -------------------------------------------------
    // A session that progressed past the ready segment leaves history: one
    // `SessionCompletion` per ever-participant (the roster), each with a fresh
    // id, all carrying the same as-run snapshot, host, participants, and span
    // (`completionRowsForSession` mints them). A session that never left the
    // ready segment writes nothing. Teardown (below) runs regardless — a
    // failed insert is logged and swallowed, never blocking the reaper.
    //
    // The rows carry the plan the session last applied while its timer was
    // live, off the handle and its snapshot. Nothing here reads the library,
    // so a deleted workout takes nothing from them.
    const state = yield* SubscriptionRef.get(handle.stateRef)
    if (yield* Ref.get(handle.progressed)) {
      const rows = completionRowsForSession(yield* completionInputs(handle, state))
      yield* Effect.catchAllCause(registry.completionsRepo.insertAll(rows), (cause) =>
        Effect.logError('session completion write failed', cause),
      )
    }
    // The handle leaves the registry, and the ending takes its place in the
    // short record. A participant who was disconnected when this happened
    // finds nothing to watch, and reads the reason from there.
    yield* Ref.update(registry.sessions, HashMap.remove(handle.id))
    yield* rememberEnded(registry, handle.id, reason)
    yield* publishLobby(registry)
    const now = yield* Clock.currentTimeMillis
    // Built on whatever the snapshot holds now, not on `state` above: a
    // ticker advance between the two must not be rolled back by this write.
    yield* SubscriptionRef.update(handle.stateRef, (last) =>
      withState(last, { serverNow: now, ended: reason }),
    )
    yield* Deferred.succeed(handle.ended, undefined)
  })

// Sleep until the current segment's deadline, then advance; idle (no wakeups)
// while paused or done, re-armed by a command via `wakeup`. Because
// `advanceIfDue` chains deadlines, a single long clock jump lands on the
// correct segment, catching up across every boundary crossed.
const ticker = (registry: Registry, handle: SessionHandle): Effect.Effect<void> =>
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
      yield* applyTimer(registry, handle, (timer, segments, at) =>
        advanceIfDue(timer, segments, at),
      )
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
        return yield* endSession(registry, handle, 'closed')
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
    const scope = yield* Scope.fork(registry.layerScope, ExecutionStrategy.sequential)
    const handle: SessionHandle = {
      id,
      host: params.host,
      workoutId: params.workoutId,
      reflowLaunched: params.reflowLaunched,
      workout: yield* Ref.make(params.workout),
      pending: yield* Ref.make(Option.none<PendingPlan>()),
      startedAt,
      stateRef: yield* SubscriptionRef.make(initialState(id, params, now)),
      rawSubs: yield* SubscriptionRef.make(0),
      presence: yield* Ref.make(HashMap.empty<UserId, PresenceEntry>()),
      // Seeded with the host: they count as an ever-participant even if they
      // never open a watch stream themselves.
      roster: yield* Ref.make(HashMap.make([params.host.userId, params.host])),
      departed: yield* Ref.make(HashSet.empty<UserId>()),
      subs: yield* Ref.make(HashMap.empty<number, Sub>()),
      nextSubId: yield* Ref.make(0),
      progressed: yield* Ref.make(false),
      reachedSegment: yield* Ref.make(0),
      ending: yield* Ref.make(false),
      sem: yield* Effect.makeSemaphore(1),
      wakeup: yield* Queue.unbounded<undefined>(),
      ended: yield* Deferred.make<undefined>(),
      scope,
    }
    yield* Ref.update(registry.sessions, HashMap.set(id, handle))
    yield* Effect.forkIn(ticker(registry, handle), scope)
    yield* Effect.forkIn(collect(registry, handle), scope)
    yield* Effect.forkIn(reaper(handle), registry.layerScope)
    yield* publishLobby(registry)
    return yield* summaryOf(handle)
  })

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
      const sub = yield* Effect.acquireRelease(join(registry, handle, participant), (sub) =>
        leave(registry, handle, sub),
      )
      // Two things end this stream:
      //
      // - `sub.interrupt`, when a `leaveSession` detaches this one user. The
      //   deferred is what ends the stream. The filter is what keeps the
      //   snapshot `leaveSession` publishes just after it — the participant
      //   list without the leaver — out of a departed watcher's stream, which
      //   the deferred alone cannot promise: it races that snapshot.
      // - The session's own last snapshot, the one `endSession` publishes with
      //   `ended` set. `takeUntil` emits it and stops. The session-wide `ended`
      //   deferred deliberately does not end this stream: it would race that
      //   snapshot out of the queue, and the loser is the participant, who
      //   would be sent home with no reason.
      const stillAttached = Effect.map(Deferred.isDone(sub.interrupt), (done) => !done)
      return handle.stateRef.changes.pipe(
        Stream.interruptWhenDeferred(sub.interrupt),
        Stream.filterEffect(() => stillAttached),
        Stream.takeUntil((state) => state.ended !== null),
      )
    }),
  )

const command = (
  registry: Registry,
  id: SessionId,
  cmd: SessionCommand,
): Effect.Effect<void, SessionNotFound> =>
  Effect.gen(function* () {
    const handle = yield* getHandle(registry, id)
    yield* applyTimer(registry, handle, (timer, segments, now) => {
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

// Step (1) of a leave: a progressed session writes the leaver one completion
// row now — personal `endedAt`, `progress` from the published timer, and
// `participants` = the roster *before* unrostering, so the row lists the leaver
// among the still-present ever-participants. No row before progression.
const recordLeaver = (
  registry: Registry,
  handle: SessionHandle,
  userId: UserId,
): Effect.Effect<void> =>
  Effect.gen(function* () {
    if (!(yield* Ref.get(handle.progressed))) {
      return
    }
    const state = yield* SubscriptionRef.get(handle.stateRef)
    const rows = completionRowForUser(yield* completionInputs(handle, state), userId)
    yield* Effect.catchAllCause(registry.completionsRepo.insertAll(rows), (cause) =>
      Effect.logError('session completion write failed', cause),
    )
  })

// One participant leaving a session, serialized through the handle's `sem` like
// every other mutation. In order: (1) record the leaver's row; (2) unroster —
// move the leaver from roster to `departed` so a later end never writes them
// again; (3) detach their streams and presence; (4) maybe end — end immediately
// when presence is empty and every ever-participant has departed (empty
// roster), otherwise leave the 60s GC to end it.
const leaveSession = (
  registry: Registry,
  id: SessionId,
  userId: UserId,
): Effect.Effect<void, SessionNotFound> =>
  Effect.flatMap(getHandle(registry, id), (handle) =>
    handle.sem.withPermits(1)(
      Effect.gen(function* () {
        yield* recordLeaver(registry, handle, userId)
        yield* Ref.update(handle.roster, HashMap.remove(userId))
        yield* Ref.update(handle.departed, HashSet.add(userId))
        yield* detachUser(registry, handle, userId)
        const presenceEmpty = HashMap.isEmpty(yield* Ref.get(handle.presence))
        const rosterEmpty = HashMap.isEmpty(yield* Ref.get(handle.roster))
        if (presenceEmpty && rosterEmpty) {
          yield* endSession(registry, handle, 'closed')
        }
      }),
    ),
  )

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
    const recentlyEnded = yield* Ref.make<readonly { id: SessionId; reason: SessionEnd }[]>([])
    const completionsRepo = yield* CompletionsRepo
    const registry: Registry = {
      sessions,
      recentlyEnded,
      layerScope,
      completionsRepo,
      ...(yield* makeLobby),
    }

    // The consuming half of the plan-changed seam. The library announces a
    // change, and this registry applies it to the sessions that run that
    // plan. `library/` has no import of `LiveSessions`.
    const planChanges = yield* PlanChanges
    yield* planChanges.subscribe((change) =>
      applyPlanChange(registry, change, (handle, reason) => endSession(registry, handle, reason)),
    )

    return {
      start: (params: StartParams) => start(registry, params),
      list: () => listSessions(registry),
      lobby: () => lobbyFeed(registry),
      sessionsOfWorkout: (workoutId: WorkoutId) => sessionsOfWorkout(registry, workoutId),
      snapshot: (id: SessionId) => snapshot(registry, id),
      watch: (id: SessionId, participant: Participant) => watch(registry, id, participant),
      command: (id: SessionId, cmd: SessionCommand) => command(registry, id, cmd),
      leaveSession: (id: SessionId, userId: UserId) => leaveSession(registry, id, userId),
    } as const
  }),
}) {}
