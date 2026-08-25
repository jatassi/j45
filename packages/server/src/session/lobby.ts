import { SessionSummary, type SessionId, type SessionState, type WorkoutId } from '@j45/domain'
import * as Arr from 'effect/Array'
import * as Effect from 'effect/Effect'
import * as Equal from 'effect/Equal'
import * as HashMap from 'effect/HashMap'
import * as Ref from 'effect/Ref'
import * as Stream from 'effect/Stream'
import * as SubscriptionRef from 'effect/SubscriptionRef'

import type { Registry, SessionHandle } from './session-state.js'

/**
 * The lobby: every live session of this server, seen from outside it.
 *
 * One question is answered here in three shapes — the whole listing, the
 * listing of one workout's sessions, and the listing as a feed that a
 * subscriber holds open. All three are derived from the registry and the
 * snapshots the sessions publish. Nothing here holds a second copy of the
 * lobby, so no lobby row can go stale while the session behind it moves.
 */

/**
 * The lobby row for one session, read off the snapshot it last published.
 *
 * Both fields that can move — the workout name and the participant count —
 * come from that one snapshot, so a row can never show a session state that
 * no watcher of the session has seen, and never a half-applied join. The
 * other fields are fixed at launch and live on the handle.
 */
const summaryFrom = (handle: SessionHandle, state: SessionState): SessionSummary =>
  new SessionSummary({
    id: handle.id,
    workoutId: handle.workoutId,
    hostDisplayName: handle.host.displayName,
    workoutName: state.workoutName,
    startedAt: handle.startedAt,
    participantCount: state.participants.length,
  })

/** The lobby row for one session, at its current snapshot. */
export const summaryOf = (handle: SessionHandle): Effect.Effect<SessionSummary> =>
  Effect.map(SubscriptionRef.get(handle.stateRef), (state) => summaryFrom(handle, state))

/**
 * The lobby rows of every live session that `keep` accepts. Both registry
 * queries are this one scan with a different predicate.
 */
const summarize = (
  registry: Registry,
  keep: (handle: SessionHandle) => boolean,
): Effect.Effect<readonly SessionSummary[]> =>
  Effect.flatMap(Ref.get(registry.sessions), (map) =>
    Effect.forEach([...HashMap.values(map)].filter(keep), summaryOf),
  )

/** Every live session on this server, as lobby rows. */
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

/** Two lobby listings that say exactly the same thing. */
const sameLobby = Arr.getEquivalence<SessionSummary>((a, b) => Equal.equals(a, b))

/**
 * Every publish that can move a lobby row, flattened into one signal stream:
 * the live set itself changing — a session started, a session ended — merged
 * with the snapshot publishes of each session in it. A participant joining or
 * leaving, and a rename reaching a running session, are snapshot publishes,
 * which is why the set alone is not enough to watch.
 *
 * Subscribing to a `SubscriptionRef` emits its current value first, so a
 * changed set re-signals once per session that is still live. Each extra
 * signal rebuilds one small listing, and `watchLobby` drops the repeats.
 */
const lobbySignals = (
  handles: HashMap.HashMap<SessionId, SessionHandle>,
): Stream.Stream<unknown> => {
  const signals: readonly Stream.Stream<unknown>[] = [
    Stream.void,
    ...[...HashMap.values(handles)].map((handle) => handle.stateRef.changes),
  ]
  return Stream.mergeAll(signals, { concurrency: 'unbounded' })
}

/**
 * The lobby as a feed: the listing that stands now, then a fresh listing
 * every time one of them moves. This is what a client holds open instead of
 * polling `listSessions`, and its elements are that very function's results,
 * so the two can never disagree.
 *
 * Each listing is rebuilt from the registry rather than patched, so the feed
 * carries no state of its own to fall out of step. A rebuild that says the
 * same thing as the last one is dropped, which is what keeps a ticker advance
 * — the one session publish that no lobby row shows — off the feed.
 *
 * `switch` is what keeps the subscriptions honest: a changed live set drops
 * the previous set's subscriptions and takes the new set's, so an ended
 * session leaves no fiber behind and a started one is watched at once.
 * Everything here is scoped by the stream, so releasing the feed releases all
 * of it, and watching the lobby joins no session — the sessions' own
 * abandonment clocks run exactly as if nobody were watching.
 */
export const watchLobby = (registry: Registry): Stream.Stream<readonly SessionSummary[]> =>
  registry.sessions.changes.pipe(
    Stream.flatMap(lobbySignals, { switch: true }),
    Stream.mapEffect(() => listSessions(registry)),
    Stream.changesWith(sameLobby),
  )
