import { describe, expect, it } from '@effect/vitest'
import { Equipment, Exercise, MuscleGroup } from '@j45/domain'
import * as Effect from 'effect/Effect'
import * as Schema from 'effect/Schema'

import { seedExercises } from '../../src/library/seed-exercises.js'

/**
 * The smallest station count any template asks for
 * (`packages/domain/src/templates.ts`). A strength Emphasis on one group must
 * clear it with every implement allowed, or the request is infeasible at
 * every duration.
 */
const SMALLEST_TEMPLATE_STATIONS = 4

/**
 * The curation goldens for the catalog adopted by ADR-0004 and documented in
 * `docs/research/exercise-catalog.md`: the frozen seed must decode as
 * `Exercise`, carry unique case-insensitive names, hold one movement per
 * entry, exercise every `MuscleGroup` and `Equipment` literal, and leave no
 * single-group strength Emphasis below the smallest template.
 */
describe('seed exercises', () => {
  it.effect('every entry decodes as an Exercise', () =>
    Effect.gen(function* () {
      for (const seed of seedExercises) {
        const exercise = yield* Schema.decodeUnknown(Exercise)(seed)
        expect(exercise.name).toBe(seed.name)
      }
    }),
  )

  it('no entry carries a field the schema does not declare', () => {
    const declared = new Set(['name', 'detail', 'modality', 'muscleGroups', 'equipment'])
    for (const seed of seedExercises) {
      for (const key of Object.keys(seed)) {
        expect(declared, `'${seed.name}' carries '${key}'`).toContain(key)
      }
    }
  })

  it('names are unique case-insensitively', () => {
    const lowered = seedExercises.map((seed) => seed.name.toLowerCase())
    expect(new Set(lowered).size).toBe(seedExercises.length)
  })

  it('the catalog has at least 100 entries', () => {
    expect(seedExercises.length).toBeGreaterThanOrEqual(100)
  })

  it('every entry is one movement, not a combo station or an alternative', () => {
    for (const seed of seedExercises) {
      expect(seed.name, `'${seed.name}' is a combo`).not.toMatch(/\+/)
      expect(seed.name, `'${seed.name}' names an alternative`).not.toMatch(/\bor\b|\//)
      expect(seed.name, `'${seed.name}' carries a cue`).not.toMatch(/pulse|—|\(\d/i)
    }
  })

  it('no entry carries more than three muscle groups', () => {
    for (const seed of seedExercises) {
      expect(seed.muscleGroups.length, `'${seed.name}'`).toBeLessThanOrEqual(3)
    }
  })

  it('every MuscleGroup literal is used by at least one entry', () => {
    const used = new Set(seedExercises.flatMap((seed) => seed.muscleGroups))
    for (const group of MuscleGroup.literals) {
      expect(used, `MuscleGroup '${group}' is unused`).toContain(group)
    }
  })

  it('every Equipment literal is used by at least one entry', () => {
    const used = new Set(seedExercises.flatMap((seed) => seed.equipment))
    for (const item of Equipment.literals) {
      expect(used, `Equipment '${item}' is unused`).toContain(item)
    }
  })

  /**
   * Emphasis reads strength entries only, and a single-group Emphasis is the
   * narrowest legal request. The previous catalog had one strength entry for
   * `calves`, which made that request infeasible at every duration.
   */
  it('every muscle group has enough strength entries for the smallest template', () => {
    for (const group of MuscleGroup.literals) {
      const pool = seedExercises.filter(
        (seed) => seed.modality === 'strength' && seed.muscleGroups.includes(group),
      )
      expect(pool.length, `strength pool for '${group}'`).toBeGreaterThanOrEqual(
        SMALLEST_TEMPLATE_STATIONS,
      )
    }
  })

  it('the spot-check exercises exist with their expected tags', () => {
    const byName = (name: string) =>
      seedExercises.find((seed) => seed.name.toLowerCase() === name.toLowerCase())

    const rower = byName('Rower')
    expect(rower?.modality).toBe('cardio')
    expect(rower?.equipment).toContain('rower')

    const frontSquat = byName('Barbell front squat')
    expect(frontSquat?.modality).toBe('strength')
    expect(frontSquat?.equipment).toContain('barbell')

    const burpee = byName('Burpee')
    expect(burpee).toBeDefined()
    expect(burpee?.equipment).toStrictEqual([])

    // The row that the previous catalog tagged as a dumbbell movement.
    const landmine = byName('Barbell landmine rotation')
    expect(landmine?.equipment).toStrictEqual(['barbell'])
  })
})
