import { describe, it } from '@effect/vitest'
import * as DateTime from 'effect/DateTime'
import * as Effect from 'effect/Effect'
import * as Schema from 'effect/Schema'
import { expect } from 'vitest'

import { LibraryWorkout, WorkoutId } from '../src/library.js'
import { LibraryRpcs } from '../src/rpc.js'
import { Flow, Pod, Round, Station, Workout } from '../src/workout.js'

describe('LibraryWorkout', () => {
  it.effect('round-trips through encode/decode', () =>
    Effect.gen(function* () {
      const now = yield* DateTime.now
      const original = new LibraryWorkout({
        id: Schema.decodeSync(WorkoutId)('workout-1'),
        workout: new Workout({
          name: 'Athletica',
          focus: 'cardio',
          pods: [new Pod({ name: 'Pod 1', stations: [new Station({ name: 'Burpee' })] })],
          flow: new Flow({
            type: 'laps',
            rounds: [new Round({ workSeconds: 40, restSeconds: 20 })],
          }),
        }),
        createdAt: now,
        updatedAt: now,
      })

      const encoded = yield* Schema.encode(LibraryWorkout)(original)
      const decoded = yield* Schema.decodeUnknown(LibraryWorkout)(encoded)

      expect(decoded).toStrictEqual(original)
    }),
  )
})

describe('LibraryRpcs', () => {
  it('exposes the seven library operations', () => {
    const rpcs = LibraryRpcs.requests
    expect(rpcs.size).toBe(7)
    expect(rpcs.has('ListWorkouts')).toBe(true)
    expect(rpcs.has('GetWorkout')).toBe(true)
    expect(rpcs.has('DuplicateWorkout')).toBe(true)
    expect(rpcs.has('RenameWorkout')).toBe(true)
    expect(rpcs.has('DeleteWorkout')).toBe(true)
    expect(rpcs.has('CreateWorkout')).toBe(true)
    expect(rpcs.has('UpdateWorkout')).toBe(true)
  })
})
