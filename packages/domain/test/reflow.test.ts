import { describe, it } from '@effect/vitest'
import * as Either from 'effect/Either'
import { expect } from 'vitest'

import { applyReflow, Reflow, ReflowInvalid, ReflowPod } from '../src/reflow.js'
import { compile } from '../src/segments.js'
import { Flow, Pod, Round, Station, Workout } from '../src/workout.js'

const defined = <A>(value: A | undefined, message: string): A => {
  if (value === undefined) {
    throw new Error(message)
  }
  return value
}

/** Flattened order: 0 Push-up, 1 Sit-up, 2 Burpee | 3 Squat, 4 Plank. */
const sourceWorkout = new Workout({
  name: 'Source Circuit',
  focus: 'hybrid',
  note: 'source note',
  pods: [
    new Pod({
      name: 'Upper',
      stations: [
        new Station({ name: 'Push-up' }),
        new Station({ name: 'Sit-up' }),
        new Station({ name: 'Burpee' }),
      ],
    }),
    new Pod({
      name: 'Lower',
      stations: [new Station({ name: 'Squat' }), new Station({ name: 'Plank' })],
    }),
  ],
  flow: new Flow({
    type: 'sets',
    rounds: [
      new Round({ workSeconds: 40, restSeconds: 20 }),
      new Round({ workSeconds: 30, restSeconds: 10 }),
    ],
  }),
})

describe('applyReflow — golden regroup to laps', () => {
  it('regroups push-up/sit-up/squat into one laps pod; compile interleaves stations per lap', () => {
    const reflow = new Reflow({
      pods: [
        new ReflowPod({
          name: 'Core Three',
          stations: [0, 1, 3], // Push-up, Sit-up, Squat
        }),
      ],
      flowType: 'laps',
    })

    const result = applyReflow(sourceWorkout, reflow)
    expect(Either.isRight(result)).toBe(true)
    if (Either.isLeft(result)) {
      throw new Error('expected Right')
    }
    const workout = result.right

    expect(workout.name).toBe(sourceWorkout.name)
    expect(workout.focus).toBe(sourceWorkout.focus)
    expect(workout.note).toBe(sourceWorkout.note)
    expect(workout.flow.rounds).toStrictEqual(sourceWorkout.flow.rounds)
    expect(workout.flow.type).toBe('laps')

    const compiled = compile(workout)
    const expected = [
      { _tag: 'ready' as const, durationMillis: 5000 },
      // round 1 — pod-major: all stations of the pod in order
      {
        _tag: 'work' as const,
        durationMillis: 40_000,
        station: 'Push-up',
        round: 1,
        stationInPod: 1,
        podIndex: 0,
      },
      { _tag: 'rest' as const, durationMillis: 20_000 },
      {
        _tag: 'work' as const,
        durationMillis: 40_000,
        station: 'Sit-up',
        round: 1,
        stationInPod: 2,
        podIndex: 0,
      },
      { _tag: 'rest' as const, durationMillis: 20_000 },
      {
        _tag: 'work' as const,
        durationMillis: 40_000,
        station: 'Squat',
        round: 1,
        stationInPod: 3,
        podIndex: 0,
      },
      { _tag: 'rest' as const, durationMillis: 20_000 },
      // round 2
      {
        _tag: 'work' as const,
        durationMillis: 30_000,
        station: 'Push-up',
        round: 2,
        stationInPod: 1,
        podIndex: 0,
      },
      { _tag: 'rest' as const, durationMillis: 10_000 },
      {
        _tag: 'work' as const,
        durationMillis: 30_000,
        station: 'Sit-up',
        round: 2,
        stationInPod: 2,
        podIndex: 0,
      },
      { _tag: 'rest' as const, durationMillis: 10_000 },
      {
        _tag: 'work' as const,
        durationMillis: 30_000,
        station: 'Squat',
        round: 2,
        stationInPod: 3,
        podIndex: 0,
      },
    ]

    expect(compiled.segments).toHaveLength(expected.length)
    expected.forEach((expectation, index) => {
      const segment = defined(compiled.segments[index], `missing segment at index ${index}`)
      expect(segment._tag).toBe(expectation._tag)
      expect(segment.durationMillis).toBe(expectation.durationMillis)
      if (expectation._tag === 'work') {
        if (segment._tag !== 'work') {
          throw new Error(`expected work at ${index}`)
        }
        expect(segment.work.station.name).toBe(expectation.station)
        expect(segment.work.round).toBe(expectation.round)
        expect(segment.work.stationInPod).toBe(expectation.stationInPod)
        expect(segment.work.podIndex).toBe(expectation.podIndex)
      }
    })
  })
})

