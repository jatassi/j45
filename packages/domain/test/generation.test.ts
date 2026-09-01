import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, it } from '@effect/vitest'
import * as Effect from 'effect/Effect'
import * as Either from 'effect/Either'
import * as Schema from 'effect/Schema'
import { expect } from 'vitest'

import { Equipment, Exercise, MuscleGroup } from '../src/exercise.js'
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
    emphasis: readonly [MuscleGroup, ...MuscleGroup[]] | undefined
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

/**
 * The catalog exercise behind every station of a workout. A station is free
 * text and holds no muscle groups of its own, so an emphasis assertion has to
 * resolve the name back to the exercise it came from.
 */
const sourcesOf = (workout: Workout, catalog: readonly Exercise[]): Exercise[] =>
  flattenStations(workout).map((station) => {
    const source = byName(catalog, station.name)
    if (source === undefined) {
      throw new Error(`missing catalog entry for ${station.name}`)
    }
    return source
  })

const carriesAny = (exercise: Exercise, groups: ReadonlySet<MuscleGroup>): boolean =>
  exercise.muscleGroups.some((group) => groups.has(group))

/** A bodyweight strength exercise for the hand-made catalogs below. */
const strengthExercise = (name: string, group: MuscleGroup): Exercise =>
  new Exercise({
    name,
    modality: 'strength',
    muscleGroups: [group],
    equipment: [],
    intensity: 'moderate',
  })

/** The seed-catalog strength generation that the emphasis cases repeat. */
const generateEmphasized = (
  emphasis: readonly [MuscleGroup, ...MuscleGroup[]],
  seed: number,
): Either.Either<Workout, GenerationInfeasible> =>
  generate(
    fullCatalog,
    [],
    baseConstraints({ focus: 'strength', targetMinutes: 30, emphasis, seed }),
  )

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

  it('a strength pick qualifies when it carries at least one emphasis group', () => {
    const emphasized = expectRight(generateEmphasized(['core', 'chest'], 33))
    const selected = new Set<MuscleGroup>(['core', 'chest'])
    for (const source of sourcesOf(emphasized, fullCatalog)) {
      expect(source.modality).toBe('strength')
      // The rule is a union, and not an intersection: one group is enough.
      expect(carriesAny(source, selected)).toBe(true)
    }
  })

  it('a non-strength pick bypasses the emphasis filter and may carry no selected group', () => {
    const selected = new Set<MuscleGroup>(['calves'])
    const mixed = expectRight(
      generate(
        fullCatalog,
        [],
        baseConstraints({
          focus: 'hybrid',
          targetMinutes: 20,
          emphasis: ['calves'],
          seed: 44,
        }),
      ),
    )
    const sources = sourcesOf(mixed, fullCatalog)
    for (const source of sources) {
      if (source.modality === 'strength') {
        expect(carriesAny(source, selected)).toBe(true)
      }
    }
    // The bypass is real, and not merely permitted: the seed catalog holds one
    // calves-tagged strength exercise, so the rest of this workout is cardio
    // that carries no selected group at all.
    expect(
      sources.some((source) => source.modality !== 'strength' && !carriesAny(source, selected)),
    ).toBe(true)
  })
})

describe('generate — emphasis widens, and never balances', () => {
  it('adding a group never turns a feasible generation infeasible', () => {
    // `calves` carries a single strength exercise in the seed catalog, so a
    // one-group emphasis can still starve the pool. Adding `glutes` widens it.
    expect(Either.isLeft(generateEmphasized(['calves'], 66))).toBe(true)
    expectRight(generateEmphasized(['calves', 'glutes'], 66))

    // The guarantee is about every group, and not only about that pair: a
    // feasible one-group emphasis stays feasible when a second group joins it.
    let widenings = 0
    for (const group of MuscleGroup.literals) {
      // Never the same group twice: `[quads, quads]` widens nothing.
      const added: MuscleGroup = group === 'quads' ? 'chest' : 'quads'
      for (const seed of [1, 2, 3]) {
        if (Either.isRight(generateEmphasized([group], seed))) {
          widenings++
          expect(
            Either.isRight(generateEmphasized([group, added], seed)),
            `${group} + ${added} at seed ${seed}`,
          ).toBe(true)
        }
      }
    }
    // The loop must not pass by never reaching its assertion.
    expect(widenings).toBeGreaterThan(20)
  })

  it('an empty emphasis cannot be built', () => {
    // Absent means no emphasis, and there is no second way to say it.
    const attempt = Schema.decodeUnknownEither(GenerationConstraints)({
      focus: 'strength',
      targetMinutes: 30,
      equipment: [],
      emphasis: [],
      noRepeatSessions: 0,
      seed: 1,
    })
    expect(Either.isLeft(attempt)).toBe(true)
  })

  it('a two-group emphasis may return a workout drawn wholly from one group', () => {
    // Twelve core exercises and one chest exercise. A generator that balanced
    // across the two groups would have to place the chest exercise. This one
    // filters and then samples, so a workout of core alone is a valid result.
    const catalog = [
      ...Array.from({ length: 12 }, (_, i) => strengthExercise(`Core Move ${i + 1}`, 'core')),
      strengthExercise('Chest Press', 'chest'),
    ]
    const workout = expectRight(
      generate(
        catalog,
        [],
        baseConstraints({
          focus: 'strength',
          targetMinutes: 15,
          equipment: [],
          emphasis: ['core', 'chest'],
          seed: 77,
        }),
      ),
    )
    const groups = sourcesOf(workout, catalog).flatMap((source) => source.muscleGroups)
    expect(groups).not.toContain('chest')
    expect(new Set(groups)).toEqual(new Set(['core']))
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
    const smallCatalog = Array.from({ length: 8 }, (_, i) =>
      strengthExercise(`Move ${i + 1}`, 'core'),
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
