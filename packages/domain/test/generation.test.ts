import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, it } from '@effect/vitest'
import * as Effect from 'effect/Effect'
import * as Either from 'effect/Either'
import * as Schema from 'effect/Schema'
import { expect } from 'vitest'

import { Equipment, Exercise } from '../src/exercise.js'
import { generate, GenerationConstraints, GenerationInfeasible } from '../src/generation.js'
import { compile } from '../src/segments.js'
import { Workout, type Focus } from '../src/workout.js'

const seedPath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../server/src/library/seed-exercises.json',
)
const seedJson: unknown = JSON.parse(readFileSync(seedPath, 'utf8'))
const fullCatalog: readonly Exercise[] = Schema.decodeUnknownSync(Schema.Array(Exercise))(seedJson)

const ALL_EQUIPMENT = Equipment.literals

const baseConstraints = (
  overrides: Partial<{
    focus: Focus
    targetMinutes: number
    equipment: readonly (typeof ALL_EQUIPMENT)[number][]
    emphasis: 'core' | 'glutes' | 'chest' | undefined
    noRepeatSessions: number
    seed: number
  }> = {},
): GenerationConstraints =>
  new GenerationConstraints({
    focus: overrides.focus ?? 'hybrid',
    targetMinutes: overrides.targetMinutes ?? 30,
    equipment: [...(overrides.equipment ?? ALL_EQUIPMENT)],
    ...(overrides.emphasis === undefined ? {} : { emphasis: overrides.emphasis }),
    noRepeatSessions: overrides.noRepeatSessions ?? 0,
    seed: overrides.seed ?? 42,
  })

const expectRight = (result: Either.Either<Workout, GenerationInfeasible>): Workout => {
  expect(Either.isRight(result)).toBe(true)
  if (Either.isLeft(result)) {
    throw new Error(`expected Right, got Left: ${result.left.reason}`)
  }
  return result.right
}

const flattenStations = (workout: Workout) => workout.pods.flatMap((pod) => pod.stations)

const byName = (catalog: readonly Exercise[], name: string): Exercise | undefined =>
  catalog.find((exercise) => exercise.name.toLowerCase() === name.toLowerCase())

describe('generate — determinism', () => {
  it('same inputs yield deeply-equal workouts; different seed differs', () => {
    const constraintsA = baseConstraints({ seed: 1001, targetMinutes: 30 })
    const constraintsB = baseConstraints({ seed: 1001, targetMinutes: 30 })
    const constraintsC = baseConstraints({ seed: 2002, targetMinutes: 30 })

    const a = expectRight(generate(fullCatalog, [], constraintsA))
    const b = expectRight(generate(fullCatalog, [], constraintsB))
    const c = expectRight(generate(fullCatalog, [], constraintsC))

    expect(a).toStrictEqual(b)
    expect(a).not.toStrictEqual(c)
  })
})

describe('generate — schema-decode + compile', () => {
  it.effect('every generated workout round-trips decode and compiles', () =>
    Effect.gen(function* () {
      const focuses: Focus[] = ['cardio', 'strength', 'hybrid']
      for (const focus of focuses) {
        for (const minutes of [15, 30, 45] as const) {
          const workout = expectRight(
            generate(fullCatalog, [], baseConstraints({ focus, targetMinutes: minutes, seed: 7 })),
          )
          const decoded = yield* Schema.decode(Workout)(workout)
          expect(decoded).toStrictEqual(workout)
          expect(() => compile(workout)).not.toThrow()
        }
      }
    }),
  )
})

describe('generate — station validity', () => {
  it('bodyweight exercises qualify under empty allowed equipment', () => {
    const bodyweight = expectRight(
      generate(
        fullCatalog,
        [],
        baseConstraints({
          focus: 'hybrid',
          targetMinutes: 15,
          equipment: [],
          seed: 11,
        }),
      ),
    )
    for (const station of flattenStations(bodyweight)) {
      const source = byName(fullCatalog, station.name)
      expect(source, `missing catalog entry for ${station.name}`).toBeDefined()
      expect(source?.equipment).toEqual([])
      expect(station.detail).toEqual(source?.detail)
    }
  })

  it('stations match focus modality, equipment subset, uniqueness, and detail', () => {
    for (const focus of ['cardio', 'strength', 'hybrid'] as const) {
      const workout = expectRight(
        generate(fullCatalog, [], baseConstraints({ focus, targetMinutes: 25, seed: 22 })),
      )
      const names = flattenStations(workout).map((s) => s.name)
      expect(new Set(names).size).toBe(names.length)

      for (const station of flattenStations(workout)) {
        const source = byName(fullCatalog, station.name)
        expect(source).toBeDefined()
        if (source === undefined) {
          continue
        }
        expect(source.equipment.every((item) => ALL_EQUIPMENT.includes(item))).toBe(true)
        if (focus !== 'hybrid') {
          expect(source.modality).toBe(focus)
        }
        expect(station.detail).toEqual(source.detail)
      }
    }
  })

  it('emphasis filters strength-modality picks to the named muscle group', () => {
    const emphasized = expectRight(
      generate(
        fullCatalog,
        [],
        baseConstraints({
          focus: 'strength',
          targetMinutes: 20,
          emphasis: 'core',
          seed: 33,
        }),
      ),
    )
    for (const station of flattenStations(emphasized)) {
      const source = byName(fullCatalog, station.name)
      expect(source?.modality).toBe('strength')
      expect(source?.muscleGroups).toContain('core')
    }
  })
})

