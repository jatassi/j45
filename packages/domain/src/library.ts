import * as Schema from 'effect/Schema'

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

/**
 * `Schema.TaggedError` itself, referenced through a lowercase alias.
 * `eslint-plugin-unicorn`'s `throw-new-error` rule flags any call whose
 * callee name ends in "Error" as a missing `new` — a known false positive
 * for this exact two-step factory (it already special-cases `Data.TaggedError`
 * for the same reason: sindresorhus/eslint-plugin-unicorn#2654). The alias
 * changes nothing about the factory or the classes it produces below.
 */
const taggedError = Schema.TaggedError

/** A library lookup or mutation that targeted an unknown `WorkoutId`. */
export class WorkoutNotFound extends taggedError<WorkoutNotFound>()('WorkoutNotFound', {
  id: WorkoutId,
}) {}
