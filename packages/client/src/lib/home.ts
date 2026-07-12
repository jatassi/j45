import type { LibraryWorkout, SessionCompletion, SessionSummary } from '@j45/domain'
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
 * Case-insensitive, whitespace-trimmed match of `name` against a library
 * workout's `workout.name`. Returns the matching entry or `undefined`.
 */
export function resolveWorkoutByName(
  name: string,
  workouts: readonly LibraryWorkout[],
): LibraryWorkout | undefined {
  const needle = name.trim().toLowerCase()
  if (needle.length === 0) return undefined
  return workouts.find((entry) => entry.workout.name.trim().toLowerCase() === needle)
}

/**
 * Picks the home hero by priority: live → start-last → browse.
 *
 * - **live**: `sessions` non-empty — newest by `startedAt` is the hero, the
 *   rest are extras; optionally attaches a name-resolved library workout.
 * - **start-last**: no live sessions, history head resolves by name.
 * - **browse**: first library workout, or `undefined` if the library is empty
 *   (never throws). Unresolved history head falls through here too.
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
    const workout = resolveWorkoutByName(session.workoutName, workouts)
    return workout === undefined
      ? { _tag: 'live', session, extras }
      : { _tag: 'live', session, extras, workout }
  }

  if (history.length > 0) {
    const workout = resolveWorkoutByName(history[0].workoutName, workouts)
    if (workout !== undefined) {
      return { _tag: 'start-last', workout }
    }
  }

  return { _tag: 'browse', workout: workouts[0] }
}

/**
 * Up to `count` distinct library workouts for the home recent list: walk
 * `history` in order, resolve each name into the library (skipping misses and
 * duplicates by `WorkoutId`), then pad remaining slots from `workouts` in
 * library order without re-adding anything already included.
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
    const resolved = resolveWorkoutByName(completion.workoutName, workouts)
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
