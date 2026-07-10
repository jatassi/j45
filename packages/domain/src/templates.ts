import { compile } from './segments.js'
import { Flow, Pod, Round, Station, Workout, type FlowType } from './workout.js'

/**
 * Structural skeleton for a generated workout: pod/station counts, flow type,
 * and round timings. Placeholder names are applied when materializing into a
 * real `Workout` for duration compilation.
 */
export type WorkoutTemplate = {
  name: string
  /** One entry per pod: how many stations that pod has. */
  podStationCounts: readonly number[]
  flowType: FlowType
  rounds: readonly { workSeconds: number; restSeconds: number }[]
}

const uniform = (
  workSeconds: number,
  restSeconds: number,
  count: number,
): readonly { workSeconds: number; restSeconds: number }[] =>
  Array.from({ length: count }, () => ({ workSeconds, restSeconds }))

/**
 * Catalog of structural templates spanning common session durations.
 *
 * Shapes mirror seed workouts (multi-pod laps, single-pod sets, ladder rounds)
 * with placeholder station counts and timings chosen so compiled durations
 * cover the 15–45 minute band at ±10%.
 */
export const templates: readonly WorkoutTemplate[] = [
  // ~15 min — compact single-pod sets (6 × 2 @ 50/20 → ~825s)
  {
    name: 'compact-sets-6x2',
    podStationCounts: [6],
    flowType: 'sets',
    rounds: uniform(50, 20, 2),
  },
  // ~15 min — small multi-pod laps (2×2 × 3 @ 60/15 → ~890s)
  {
    name: 'compact-laps-2x2x3',
    podStationCounts: [2, 2],
    flowType: 'laps',
    rounds: uniform(60, 15, 3),
  },
  // ~20 min — medium sets (8 × 3 @ 35/15 → ~1190s)
  {
    name: 'medium-sets-8x3',
    podStationCounts: [8],
    flowType: 'sets',
    rounds: uniform(35, 15, 3),
  },
  // ~20 min — multi-pod laps (2×3 × 3 @ 40/20 → ~1065s, edge of 20)
  {
    name: 'medium-laps-2x3x3',
    podStationCounts: [3, 3],
    flowType: 'laps',
    rounds: uniform(40, 25, 3),
  },
  // ~25 min — athletica-style multi-pod laps (3×3 × 3 @ 40/20 → 1605s)
  {
    name: 'athletica-laps-3x3x3',
    podStationCounts: [3, 3, 3],
    flowType: 'laps',
    rounds: uniform(40, 20, 3),
  },
  // ~25 min — panthers-style single-pod sets (9 × 3 @ 40/20 → 1605s)
  {
    name: 'panthers-sets-9x3',
    podStationCounts: [9],
    flowType: 'sets',
    rounds: uniform(40, 20, 3),
  },
  // ~30 min — docklands-style multi-pod ladder laps (3×3 × ladder → 1710s)
  {
    name: 'docklands-laps-ladder',
    podStationCounts: [3, 3, 3],
    flowType: 'laps',
    rounds: [
      { workSeconds: 60, restSeconds: 30 },
      { workSeconds: 30, restSeconds: 15 },
      { workSeconds: 20, restSeconds: 10 },
      { workSeconds: 20, restSeconds: 5 },
    ],
  },
  // ~30 min — two-pod sets (2×3 × 4 @ 45/30 → ~1775s)
  {
    name: 'double-sets-2x3x4',
    podStationCounts: [3, 3],
    flowType: 'sets',
    rounds: uniform(45, 30, 4),
  },
  // ~35 min — three-pod laps (3×4 × 3 @ 40/20 → ~2145s)
  {
    name: 'long-laps-3x4x3',
    podStationCounts: [4, 4, 4],
    flowType: 'laps',
    rounds: uniform(40, 20, 3),
  },
  // ~35 min — medusa-style ascending ladder sets (9 × ladder → ~2180s-ish)
  {
    name: 'medusa-sets-ladder',
    podStationCounts: [9],
    flowType: 'sets',
    rounds: [
      { workSeconds: 20, restSeconds: 10 },
      { workSeconds: 30, restSeconds: 15 },
      { workSeconds: 40, restSeconds: 20 },
      { workSeconds: 50, restSeconds: 25 },
    ],
  },
  // ~40 min — single-pod sets (8 × 4 @ 45/30 → ~2375s)
  {
    name: 'forty-sets-8x4',
    podStationCounts: [8],
    flowType: 'sets',
    rounds: uniform(45, 30, 4),
  },
  // ~40 min — multi-pod laps (2×4 × 4 @ 45/30 → ~2375s)
  {
    name: 'forty-laps-2x4x4',
    podStationCounts: [4, 4],
    flowType: 'laps',
    rounds: uniform(45, 30, 4),
  },
  // ~45 min — three-pod laps (3×4 × 4 @ 40/20 → ~2865s)
  {
    name: 'max-laps-3x4x4',
    podStationCounts: [4, 4, 4],
    flowType: 'laps',
    rounds: uniform(40, 20, 4),
  },
  // ~45 min — wide sets (12 × 4 @ 35/20 → covers 45)
  {
    name: 'max-sets-12x4',
    podStationCounts: [12],
    flowType: 'sets',
    rounds: uniform(40, 20, 4),
  },
]

const materialize = (template: WorkoutTemplate): Workout => {
  const pods = template.podStationCounts.map(
    (stationCount, podIndex) =>
      new Pod({
        name: `Pod ${podIndex + 1}`,
        stations: Array.from(
          { length: stationCount },
          (_, stationIndex) => new Station({ name: `Station ${stationIndex + 1}` }),
        ) as [Station, ...Station[]],
      }),
  ) as [Pod, ...Pod[]]

  return new Workout({
    name: template.name,
    focus: 'hybrid',
    note: 'template placeholder',
    pods,
    flow: new Flow({
      type: template.flowType,
      rounds: template.rounds.map(
        (round) => new Round({ workSeconds: round.workSeconds, restSeconds: round.restSeconds }),
      ) as [Round, ...Round[]],
    }),
  })
}

/**
 * Materialize `template` into a placeholder-named `Workout`, compile it, and
 * return the full session duration in seconds (including the leading ready).
 */
export const templateDurationSeconds = (template: WorkoutTemplate): number => {
  const compiled = compile(materialize(template))
  return compiled.totalDurationMillis / 1000
}
