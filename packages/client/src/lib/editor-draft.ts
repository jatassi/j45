/**
 * One-shot pending-draft handoff into the new-workout editor.
 *
 * A separate feature (e.g. generation) calls `setInitialDraft` before navigating
 * to `/workouts/new`. `NewWorkoutScreen` consumes via `takeInitialDraft` on
 * mount — one-shot so a later remount sees a blank editor.
 *
 * Intentionally decoupled from generation (and any other producer): this module
 * is only a slot.
 */

import type { Workout } from '@j45/domain'

let pending: Workout | undefined

/** Stash a workout for the next `/workouts/new` mount to seed the editor. */
export const setInitialDraft = (workout: Workout): void => {
  pending = workout
}

/**
 * Consume the pending draft (if any). Clears the slot so a subsequent call
 * returns `undefined`.
 */
export const takeInitialDraft = (): Workout | undefined => {
  const draft = pending
  pending = undefined
  return draft
}
