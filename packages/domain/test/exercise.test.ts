import { describe, it } from '@effect/vitest'
import * as DateTime from 'effect/DateTime'
import * as Effect from 'effect/Effect'
import * as Schema from 'effect/Schema'
import { expect } from 'vitest'

import { Exercise, ExerciseId, LibraryExercise } from '../src/exercise.js'
import { ExerciseRpcs } from '../src/rpc.js'

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
