import { Result, useAtomValue } from '@effect-atom/atom-react'
import type { SessionSummary, WorkoutId } from '@j45/domain'
import * as Effect from 'effect/Effect'
import * as Stream from 'effect/Stream'

import { reconnectDelay, type FeedClient } from '@/lib/reconnect'
import { ServerRpcClient } from '@/lib/rpc-client'

/**
 * The retrying lobby stream. Every element is the whole set of live sessions
 * as the server holds it — the first one on subscribe, then one more per
 * change.
 *
 * The feed the server serves never fails and never stops while the server
 * lives, so a stream that fails or stops here says one thing only: the
 * transport went away. Both outcomes therefore lead to the same place — wait
 * out the backoff, then subscribe again. The fresh first element is complete,
 * so there is nothing to replay and no drift to repair.
 *
 * Failure is deliberately swallowed rather than carried. This is a background
 * feed: home reads a feed that has said nothing as no live sessions, and
 * never as an error that takes over the fold. Reconnection is the same shape
 * the per-session watch feed uses (`lib/session.ts`), on purpose — one
 * approach, not two.
 */
const lobbyFeed = (client: FeedClient, attempt: number): Stream.Stream<readonly SessionSummary[]> =>
  client('WatchActiveSessions', undefined).pipe(
    Stream.catchAll(() => Stream.empty),
    Stream.concat(
      Stream.fromEffect(Effect.sleep(reconnectDelay(attempt))).pipe(
        Stream.flatMap(() => lobbyFeed(client, attempt + 1)),
      ),
    ),
  )

/** Whether the page is in front of the user right now. */
const documentIsVisible = (): boolean => globalThis.document.visibilityState === 'visible'

/**
 * Whether the document is visible, now and on every change.
 *
 * The listener is registered before the first value is read, so a change
 * cannot slip between the two. `changes` drops a repeat, because a
 * `visibilitychange` that does not in fact change the state must not restart
 * the feed.
 *
 * The app watches this transition in two other places already — the player's
 * audio unlock and its wake lock — for the same reason: a phone in a pocket
 * must not be doing work.
 */
const documentVisibility: Stream.Stream<boolean> = Stream.asyncPush<boolean>((emit) =>
  Effect.acquireRelease(
    Effect.sync(() => {
      const listener = (): void => {
        emit.single(documentIsVisible())
      }
      globalThis.document.addEventListener('visibilitychange', listener)
      listener()
      return listener
    }),
    (listener) =>
      Effect.sync(() => {
        globalThis.document.removeEventListener('visibilitychange', listener)
      }),
  ),
).pipe(Stream.changes)

/**
 * The lobby feed as the app consumes it: live while the document is in front
 * of the user, stood down while it is not.
 *
 * A hidden document holds no subscription at all. An always-live feed on
 * every route is a real battery cost on a phone, and there is nobody to show
 * a change to. The switch drops the subscription on hide and takes a fresh
 * one on return, whose first element is the whole set — so what comes back is
 * current, not what the page held when it went away.
 */
const activeSessionsFeed = (client: FeedClient): Stream.Stream<readonly SessionSummary[]> =>
  documentVisibility.pipe(
    Stream.flatMap((visible) => (visible ? lobbyFeed(client, 0) : Stream.never), { switch: true }),
  )

/**
 * The live sessions of the whole server, as one subscription — hoisted to
 * module scope like every other rpc atom in this codebase, so its identity is
 * stable across re-renders.
 *
 * It lives here, outside any component file, because three places read the
 * same set: home (its hero fold), the workout detail screen, and the editor.
 * They share one atom identity and therefore one subscription — a second
 * subscription for the same data could disagree with the first. No component
 * file may export a non-component value either: this project's
 * `react/only-export-components` Fast Refresh guard disallows it.
 *
 * Every lobby row carries the `WorkoutId` it runs, so the host's own client
 * already holds an exact count of the sessions a library write will reach.
 * The confirmation prompts read that count. There is deliberately no rpc for
 * it.
 */
export const activeSessionsAtom = ServerRpcClient.runtime.atom(
  Stream.unwrap(Effect.map(ServerRpcClient, (client) => activeSessionsFeed(client))),
)

/**
 * The live sessions the client holds right now.
 *
 * A feed that has not yet produced a value, and one that is failing, both
 * read as no live sessions. That is the silent downgrade every reader of this
 * set inherits: a background feed must never take over a screen.
 */
export const useActiveSessions = (): readonly SessionSummary[] =>
  Result.getOrElse(useAtomValue(activeSessionsAtom), (): readonly SessionSummary[] => [])

/**
 * How many of these live sessions run this workout.
 *
 * A session launched with a reflow overlay is counted with the others,
 * because the lobby row does not say which sessions those are. For a delete
 * the count is exact: a delete ends every live session of the workout, an
 * overlay one with the rest. For a save it is an upper bound: such a session
 * tracks nothing, so an edit will not in fact reach it. This is the honest
 * limit of a count taken from data the client already has, and the count is
 * never lower than the truth.
 */
export const liveSessionCount = (
  sessions: readonly SessionSummary[],
  workoutId: WorkoutId,
): number => sessions.filter((session) => session.workoutId === workoutId).length

/** `1 live session` / `2 live sessions` — the count with its noun in agreement. */
export const liveSessionPhrase = (count: number): string =>
  `${count} live session${count === 1 ? '' : 's'}`

/**
 * What the host reads before a save goes into a live workout. It says how
 * many sessions receive the change, and when. A running session takes it at
 * the next segment, never in the middle of an interval; a paused one takes it
 * immediately, because there is no interval to protect.
 */
export const liveSaveWarning = (count: number): string =>
  count === 1
    ? '1 live session runs this workout now. It receives your change at the next segment, or immediately if it is paused.'
    : `${liveSessionPhrase(count)} run this workout now. They receive your change at the next segment, or immediately if they are paused.`

/**
 * What the host reads before a delete removes a live workout. This wording is
 * stronger than the save wording on purpose: the action stops other people's
 * workouts immediately, and there is no undo.
 */
export const liveDeleteWarning = (count: number): string =>
  count === 1
    ? '1 live session runs this workout now. If you delete it, that session stops immediately for everyone in it. You cannot undo this.'
    : `${liveSessionPhrase(count)} run this workout now. If you delete it, these sessions stop immediately for everyone in them. You cannot undo this.`

/**
 * How many live sessions run `workoutId` right now, as the caller's client
 * already knows it.
 *
 * A feed that has not answered yet, or one that failed, counts as no live
 * sessions — the same silent downgrade home makes. A confirmation prompt
 * protects the host from a surprise; it must never become the reason a write
 * cannot happen. The trade is deliberate and it has a cost: a host who saves
 * before the first element arrives gets no prompt. Every screen that reads
 * this count subscribes when it mounts, long before the host can finish an
 * edit, so the window is small.
 */
export const useLiveSessionCount = (workoutId: WorkoutId): number =>
  liveSessionCount(useActiveSessions(), workoutId)
