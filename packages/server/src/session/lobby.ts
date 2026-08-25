import type { SessionSummary } from '@j45/domain'
import * as Arr from 'effect/Array'
import * as DateTime from 'effect/DateTime'
import * as Effect from 'effect/Effect'
import * as Equal from 'effect/Equal'
import * as Order from 'effect/Order'
import type * as Stream from 'effect/Stream'
import * as SubscriptionRef from 'effect/SubscriptionRef'

import { listSessions, type Registry } from './session-state.js'

/**
 * The lobby feed: what the whole set of live sessions looks like, and every
 * change to it.
 *
 * The registry itself cannot answer this. It is a map of handles, so wrapping
 * it in a subscription reference would announce a session appearing and a
 * session disappearing and nothing else — a lobby row would freeze at the
 * participant count and the workout name it opened with. The feed therefore
 * carries the whole snapshot, and every mutation that a summary can see
 * republishes it: a start, an end, a join, a leave, and a new workout name —
 * whether the name arrives with a rename or with a held edit that comes into
 * force at a segment boundary.
 *
 * A whole snapshot rather than a diff is deliberate. It is the shape a
 * subscriber needs on its first value anyway, so one shape serves both the
 * opening and every change, and a subscriber that reconnects heals from the
 * next frame with nothing to replay. The set is small — one entry per live
 * session — so there is nothing to save by sending less.
 *
 * A timer advance is deliberately not a publish. Nothing on a summary moves
 * with the timer, so an ordinary advance rebuilds the same snapshot and sends
 * nothing.
 */

/** The registry fields the feed is published through. */
export const makeLobby: Effect.Effect<Pick<Registry, 'lobby' | 'lobbySem'>> = Effect.gen(
  function* () {
    return {
      lobby: yield* SubscriptionRef.make<readonly SessionSummary[]>([]),
      lobbySem: yield* Effect.makeSemaphore(1),
    }
  },
)

/**
 * Whether two snapshots say the same thing. Summaries are schema classes, so
 * this is structural equality, field by field.
 */
const sameRows = (a: readonly SessionSummary[], b: readonly SessionSummary[]): boolean =>
  a.length === b.length && a.every((row, index) => Equal.equals(row, b[index]))

/**
 * The order every snapshot is built in — oldest session first, then by id.
 *
 * The order is fixed rather than left to the registry map, for two reasons.
 * A subscriber gets one list, so the list must not reshuffle under it when an
 * unrelated session ends. And two snapshots can only be compared for equality
 * if equal content gives equal order — which is what stops a republish that
 * changed nothing from reaching every subscriber.
 */
const oldestFirst: Order.Order<SessionSummary> = Order.combine(
  Order.mapInput(Order.number, (row: SessionSummary) => DateTime.toEpochMillis(row.startedAt)),
  Order.mapInput(Order.string, (row: SessionSummary) => row.id),
)

/** The lobby as it stands. */
const rowsNow = (registry: Registry): Effect.Effect<readonly SessionSummary[]> =>
  Effect.map(listSessions(registry), (rows) => Arr.sort(rows, oldestFirst))

/**
 * Rebuilds the lobby snapshot and publishes it, unless it says exactly what
 * the last one said.
 *
 * Every caller already holds the semaphore of the session it changed, so a
 * publish can never interleave with a ticker advance on that session. The
 * lobby's own semaphore is the second half: it makes rebuild-compare-publish
 * one step, so two sessions changing at once cannot publish out of order or
 * lose one of the two changes. The lock order is always the session's
 * semaphore first and the lobby's second, and nothing takes them the other
 * way round.
 */
export const publishLobby = (registry: Registry): Effect.Effect<void> =>
  registry.lobbySem.withPermits(1)(
    Effect.gen(function* () {
      const next = yield* rowsNow(registry)
      const last = yield* SubscriptionRef.get(registry.lobby)
      if (sameRows(last, next)) {
        return
      }
      yield* SubscriptionRef.set(registry.lobby, next)
    }),
  )

/**
 * One subscription to the feed: the lobby as it stands, then every change,
 * for as long as the subscriber holds it.
 *
 * The snapshot and the subscription are taken as one step, so a change can
 * neither be missed between the two nor arrive twice. Releasing the
 * subscription drops the queue behind it and leaves nothing in the registry:
 * subscribers are not registered anywhere that a session can see.
 */
export const lobbyFeed = (registry: Registry): Stream.Stream<readonly SessionSummary[]> =>
  registry.lobby.changes
