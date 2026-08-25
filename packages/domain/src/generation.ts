import type { NonEmptyArray } from 'effect/Array'
import * as Either from 'effect/Either'
import * as Schema from 'effect/Schema'

import { Equipment, MuscleGroup, type Exercise } from './exercise.js'
import { taggedError } from './tagged-error.js'
import { templateDurationSeconds, templates, type WorkoutTemplate } from './templates.js'
import { Flow, Focus, Pod, Round, Station, Workout } from './workout.js'

/**
 * The generate form's knobs. `equipment` is the ALLOWED set (an exercise
 * qualifies when its equipment is a subset — empty allowed set means
 * bodyweight-only). `emphasis` filters strength-modality picks to that
 * muscle group. `noRepeatSessions` is N (0 disables). `seed` makes the
 * whole generation deterministic; Regenerate is just a fresh seed.
 */
export class GenerationConstraints extends Schema.Class<GenerationConstraints>(
  'GenerationConstraints',
)({
  focus: Focus,
  targetMinutes: Schema.Int.pipe(Schema.positive()),
  equipment: Schema.Array(Equipment),
  emphasis: Schema.optional(MuscleGroup),
  noRepeatSessions: Schema.Int.pipe(Schema.nonNegative()),
  seed: Schema.Int,
}) {}

/**
 * Constraints starved the pool or no template fits the duration. The
 * reason is human-readable and names the starving constraint.
 */
export class GenerationInfeasible extends taggedError<GenerationInfeasible>()(
  'GenerationInfeasible',
  { reason: Schema.String },
) {}

/** Case-insensitive name normalizer — single shared helper for all name equality. */
const normalizeName = (name: string): string => name.toLowerCase()

/** Mulberry32 PRNG — pure, seeded; never Math.random / Date.now. */
const mulberry32 = (seed: number): (() => number) => {
  // DataView setUint32 wraps to unsigned 32-bit (avoids lint-flagged `>>> 0`).
  const view = new DataView(new ArrayBuffer(4))
  const u32 = (n: number): number => {
    view.setUint32(0, n)
    return view.getUint32(0)
  }
  let state = u32(seed)
  return () => {
    state = u32(state + 0x6d_2b_79_f5)
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return u32(t ^ (t >>> 14)) / 4_294_967_296
  }
}

const ADJECTIVES = [
  'Iron',
  'Silent',
  'Rapid',
  'Steel',
  'Fierce',
  'Crimson',
  'Shadow',
  'Thunder',
  'Frozen',
  'Golden',
  'Bright',
  'Wild',
  'Noble',
  'Swift',
  'Bold',
  'Steady',
] as const

const NOUNS = [
  'Falcon',
  'Titan',
  'Phoenix',
  'Wolf',
  'Comet',
  'Viper',
  'Hammer',
  'Forge',
  'Pulse',
  'Ridge',
  'Storm',
  'Anchor',
  'Spark',
  'Blade',
  'Summit',
  'Circuit',
] as const

const pickCodename = (next: () => number): string => {
  const adj = ADJECTIVES[Math.trunc(next() * ADJECTIVES.length)] ?? ADJECTIVES[0]
  const noun = NOUNS[Math.trunc(next() * NOUNS.length)] ?? NOUNS[0]
  return `${adj} ${noun}`
}

const equipmentAllowed = (exercise: Exercise, allowed: ReadonlySet<Equipment>): boolean =>
  exercise.equipment.every((item) => allowed.has(item))

const modalityMatches = (exercise: Exercise, focus: Focus): boolean => {
  if (focus === 'hybrid') {
    return true
  }
  return exercise.modality === focus
}

const emphasisMatches = (exercise: Exercise, emphasis: MuscleGroup | undefined): boolean => {
  if (emphasis === undefined) {
    return true
  }
  if (exercise.modality !== 'strength') {
    return true
  }
  return exercise.muscleGroups.includes(emphasis)
}

const filterPool = (
  catalog: readonly Exercise[],
  constraints: GenerationConstraints,
): Exercise[] => {
  const allowed = new Set(constraints.equipment)
  return catalog.filter(
    (exercise) =>
      equipmentAllowed(exercise, allowed) &&
      modalityMatches(exercise, constraints.focus) &&
      emphasisMatches(exercise, constraints.emphasis),
  )
}

const subtractRecent = (pool: readonly Exercise[], recentNames: readonly string[]): Exercise[] => {
  if (recentNames.length === 0) {
    return [...pool]
  }
  const recent = new Set(recentNames.map(normalizeName))
  return pool.filter((exercise) => !recent.has(normalizeName(exercise.name)))
}

