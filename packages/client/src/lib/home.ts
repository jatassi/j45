import type { LibraryWorkout, SessionCompletion, SessionSummary, WorkoutId } from '@j45/domain'
import * as DateTime from 'effect/DateTime'

import { ServerRpcClient } from '@/lib/rpc-client'

/**
 * Drives `StartSession` from the home hero and recent-list start buttons.
 * Hoisted to module scope like every other rpc atom in this codebase
 * (`listWorkoutsAtom` in `workouts.ts`, passkey atoms on the account screen)
 * so hero and screen share one stable identity without either component file
 * exporting a non-component value — this project's
 * `react/only-export-components` Fast Refresh guard disallows that.
 */
export const startWorkoutAtom = ServerRpcClient.mutation('StartSession')

/**
 * The caller's session completion history (`ListHistory`), hoisted to module
 * scope for the same reason as `startWorkoutAtom` / `listWorkoutsAtom` — the
 * home screen and any sibling that needs history share one atom identity.
 */
export const listHistoryAtom = ServerRpcClient.query('ListHistory', undefined)

/**
 * Priority-picked content for the home hero fold. Live sessions win when any
 * exist; otherwise the most recent completion if it still resolves in the
 * library; otherwise the library head (or `undefined` on an empty library).
 * `home-hero.tsx` / `home-screen.tsx` render against this union.
 */
export type HeroPick =
  | {
      readonly _tag: 'live'
      readonly session: SessionSummary
      readonly extras: readonly SessionSummary[]
      readonly workout?: LibraryWorkout
    }
  | { readonly _tag: 'start-last'; readonly workout: LibraryWorkout }
  | { readonly _tag: 'browse'; readonly workout: LibraryWorkout | undefined }

/**
 * The caller's library entry with this id, or `undefined`. A live session of a
 * different host refers to a workout in *that host's* library. An id that is
 * absent here thus resolves to nothing, and this is the correct result.
 *
 * Identity is the only join Home makes. There is deliberately no fallback to
 * the workout name: names are free text and nothing keeps them unique, so a
 * name match can return a workout the user never chose.
 */
export function resolveWorkoutById(
  id: WorkoutId,
  workouts: readonly LibraryWorkout[],
): LibraryWorkout | undefined {
  return workouts.find((entry) => entry.id === id)
}

/**
 * The library workout one completion came from, or `undefined` when it cannot
 * be resolved — the record carries no identity (written before completions
 * had one), the workout is deleted, or it belongs to another user's library.
 * All three are ordinary, and all three resolve to nothing rather than to a
 * same-named substitute.
 */
function resolveCompletion(
  completion: SessionCompletion,
  workouts: readonly LibraryWorkout[],
): LibraryWorkout | undefined {
  const id = completion.sourceWorkoutId
  return id === undefined ? undefined : resolveWorkoutById(id, workouts)
}

/**
 * Picks the home hero by priority: live → start-last → browse.
 *
 * - **live**: `sessions` non-empty — newest by `startedAt` is the hero, the
 *   rest are extras; attaches the library workout by id. A workout with the
 *   same name is not the same workout.
 * - **start-last**: no live sessions, and some completion resolves to a
 *   workout in the caller's library. The walk goes newest-first and takes the
 *   first that resolves, rather than giving up at the newest: after a session
 *   on someone else's plan the newest records point at a library that is not
 *   the caller's, and the hero must stay useful.
 * - **browse**: first library workout, or `undefined` if the library is empty
 *   (never throws). A history where nothing resolves falls through here too,
 *   so the fold is never dead.
 */
export function pickHero(
  sessions: readonly SessionSummary[],
  history: readonly SessionCompletion[],
  workouts: readonly LibraryWorkout[],
): HeroPick {
  if (sessions.length > 0) {
    const ordered = [...sessions].toSorted(
      (a, b) => DateTime.toEpochMillis(b.startedAt) - DateTime.toEpochMillis(a.startedAt),
    )
    const [session, ...extras] = ordered
    const workout = resolveWorkoutById(session.workoutId, workouts)
    return workout === undefined
      ? { _tag: 'live', session, extras }
      : { _tag: 'live', session, extras, workout }
  }

  for (const completion of history) {
    const workout = resolveCompletion(completion, workouts)
    if (workout !== undefined) {
      return { _tag: 'start-last', workout }
    }
  }

  return { _tag: 'browse', workout: workouts[0] }
}

/**
 * Up to `count` distinct library workouts for the home recent list: walk
 * `history` in order, resolve each completion into the library by identity
 * (skipping misses and duplicates by `WorkoutId`), then pad remaining slots
 * from `workouts` in library order without re-adding anything already
 * included.
 *
 * A completion that resolves to nothing contributes no row. Its Start button
 * could not work, so a row for it would be worse than its absence — and the
 * padding keeps the list full either way.
 */
export function recentRows(
  history: readonly SessionCompletion[],
  workouts: readonly LibraryWorkout[],
  count: number,
): readonly LibraryWorkout[] {
  const rows: LibraryWorkout[] = []
  const seen = new Set<string>()

  for (const completion of history) {
    if (rows.length >= count) break
    const resolved = resolveCompletion(completion, workouts)
    if (resolved === undefined || seen.has(resolved.id)) continue
    seen.add(resolved.id)
    rows.push(resolved)
  }

  for (const entry of workouts) {
    if (rows.length >= count) break
    if (seen.has(entry.id)) continue
    seen.add(entry.id)
    rows.push(entry)
  }

  return rows
}
