import { Result, useAtomValue } from '@effect-atom/atom-react'
import type { SessionSummary, WorkoutId } from '@j45/domain'

import { ServerRpcClient } from '@/lib/rpc-client'

/**
 * Active live sessions (`ListActiveSessions`), hoisted to module scope like
 * every other rpc atom in this codebase — a stable atom identity across
 * re-renders. It lives here, outside any component file, because three
 * screens now read the same list: home (its hero fold and 5s poll), the
 * workout detail screen, and the editor. They must share one atom identity,
 * and no component file may export a non-component value — this project's
 * `react/only-export-components` Fast Refresh guard disallows it.
 *
 * Every lobby row carries the `WorkoutId` it runs, so the host's own client
 * already holds an exact count of the sessions a library write will reach.
 * The confirmation prompts read that count. There is deliberately no rpc for
 * it.
 */
export const listActiveSessionsAtom = ServerRpcClient.query('ListActiveSessions', undefined)

/**
 * How many of these live sessions run this workout.
 *
 * A session launched with a reflow overlay is counted with the others,
 * because the lobby row does not say which sessions those are. Such a session
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
 * A read that has not answered yet, or one that failed, counts as no live
 * sessions — the same silent downgrade home makes. A confirmation prompt
 * protects the host from a surprise; it must never become the reason a write
 * cannot happen. The trade is deliberate and it has a cost: a host who saves
 * before the first answer arrives gets no prompt. Every screen that reads
 * this count starts the read when it mounts, long before the host can finish
 * an edit, so the window is small.
 */
export const useLiveSessionCount = (workoutId: WorkoutId): number => {
  const result = useAtomValue(listActiveSessionsAtom)
  const sessions = Result.getOrElse(result, (): readonly SessionSummary[] => [])
  return liveSessionCount(sessions, workoutId)
}
