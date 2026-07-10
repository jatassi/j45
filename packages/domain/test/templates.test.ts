import { describe, it } from '@effect/vitest'
import * as Effect from 'effect/Effect'
import * as Schema from 'effect/Schema'
import { expect } from 'vitest'

import { compile } from '../src/segments.js'
import { templateDurationSeconds, templates, type WorkoutTemplate } from '../src/templates.js'
import { Flow, Pod, Round, Station, Workout } from '../src/workout.js'

const TARGET_MINUTES = [15, 20, 25, 30, 35, 40, 45] as const

/** Materialize a template into a real Workout with placeholder names. */
const workoutFromTemplate = (template: WorkoutTemplate): Workout => {
  const pods = template.podStationCounts.map(
    (stationCount, podIndex) =>
      new Pod({
        name: `Pod ${podIndex + 1}`,
        stations: Array.from(
          { length: stationCount },
          (_, i) => new Station({ name: `Station ${i + 1}` }),
        ) as [Station, ...Station[]],
      }),
  ) as [Pod, ...Pod[]]

  return new Workout({
    name: template.name,
    focus: 'hybrid',
    pods,
    flow: new Flow({
      type: template.flowType,
      rounds: template.rounds.map(
        (r) => new Round({ workSeconds: r.workSeconds, restSeconds: r.restSeconds }),
      ) as [Round, ...Round[]],
    }),
  })
}

const isLadder = (template: WorkoutTemplate): boolean => {
  const [first, ...rest] = template.rounds
  if (first === undefined) {
    return false
  }
  return rest.some(
    (r) => r.workSeconds !== first.workSeconds || r.restSeconds !== first.restSeconds,
  )
}

describe('template catalog', () => {
  it.effect('every template materializes to a schema-valid Workout and compiles', () =>
    Effect.gen(function* () {
      expect(templates.length).toBeGreaterThan(0)

      for (const template of templates) {
        const workout = workoutFromTemplate(template)
        const decoded = yield* Schema.decode(Workout)(workout)
        expect(decoded).toStrictEqual(workout)
        expect(() => compile(workout)).not.toThrow()
      }
    }),
  )

  it('covers every target duration within ±10%', () => {
    for (const minutes of TARGET_MINUTES) {
      const targetSeconds = minutes * 60
      const tolerance = targetSeconds * 0.1
      const hit = templates.some((template) => {
        const duration = templateDurationSeconds(template)
        return Math.abs(duration - targetSeconds) <= tolerance
      })
      expect(hit, `no template within ±10% of ${minutes} min (${targetSeconds}s)`).toBe(true)
    }
  })

  it('includes multi-pod laps, sets, and ladder-round shapes', () => {
    const hasMultiPodLaps = templates.some(
      (t) => t.flowType === 'laps' && t.podStationCounts.length > 1,
    )
    const hasSets = templates.some((t) => t.flowType === 'sets')
    const hasLadder = templates.some(isLadder)

    expect(hasMultiPodLaps).toBe(true)
    expect(hasSets).toBe(true)
    expect(hasLadder).toBe(true)
  })
})
