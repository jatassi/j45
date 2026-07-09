import { describe, expect, it } from '@effect/vitest'
import { compile, Workout } from '@j45/domain'
import * as Effect from 'effect/Effect'
import * as Schema from 'effect/Schema'

import {
  apex,
  athletica,
  crossfire,
  docklands,
  hammer,
  medusa,
  miamiNights,
  panthers,
  pipeline,
  redDiamond,
  romans,
  soCal,
} from '../../src/library/seed-workouts.js'

/**
 * The seed fidelity goldens from `docs/designs/plan-library/design.md`:
 * every frozen seed body must decode as a `Workout` and compile to exactly
 * these (works, total-seconds) pairs.
 */
const goldens: readonly {
  readonly name: string
  readonly seed: unknown
  readonly workTotal: number
  readonly totalSeconds: number
}[] = [
  { name: 'Athletica', seed: athletica, workTotal: 27, totalSeconds: 1605 },
  { name: 'Romans', seed: romans, workTotal: 24, totalSeconds: 2120 },
  { name: 'Miami Nights', seed: miamiNights, workTotal: 24, totalSeconds: 1425 },
  { name: 'Panthers', seed: panthers, workTotal: 27, totalSeconds: 1470 },
  { name: 'Docklands', seed: docklands, workTotal: 36, totalSeconds: 1710 },
  { name: 'Red Diamond', seed: redDiamond, workTotal: 36, totalSeconds: 2135 },
  { name: 'Crossfire', seed: crossfire, workTotal: 40, totalSeconds: 2235 },
  { name: 'Hammer', seed: hammer, workTotal: 18, totalSeconds: 1110 },
  { name: 'Pipeline', seed: pipeline, workTotal: 36, totalSeconds: 2145 },
  { name: 'Medusa', seed: medusa, workTotal: 27, totalSeconds: 2180 },
  { name: 'SoCal', seed: soCal, workTotal: 36, totalSeconds: 2155 },
  { name: 'Apex', seed: apex, workTotal: 8, totalSeconds: 2135 },
]

describe('seed workouts', () => {
  it.effect(
    'each of the 12 legacy seeds decodes as a Workout and compiles to its golden (workTotal, totalDurationMillis / 1000)',
    () =>
      Effect.gen(function* () {
        expect(goldens.map((golden) => golden.name)).toStrictEqual([
          'Athletica',
          'Romans',
          'Miami Nights',
          'Panthers',
          'Docklands',
          'Red Diamond',
          'Crossfire',
          'Hammer',
          'Pipeline',
          'Medusa',
          'SoCal',
          'Apex',
        ])

        for (const golden of goldens) {
          const workout = yield* Schema.decodeUnknown(Workout)(golden.seed)
          expect(workout.name).toBe(golden.name)

          const compiled = compile(workout)
          expect({
            name: golden.name,
            workTotal: compiled.workTotal,
            totalSeconds: compiled.totalDurationMillis / 1000,
          }).toStrictEqual({
            name: golden.name,
            workTotal: golden.workTotal,
            totalSeconds: golden.totalSeconds,
          })
        }
      }),
  )
})
