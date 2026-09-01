import * as Schema from 'effect/Schema'

import { taggedError } from './tagged-error.js'

/** Cardio vs strength — the top-level movement classification. */
export const Modality = Schema.Literal('cardio', 'strength')
export type Modality = typeof Modality.Type

export const modalityLabel: Record<Modality, string> = { cardio: 'Cardio', strength: 'Strength' }

/** Relative effort demand of an exercise. */
export const Intensity = Schema.Literal('low', 'moderate', 'high')
export type Intensity = typeof Intensity.Type

export const intensityLabel: Record<Intensity, string> = {
  low: 'Low',
  moderate: 'Moderate',
  high: 'High',
}

/** Primary muscle targets an exercise loads. */
export const MuscleGroup = Schema.Literal(
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

export const muscleGroupLabel: Record<MuscleGroup, string> = {
  glutes: 'Glutes',
  hamstrings: 'Hamstrings',
  quads: 'Quads',
  calves: 'Calves',
  chest: 'Chest',
  back: 'Back',
  shoulders: 'Shoulders',
  biceps: 'Biceps',
  triceps: 'Triceps',
  core: 'Core',
}

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

export const equipmentLabel: Record<Equipment, string> = {
  dumbbell: 'Dumbbells',
  barbell: 'Barbell',
  kettlebell: 'Kettlebell',
  plate: 'Plate',
  'slam-ball': 'Slam ball',
  'med-ball': 'Med ball',
  band: 'Band',
  cable: 'Cable',
  bench: 'Bench',
  box: 'Box',
  rower: 'Rower',
  bike: 'Bike',
  'jump-rope': 'Jump rope',
  sliders: 'Sliders',
  'pull-up-bar': 'Pull-up bar',
  sandbag: 'Sandbag',
}

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

/** A library lookup or mutation that targeted an unknown `ExerciseId`. */
export class ExerciseNotFound extends taggedError<ExerciseNotFound>()('ExerciseNotFound', {
  id: ExerciseId,
}) {}