describe('generate — recent-names exclusion', () => {
  it('excludes recent names case-insensitively', () => {
    // Catalog has "Burpee"; list it in a different case.
    const recent = ['bUrPeE', 'ROWER', 'kettlebell swing']
    const workout = expectRight(
      generate(fullCatalog, recent, baseConstraints({ targetMinutes: 30, seed: 55 })),
    )
    const stationNames = flattenStations(workout).map((s) => s.name.toLowerCase())
    for (const name of recent) {
      expect(stationNames).not.toContain(name.toLowerCase())
    }
  })
})

describe('generate — duration coverage', () => {
  it('compiled duration is within ±10% for every 5-min target 15–45', () => {
    for (const minutes of [15, 20, 25, 30, 35, 40, 45] as const) {
      const workout = expectRight(
        generate(
          fullCatalog,
          [],
          baseConstraints({
            focus: 'hybrid',
            targetMinutes: minutes,
            equipment: ALL_EQUIPMENT,
            seed: 90 + minutes,
          }),
        ),
      )
      const compiled = compile(workout)
      const actualMinutes = compiled.totalDurationMillis / 1000 / 60
      const tolerance = minutes * 0.1
      expect(
        Math.abs(actualMinutes - minutes),
        `target ${minutes} min got ${actualMinutes.toFixed(2)}`,
      ).toBeLessThanOrEqual(tolerance)
    }
  })
})

describe('generate — infeasibility, never a throw', () => {
  it('returns Left when equipment empties the pool', () => {
    const tinyCatalog = [
      new Exercise({
        name: 'DB Press',
        modality: 'strength',
        muscleGroups: ['chest'],
        equipment: ['dumbbell'],
        intensity: 'moderate',
      }),
      new Exercise({
        name: 'KB Swing',
        modality: 'strength',
        muscleGroups: ['glutes'],
        equipment: ['kettlebell'],
        intensity: 'moderate',
      }),
    ]
    const result = generate(
      tinyCatalog,
      [],
      baseConstraints({
        focus: 'strength',
        targetMinutes: 15,
        equipment: [],
        seed: 1,
      }),
    )
    expect(Either.isLeft(result)).toBe(true)
    if (Either.isRight(result)) {
      throw new Error('expected Left')
    }
    expect(result.left).toBeInstanceOf(GenerationInfeasible)
    expect(result.left.reason.toLowerCase()).toMatch(/equipment/)
  })

  it('returns Left when recent names starve the pool below station count', () => {
    // 15-min templates need 4–6 stations. Catalog of 8 is enough pre-recent;
    // exclude 5 → 3 left, below every eligible template's station count.
    const smallCatalog = Array.from(
      { length: 8 },
      (_, i) =>
        new Exercise({
          name: `Move ${i + 1}`,
          modality: 'strength',
          muscleGroups: ['core'],
          equipment: [],
          intensity: 'moderate',
        }),
    )
    const recent = ['Move 1', 'Move 2', 'Move 3', 'Move 4', 'Move 5']
    const result = generate(
      smallCatalog,
      recent,
      baseConstraints({
        focus: 'strength',
        targetMinutes: 15,
        equipment: [],
        seed: 2,
      }),
    )
    expect(Either.isLeft(result)).toBe(true)
    if (Either.isRight(result)) {
      throw new Error('expected Left')
    }
    expect(result.left).toBeInstanceOf(GenerationInfeasible)
    expect(result.left.reason.toLowerCase()).toMatch(/recent/)
  })

  it('returns Left when no template fits the target duration', () => {
    const result = generate(fullCatalog, [], baseConstraints({ targetMinutes: 1, seed: 3 }))
    expect(Either.isLeft(result)).toBe(true)
    if (Either.isRight(result)) {
      throw new Error('expected Left')
    }
    expect(result.left).toBeInstanceOf(GenerationInfeasible)
    expect(result.left.reason.toLowerCase()).toMatch(/duration|target|minutes/)
  })
})

describe('generate — codename', () => {
  it('produces a non-empty two-word seed-derived codename', () => {
    const a = expectRight(generate(fullCatalog, [], baseConstraints({ seed: 777 })))
    const b = expectRight(generate(fullCatalog, [], baseConstraints({ seed: 777 })))
    const c = expectRight(generate(fullCatalog, [], baseConstraints({ seed: 778 })))

    expect(a.name.length).toBeGreaterThan(0)
    expect(a.name).toMatch(/^[A-Z][a-z]+ [A-Z][a-z]+$/)
    expect(a.name).toBe(b.name)
    // Different seed almost always yields a different name; if lists collide, stations still differ.
    if (a.name === c.name) {
      expect(a).not.toStrictEqual(c)
    } else {
      expect(a.name).not.toBe(c.name)
    }
  })
})
