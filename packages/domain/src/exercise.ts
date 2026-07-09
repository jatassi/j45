import * as Schema from 'effect/Schema'

/** Cardio vs strength — the top-level movement classification. */
export const Modality = Schema.Literal('cardio', 'strength')
export type Modality = typeof Modality.Type

/** Relative effort demand of an exercise. */
export const Intensity = Schema.Literal('low', 'moderate', 'high')
export type Intensity = typeof Intensity.Type

/** Primary muscle targets an exercise loads. */
export const MuscleGroup = Schema.Literal(
  'full-body',
  'glutes',
  'hamstrings',
  'quads',
  'calves',
  'chest',
  'back',
  'shoulders',
  'biceps',
  'triceps',
  'core',
)
export type MuscleGroup = typeof MuscleGroup.Type

/**
 * Kit required for an exercise. An empty equipment list means bodyweight —
 * no separate "bodyweight" literal is needed.
 */
export const Equipment = Schema.Literal(
  'dumbbell',
  'barbell',
  'kettlebell',
  'plate',
  'slam-ball',
  'med-ball',
  'band',
  'cable',
  'bench',
  'box',
  'rower',
  'bike',
  'jump-rope',
  'sliders',
  'pull-up-bar',
  'sandbag',
)
export type Equipment = typeof Equipment.Type

/**
 * A single exercise in the library catalogue. A value object — no identity,
 * no timestamps; those arrive with `LibraryExercise` for persistence.
 * `detail` carries a substitution or setup note as its own field so
 * presentation markup stays the client's job. Empty `equipment` means
 * bodyweight.
 */
export class Exercise extends Schema.Class<Exercise>('Exercise')({
  name: Schema.NonEmptyTrimmedString,
  detail: Schema.optional(Schema.String),
  modality: Modality,
  muscleGroups: Schema.NonEmptyArray(MuscleGroup),
  equipment: Schema.Array(Equipment),
  intensity: Intensity,
}) {}

/**
 * Stable identity of an exercise stored in the library. Distinct from the
 * `Exercise` value object, which has no id of its own.
 */
export const ExerciseId = Schema.String.pipe(Schema.brand('ExerciseId'))
export type ExerciseId = typeof ExerciseId.Type

/**
 * A library entry: an `Exercise` value object plus its persistence identity
 * and timestamps. The domain's unit of storage for the exercise library.
 */
export class LibraryExercise extends Schema.Class<LibraryExercise>('LibraryExercise')({
  id: ExerciseId,
  exercise: Exercise,
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

/** A library lookup or mutation that targeted an unknown `ExerciseId`. */
export class ExerciseNotFound extends taggedError<ExerciseNotFound>()('ExerciseNotFound', {
  id: ExerciseId,
}) {}
