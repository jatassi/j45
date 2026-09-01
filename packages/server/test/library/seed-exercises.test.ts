import { describe, expect, it } from '@effect/vitest'
import { Equipment, Exercise, MuscleGroup } from '@j45/domain'
import * as Arr from 'effect/Array'
import * as Effect from 'effect/Effect'
import * as Order from 'effect/Order'
import * as Schema from 'effect/Schema'

import { seedExercises } from '../../src/library/seed-exercises.js'
import { preMigrationSeed, type PreMigrationExercise } from './fixtures/seed-exercises-pre-0008.js'

/** `Arr.sort`, because `Array#toSorted` needs `lib: es2023`. */
const sorted = (names: Iterable<string>) => Arr.sort([...names], Order.string)

/**
 * For each muscle group, the names of the strength exercises that have it.
 *
 * The function skips a group that is not in the vocabulary. That group is the
 * one permitted difference between the two catalogs. The function reads the
 * current literal, and not a list of removed values. Thus it does not name a
 * value that has left the vocabulary.
 */
const strengthNamesByGroup = (catalog: readonly PreMigrationExercise[]) => {
  const vocabulary = new Set<string>(MuscleGroup.literals)
  const byGroup = new Map<string, ReadonlySet<string>>()
  for (const seed of catalog) {
    if (seed.modality !== 'strength') {
      continue
    }
    for (const group of seed.muscleGroups) {
      if (!vocabulary.has(group)) {
        continue
      }
      byGroup.set(group, new Set([...(byGroup.get(group) ?? []), seed.name]))
    }
  }
  return byGroup
}

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

  /**
   * The main promise of ADR-0003: the removal of `full-body` changes the
   * vocabulary, and it does not change behaviour. Every strength exercise that
   * carried the value also carried a real group, and the two fallback rows are
   * cardio. No group that stays therefore gains or loses a strength exercise.
   * Generation reads these pools, so a user who selected `Chest` before the
   * change gets the same exercises after it.
   *
   * The comparison is against the frozen pre-removal catalog, and it is by
   * exercise name. Equal counts alone cannot pass this test.
   */
  it('every surviving muscle group keeps exactly its strength exercises', () => {
    const before = strengthNamesByGroup(preMigrationSeed)
    const after = strengthNamesByGroup(seedExercises)

    expect(sorted(after.keys())).toStrictEqual(sorted(before.keys()))
    for (const [group, names] of before) {
      expect(sorted(after.get(group) ?? []), `strength pool for '${group}'`).toStrictEqual(
        sorted(names),
      )
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