describe('applyReflow — reordering across pods', () => {
  it('moves stations between pods and preserves the requested order', () => {
    const reflow = new Reflow({
      pods: [
        new ReflowPod({
          name: 'First',
          stations: [3, 0], // Squat, Push-up
        }),
        new ReflowPod({
          name: 'Second',
          stations: [4, 2], // Plank, Burpee
        }),
      ],
      flowType: 'sets',
    })

    const result = applyReflow(sourceWorkout, reflow)
    expect(Either.isRight(result)).toBe(true)
    if (Either.isLeft(result)) {
      throw new Error('expected Right')
    }
    const workout = result.right

    expect(workout.pods).toHaveLength(2)
    const firstPod = defined(workout.pods[0], 'missing first pod')
    const secondPod = defined(workout.pods[1], 'missing second pod')
    expect(firstPod.name).toBe('First')
    expect(firstPod.stations.map((s) => s.name)).toStrictEqual(['Squat', 'Push-up'])
    expect(secondPod.name).toBe('Second')
    expect(secondPod.stations.map((s) => s.name)).toStrictEqual(['Plank', 'Burpee'])
  })
})

describe('applyReflow — dropped stations', () => {
  it('omits unreferenced source stations from the result and its compile', () => {
    const reflow = new Reflow({
      pods: [
        new ReflowPod({
          name: 'Keepers',
          stations: [0, 3], // Push-up, Squat — drop Sit-up, Burpee, Plank
        }),
      ],
      flowType: 'sets',
    })

    const result = applyReflow(sourceWorkout, reflow)
    expect(Either.isRight(result)).toBe(true)
    if (Either.isLeft(result)) {
      throw new Error('expected Right')
    }
    const workout = result.right

    const stationNames = workout.pods.flatMap((pod) => pod.stations.map((s) => s.name))
    expect(stationNames).toStrictEqual(['Push-up', 'Squat'])
    expect(stationNames).not.toContain('Sit-up')
    expect(stationNames).not.toContain('Burpee')
    expect(stationNames).not.toContain('Plank')

    const compiledNames = compile(workout).segments.flatMap((segment) =>
      segment._tag === 'work' ? [segment.work.station.name] : [],
    )
    expect(compiledNames).not.toContain('Sit-up')
    expect(compiledNames).not.toContain('Burpee')
    expect(compiledNames).not.toContain('Plank')
  })
})

describe('applyReflow — rounds override', () => {
  it('uses explicit reflow.rounds instead of the source rounds', () => {
    const overrideRounds = [
      new Round({ workSeconds: 15, restSeconds: 5 }),
      new Round({ workSeconds: 15, restSeconds: 5 }),
      new Round({ workSeconds: 15, restSeconds: 5 }),
    ] as const

    const reflow = new Reflow({
      pods: [new ReflowPod({ name: 'All', stations: [0, 1] })],
      flowType: 'laps',
      rounds: [...overrideRounds],
    })

    const result = applyReflow(sourceWorkout, reflow)
    expect(Either.isRight(result)).toBe(true)
    if (Either.isLeft(result)) {
      throw new Error('expected Right')
    }

    expect(result.right.flow.rounds).toStrictEqual([...overrideRounds])
    expect(result.right.flow.rounds).not.toStrictEqual(sourceWorkout.flow.rounds)
  })

  it('carries source rounds over when reflow.rounds is absent', () => {
    const reflow = new Reflow({
      pods: [new ReflowPod({ name: 'All', stations: [0] })],
      flowType: 'laps',
    })

    const result = applyReflow(sourceWorkout, reflow)
    expect(Either.isRight(result)).toBe(true)
    if (Either.isLeft(result)) {
      throw new Error('expected Right')
    }

    expect(result.right.flow.rounds).toStrictEqual(sourceWorkout.flow.rounds)
  })
})

describe('applyReflow — invalid indexes', () => {
  it('fails ReflowInvalid for an out-of-range index without throwing', () => {
    const reflow = new Reflow({
      pods: [new ReflowPod({ name: 'Bad', stations: [0, 99] })],
      flowType: 'sets',
    })

    const result = applyReflow(sourceWorkout, reflow)
    expect(Either.isLeft(result)).toBe(true)
    if (Either.isRight(result)) {
      throw new Error('expected Left')
    }
    expect(result.left).toBeInstanceOf(ReflowInvalid)
    expect(result.left.reason.length).toBeGreaterThan(0)
  })

  it('fails ReflowInvalid for a duplicated index without throwing', () => {
    const reflow = new Reflow({
      pods: [
        new ReflowPod({ name: 'A', stations: [0, 1] }),
        new ReflowPod({ name: 'B', stations: [1, 2] }), // 1 duplicated
      ],
      flowType: 'sets',
    })

    const result = applyReflow(sourceWorkout, reflow)
    expect(Either.isLeft(result)).toBe(true)
    if (Either.isRight(result)) {
      throw new Error('expected Left')
    }
    expect(result.left).toBeInstanceOf(ReflowInvalid)
    expect(result.left.reason.length).toBeGreaterThan(0)
  })

  it('fails ReflowInvalid when the same index appears twice in one pod', () => {
    const reflow = new Reflow({
      pods: [new ReflowPod({ name: 'Dup', stations: [0, 0] })],
      flowType: 'laps',
    })

    const result = applyReflow(sourceWorkout, reflow)
    expect(Either.isLeft(result)).toBe(true)
    if (Either.isRight(result)) {
      throw new Error('expected Left')
    }
    expect(result.left).toBeInstanceOf(ReflowInvalid)
    expect(result.left.reason.length).toBeGreaterThan(0)
  })
})
