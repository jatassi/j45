import { describe, expect, it } from '@effect/vitest'
import { Equipment, Exercise, MuscleGroup } from '@j45/domain'
import * as Effect from 'effect/Effect'
import * as Schema from 'effect/Schema'

import { seedExercises } from '../../src/library/seed-exercises.js'

/**
 * The curation goldens from `docs/designs/exercise-library/design.md`: the
 * frozen seed catalog — derived from the 12 seed workouts' 104 station texts
 * under the split/collapse/alternative rules — must decode as `Exercise`,
 * carry unique case-insensitive names, number at least 80, and exercise every
 * `MuscleGroup` and `Equipment` literal so the closed vocabularies earn their
 * members.
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

  it('names are unique case-insensitively', () => {
    const lowered = seedExercises.map((seed) => seed.name.toLowerCase())
    expect(new Set(lowered).size).toBe(seedExercises.length)
  })

  it('the catalog has at least 80 entries', () => {
    expect(seedExercises.length).toBeGreaterThanOrEqual(80)
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
  })
})
