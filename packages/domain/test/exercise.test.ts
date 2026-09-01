import { describe, it } from '@effect/vitest'
import * as DateTime from 'effect/DateTime'
import * as Effect from 'effect/Effect'
import * as Schema from 'effect/Schema'
import { expect } from 'vitest'

import {
  Equipment,
  equipmentLabel,
  Exercise,
  ExerciseId,
  Intensity,
  intensityLabel,
  LibraryExercise,
  Modality,
  modalityLabel,
  MuscleGroup,
  muscleGroupLabel,
} from '../src/exercise.js'
import { ExerciseRpcs } from '../src/rpc.js'

describe('vocabulary labels', () => {
  it('maps every modality literal to a non-empty label', () => {
    for (const literal of Modality.literals) {
      expect(modalityLabel[literal].length).toBeGreaterThan(0)
    }
  })

  it('maps every intensity literal to a non-empty label', () => {
    for (const literal of Intensity.literals) {
      expect(intensityLabel[literal].length).toBeGreaterThan(0)
    }
  })

  it('maps every muscle group literal to a non-empty label', () => {
    for (const literal of MuscleGroup.literals) {
      expect(muscleGroupLabel[literal].length).toBeGreaterThan(0)
    }
  })

  /**
   * ADR-0003 removed `full-body` from the vocabulary. The concept did not move
   * to a different field. The schema no longer accepts the value, and a stored
   * row that holds it does not decode.
   */
  it('has ten muscle groups and does not accept full-body', () => {
    expect(MuscleGroup.literals).toHaveLength(10)
    expect(() => Schema.decodeUnknownSync(MuscleGroup)('full-body')).toThrow()
  })

  it('maps every equipment literal to a non-empty label', () => {
    for (const literal of Equipment.literals) {
      expect(equipmentLabel[literal].length).toBeGreaterThan(0)
    }
  })

  it('maps hyphenated ids to exact human text', () => {
    expect(equipmentLabel['jump-rope']).toBe('Jump rope')
    expect(equipmentLabel['med-ball']).toBe('Med ball')
    expect(equipmentLabel['pull-up-bar']).toBe('Pull-up bar')
    expect(equipmentLabel['slam-ball']).toBe('Slam ball')
  })
})

describe('LibraryExercise', () => {
  it.effect('round-trips through encode/decode', () =>
    Effect.gen(function* () {
      const now = yield* DateTime.now
      const original = new LibraryExercise({
        id: Schema.decodeSync(ExerciseId)('exercise-1'),
        exercise: new Exercise({
          name: 'Goblet Squat',
          detail: 'dumbbell at chest',
          modality: 'strength',
          muscleGroups: ['quads', 'glutes'],
          equipment: ['dumbbell'],
          intensity: 'moderate',
        }),
        createdAt: now,
        updatedAt: now,
      })

      const encoded = yield* Schema.encode(LibraryExercise)(original)
      const decoded = yield* Schema.decodeUnknown(LibraryExercise)(encoded)

      expect(decoded).toStrictEqual(original)
    }),
  )
})

describe('ExerciseRpcs', () => {
  it('exposes the four exercise operations', () => {
    const rpcs = ExerciseRpcs.requests
    expect(rpcs.size).toBe(4)
    expect(rpcs.has('ListExercises')).toBe(true)
    expect(rpcs.has('CreateExercise')).toBe(true)
    expect(rpcs.has('UpdateExercise')).toBe(true)
    expect(rpcs.has('DeleteExercise')).toBe(true)
  })
})