const durationToleranceOk = (template: WorkoutTemplate, targetMinutes: number): boolean => {
  const minutes = templateDurationSeconds(template) / 60
  const tolerance = targetMinutes * 0.1
  return Math.abs(minutes - targetMinutes) <= tolerance
}

const eligibleTemplates = (targetMinutes: number): WorkoutTemplate[] =>
  templates.filter((template) => durationToleranceOk(template, targetMinutes))

const stationCountOf = (template: WorkoutTemplate): number =>
  template.podStationCounts.reduce((sum, count) => sum + count, 0)

const pickIndex = (length: number, next: () => number): number => Math.trunc(next() * length)

const pickOne = <A>(items: readonly A[], next: () => number): A => {
  const index = pickIndex(items.length, next)
  const item = items[index]
  if (item === undefined) {
    // Caller guarantees non-empty.
    return items[0] as A
  }
  return item
}

/** Sample `count` exercises without replacement via Fisher–Yates partial shuffle. */
const sampleWithoutReplacement = (
  pool: readonly Exercise[],
  count: number,
  next: () => number,
): Exercise[] => {
  const copy = [...pool]
  const picked: Exercise[] = []
  for (let i = 0; i < count; i++) {
    const remaining = copy.length - i
    const j = i + pickIndex(remaining, next)
    const atJ = copy[j]
    const atI = copy[i]
    if (atJ === undefined || atI === undefined) {
      break
    }
    copy[j] = atI
    copy[i] = atJ
    picked.push(atJ)
  }
  return picked
}

const stationFromExercise = (exercise: Exercise): Station =>
  new Station({
    name: exercise.name,
    ...(exercise.detail === undefined ? {} : { detail: exercise.detail }),
  })

const buildPods = (
  template: WorkoutTemplate,
  exercises: readonly Exercise[],
): NonEmptyArray<Pod> => {
  let offset = 0
  const pods = template.podStationCounts.map((count, podIndex) => {
    const slice = exercises.slice(offset, offset + count)
    offset += count
    const stations = slice.map(stationFromExercise) as NonEmptyArray<Station>
    return new Pod({
      name: `Pod ${podIndex + 1}`,
      stations,
    })
  })
  return pods as NonEmptyArray<Pod>
}

type BuildInput = {
  readonly name: string
  readonly focus: Focus
  readonly template: WorkoutTemplate
  readonly exercises: readonly Exercise[]
}

const buildWorkout = ({ name, focus, template, exercises }: BuildInput): Workout =>
  new Workout({
    name,
    focus,
    pods: buildPods(template, exercises),
    flow: new Flow({
      type: template.flowType,
      rounds: template.rounds.map(
        (round) => new Round({ workSeconds: round.workSeconds, restSeconds: round.restSeconds }),
      ) as NonEmptyArray<Round>,
    }),
  })

const poolTooSmallReason = (constrainedSize: number, stationCount: number): string => {
  if (constrainedSize < stationCount) {
    return `Not enough exercises available after the equipment filter (need ${stationCount} stations, have ${constrainedSize})`
  }
  return `Not enough exercises available after excluding recent names (need ${stationCount} stations)`
}

/**
 * Pure rule-based workout generation. Deterministic for a given
 * `catalog` + `recentNames` + `constraints` (including `seed`).
 * Returns `Left(GenerationInfeasible)` when no template fits or the pool
 * cannot fill the chosen template — never throws.
 */
export const generate = (
  catalog: readonly Exercise[],
  recentNames: readonly string[],
  constraints: GenerationConstraints,
): Either.Either<Workout, GenerationInfeasible> => {
  const constrained = filterPool(catalog, constraints)
  const pool = subtractRecent(constrained, recentNames)

  const eligible = eligibleTemplates(constraints.targetMinutes)
  if (eligible.length === 0) {
    return Either.left(
      new GenerationInfeasible({
        reason: `No template fits the target duration of ${constraints.targetMinutes} minutes (±10%)`,
      }),
    )
  }

  const next = mulberry32(constraints.seed)
  const codename = pickCodename(next)
  const template = pickOne(eligible, next)
  const stationCount = stationCountOf(template)

  if (pool.length < stationCount) {
    return Either.left(
      new GenerationInfeasible({
        reason: poolTooSmallReason(constrained.length, stationCount),
      }),
    )
  }

  const picked = sampleWithoutReplacement(pool, stationCount, next)
  return Either.right(
    buildWorkout({
      name: codename,
      focus: constraints.focus,
      template,
      exercises: picked,
    }),
  )
}
