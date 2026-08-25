import * as Schema from 'effect/Schema'

import { taggedError } from './tagged-error.js'
import { Workout } from './workout.js'

/**
 * Stable identity of a workout stored in the library. Distinct from the
 * `Workout` value object, which has no id of its own.
 */
export const WorkoutId = Schema.String.pipe(Schema.brand('WorkoutId'))
export type WorkoutId = typeof WorkoutId.Type

/**
 * A library entry: a `Workout` value object plus its persistence identity
 * and timestamps. The domain's unit of storage for the workout library.
 */
export class LibraryWorkout extends Schema.Class<LibraryWorkout>('LibraryWorkout')({
  id: WorkoutId,
  workout: Workout,
  createdAt: Schema.DateTimeUtc,
  updatedAt: Schema.DateTimeUtc,
}) {}

/** A library lookup or mutation that targeted an unknown `WorkoutId`. */
export class WorkoutNotFound extends taggedError<WorkoutNotFound>()('WorkoutNotFound', {
  id: WorkoutId,
}) {}

/**
 * An `UpdateWorkout` built on a stale read: the row's `updated_at` no longer
 * matches the `updatedAt` the caller carried, so another writer got there
 * first. The optimistic-concurrency precondition that keeps a whole-body
 * replace from silently clobbering someone else's save — there is no merge,
 * the loser re-fetches and re-applies.
 */
export class WorkoutConflict extends taggedError<WorkoutConflict>()('WorkoutConflict', {
  id: WorkoutId,
}) {}
