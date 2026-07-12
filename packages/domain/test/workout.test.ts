import { describe, it } from '@effect/vitest'
import * as Effect from 'effect/Effect'
import * as Schema from 'effect/Schema'
import { expect } from 'vitest'

import {
  Flow,
  FlowType,
  flowTypeLabel,
  Focus,
  focusLabel,
  Pod,
  Round,
  Station,
  Workout,
} from '../src/workout.js'

const roundTrips = <A, I>(schema: Schema.Schema<A, I>, value: A) =>
  Effect.gen(function* () {
    const encoded = yield* Schema.encode(schema)(value)
    const decoded = yield* Schema.decodeUnknown(schema)(encoded)
    expect(decoded).toStrictEqual(value)
  })

describe('vocabulary labels', () => {
  it('maps every focus literal to a non-empty label', () => {
    for (const literal of Focus.literals) {
      expect(focusLabel[literal].length).toBeGreaterThan(0)
    }
  })

  it('maps every flow type literal to a non-empty label', () => {
    for (const literal of FlowType.literals) {
      expect(flowTypeLabel[literal].length).toBeGreaterThan(0)
    }
  })
})

describe('Workout model', () => {
  const round = new Round({ workSeconds: 40, restSeconds: 20 })
  const station = new Station({ name: 'Burpee', detail: '(step back = no-jump)' })
  const pod = new Pod({ name: 'Pod 1', stations: [station] })
  const flow = new Flow({ type: 'laps', rounds: [round] })
  const workout = new Workout({ name: 'Athletica', focus: 'cardio', pods: [pod], flow })

  it.effect('round-trips every model type through encode/decode', () =>
    Effect.gen(function* () {
      yield* roundTrips(Round, round)
      yield* roundTrips(Station, station)
      yield* roundTrips(Pod, pod)
      yield* roundTrips(Flow, flow)
      yield* roundTrips(Workout, workout)
      yield* roundTrips(FlowType, 'sets')
      yield* roundTrips(Focus, 'hybrid')
    }),
  )

  it.effect('rejects a pod with no stations', () =>
    Effect.gen(function* () {
      const result = yield* Effect.either(
        Schema.decodeUnknown(Pod)({ name: 'Pod 1', stations: [] }),
      )
      expect(result._tag).toBe('Left')
    }),
  )

  it.effect('rejects a workout with no pods', () =>
    Effect.gen(function* () {
      const encoded = yield* Schema.encode(Workout)(workout)
      const result = yield* Effect.either(Schema.decodeUnknown(Workout)({ ...encoded, pods: [] }))
      expect(result._tag).toBe('Left')
    }),
  )

  it.effect('rejects a flow with no rounds', () =>
    Effect.gen(function* () {
      const result = yield* Effect.either(Schema.decodeUnknown(Flow)({ type: 'laps', rounds: [] }))
      expect(result._tag).toBe('Left')
    }),
  )

  it.effect('rejects a round with workSeconds <= 0', () =>
    Effect.gen(function* () {
      const zero = yield* Effect.either(
        Schema.decodeUnknown(Round)({ workSeconds: 0, restSeconds: 10 }),
      )
      const negative = yield* Effect.either(
        Schema.decodeUnknown(Round)({ workSeconds: -5, restSeconds: 10 }),
      )
      expect(zero._tag).toBe('Left')
      expect(negative._tag).toBe('Left')
    }),
  )

  it.effect('rejects a round with restSeconds < 0', () =>
    Effect.gen(function* () {
      const result = yield* Effect.either(
        Schema.decodeUnknown(Round)({ workSeconds: 30, restSeconds: -1 }),
      )
      expect(result._tag).toBe('Left')
    }),
  )
})
