import { describe, it } from '@effect/vitest'
import * as Effect from 'effect/Effect'
import * as Schema from 'effect/Schema'
import { expect } from 'vitest'

import {
  compile,
  compiledEquals,
  CompiledWorkout,
  READY_SECONDS,
  ReadySegment,
  Segment,
  segmentsEqual,
  WorkContext as WorkContextClass,
  WorkSegment,
  type RestSegment,
  type WorkContext,
} from '../src/segments.js'
import { Flow, Pod, Round, Station, Workout, type FlowType } from '../src/workout.js'
import {
  apexExpected,
  athleticaExpected,
  docklandsExpected,
  medusaExpected,
  type ExpectedSegment,
} from './fixtures/legacy-goldens.js'
import { apex, athletica, docklands, medusa } from './fixtures/legacy.js'

const asWork = (segment: Segment): WorkSegment => {
  if (segment._tag !== 'work') {
    throw new Error(`expected a work segment, got "${segment._tag}"`)
  }
  return segment
}
const asRest = (segment: Segment): RestSegment => {
  if (segment._tag !== 'rest') {
    throw new Error(`expected a rest segment, got "${segment._tag}"`)
  }
  return segment
}
const defined = <A>(value: A | undefined, message: string): A => {
  if (value === undefined) {
    throw new Error(message)
  }
  return value
}

const assertGolden = (
  workout: Workout,
  expected: readonly ExpectedSegment[],
  totalSeconds: number,
) => {
  const compiled = compile(workout)
  const [ready, ...rest] = compiled.segments
  expect(ready).toBeInstanceOf(ReadySegment)
  expect(ready.durationMillis).toBe(READY_SECONDS * 1000)
  expect(rest.length).toBe(expected.length)

  let workIndex = 0
  expected.forEach((expectation, index) => {
    const segment = defined(rest[index], `missing segment at index ${index}`)
    if (expectation.kind === 'rest') {
      expect(asRest(segment).durationMillis).toBe(expectation.restSeconds * 1000)
      return
    }
    const round = defined(
      workout.flow.rounds[expectation.round - 1],
      `missing round ${expectation.round}`,
    )
    const pod = defined(workout.pods[expectation.podIndex], `missing pod ${expectation.podIndex}`)
    const work = asWork(segment).work
    expect(segment.durationMillis).toBe(round.workSeconds * 1000)
    expect(work.podIndex).toBe(expectation.podIndex)
    expect(work.stationInPod).toBe(expectation.stationInPod)
    expect(work.round).toBe(expectation.round)
    expect(work.workIndex).toBe(workIndex)
    expect(work.station).toStrictEqual(pod.stations[expectation.stationInPod - 1])
    workIndex++
  })

  expect(compiled.flowType).toBe(workout.flow.type)
  expect(compiled.workTotal).toBe(expected.filter((e) => e.kind === 'work').length)
  expect(compiled.totalDurationMillis).toBe(totalSeconds * 1000)
}

const restBeforeWork = (
  segments: readonly Segment[],
  matches: (work: WorkContext) => boolean,
): RestSegment => {
  const index = segments.findIndex((segment) => segment._tag === 'work' && matches(segment.work))
  return asRest(defined(segments[index - 1], 'no segment before the matched work'))
}

describe('compile — legacy golden fixtures', () => {
  it('Athletica: laps ×3, uniform 40″/20″, 3 pods × 3 — 1605s total', () => {
    assertGolden(athletica, athleticaExpected, 1605)
  })

  it('Docklands: laps ×4, descending ladder, 3 pods × 3 — 1710s total', () => {
    assertGolden(docklands, docklandsExpected, 1710)
  })

  it('Medusa: sets ×3, ascending ladder, 1 pod × 9 — 2180s total', () => {
    assertGolden(medusa, medusaExpected, 2180)
  })

  it('Apex: laps ×1, uniform 240″/30″, 1 pod × 8 — 2135s total', () => {
    assertGolden(apex, apexExpected, 2135)
  })
})

describe('compile — the completed round governs the bridge rest, not the upcoming one', () => {
  it("Docklands: the lap 1 → lap 2 bridge uses lap 1's rest (30s), not lap 2's incoming rest (15s)", () => {
    const compiled = compile(docklands)
    const bridge = restBeforeWork(
      compiled.segments,
      (work) => work.podIndex === 0 && work.round === 2 && work.stationInPod === 1,
    )
    expect(bridge.durationMillis).toBe(30 * 1000)
  })

  it("Docklands: the pod 1 → pod 2 bridge uses lap 4's rest (5s), not the incoming lap 1 rest (30s)", () => {
    const compiled = compile(docklands)
    const bridge = restBeforeWork(
      compiled.segments,
      (work) => work.podIndex === 1 && work.round === 1 && work.stationInPod === 1,
    )
    expect(bridge.durationMillis).toBe(5 * 1000)
  })

  it("Medusa: the station 1 → station 2 bridge uses set 3's rest (30s), not station 2's incoming set-1 rest (15s)", () => {
    const compiled = compile(medusa)
    const bridge = restBeforeWork(
      compiled.segments,
      (work) => work.podIndex === 0 && work.round === 1 && work.stationInPod === 2,
    )
    expect(bridge.durationMillis).toBe(30 * 1000)
  })
})

describe('compile — zero rest', () => {
  const zeroRestWorkout = new Workout({
    name: 'Zero Rest Drill',
    focus: 'cardio',
    pods: [
      new Pod({
        name: 'Pod 1',
        stations: [new Station({ name: 'A' }), new Station({ name: 'B' })],
      }),
    ],
    flow: new Flow({
      type: 'laps',
      rounds: [
        new Round({ workSeconds: 10, restSeconds: 0 }),
        new Round({ workSeconds: 20, restSeconds: 5 }),
      ],
    }),
  })

  it('emits no rest segment after a round with restSeconds 0 — works are adjacent', () => {
    const compiled = compile(zeroRestWorkout)
    expect(compiled.segments.map((segment) => segment._tag)).toStrictEqual([
      'ready',
      'work',
      'work',
      'work',
      'rest',
      'work',
    ])
  })
})

describe('Segment and CompiledWorkout schemas', () => {
  it.effect('round-trip through encode/decode', () =>
    Effect.gen(function* () {
      const compiled = compile(athletica)
      const [readySegment, workSegment, restSegment] = compiled.segments
      const samples = [
        readySegment,
        defined(workSegment, 'missing work segment'),
        defined(restSegment, 'missing rest segment'),
      ]

      for (const segment of samples) {
        const encoded = yield* Schema.encode(Segment)(segment)
        const decoded = yield* Schema.decodeUnknown(Segment)(encoded)
        expect(decoded).toStrictEqual(segment)
      }

      const encodedCompiled = yield* Schema.encode(CompiledWorkout)(compiled)
      const decodedCompiled = yield* Schema.decodeUnknown(CompiledWorkout)(encodedCompiled)
      expect(decodedCompiled).toStrictEqual(compiled)
    }),
  )

  // The round trip above runs `athletica`, which is a `laps` workout. Medusa
  // is the `sets` half of the pair.
  it.effect('a sets plan carries its flow type across the wire', () =>
    Effect.gen(function* () {
      const encoded = yield* Schema.encode(CompiledWorkout)(compile(medusa))
      const decoded = yield* Schema.decodeUnknown(CompiledWorkout)(encoded)

      expect(encoded.flowType).toBe('sets')
      expect(decoded.flowType).toBe('sets')
    }),
  )
})

describe('compiledEquals — the flow type is part of the plan', () => {
  // One pod over one round. Pod-major and station-major then reach the same
  // stations in the same order, so both flows compile to the same segments.
  const oneRound = (type: FlowType) =>
    new Workout({
      name: 'One Round',
      focus: 'cardio',
      pods: [
        new Pod({
          name: 'Pod 1',
          stations: [new Station({ name: 'A' }), new Station({ name: 'B' })],
        }),
      ],
      flow: new Flow({ type, rounds: [new Round({ workSeconds: 30, restSeconds: 10 })] }),
    })

  it('holds across a recompile of the same workout', () => {
    expect(compiledEquals(compile(athletica), compile(athletica))).toBe(true)
  })

  it('fails when the flow type flips, although the segments are identical', () => {
    const laps = compile(oneRound('laps'))
    const sets = compile(oneRound('sets'))

    // The segments are the same under both flows.
    expect(sets.segments).toStrictEqual(laps.segments)
    expect(sets.workTotal).toBe(laps.workTotal)
    expect(sets.totalDurationMillis).toBe(laps.totalDurationMillis)

    // The progress strip groups by the flow, so the participant's screen
    // changes. The save is therefore a plan change. Do not remove the flow
    // type from the equivalence to make this equality hold again.
    expect(compiledEquals(laps, sets)).toBe(false)
  })
})

describe('segmentsEqual', () => {
  const [, workA, restA] = compile(athletica).segments
  const work = asWork(defined(workA, 'missing work segment'))
  const rest = asRest(defined(restA, 'missing rest segment'))

  const retimed = (segment: WorkSegment, durationMillis: number): WorkSegment =>
    new WorkSegment({ durationMillis, work: segment.work })

  const restationed = (segment: WorkSegment, name: string): WorkSegment =>
    new WorkSegment({
      durationMillis: segment.durationMillis,
      work: new WorkContextClass({
        station: new Station({ name }),
        podIndex: segment.work.podIndex,
        podName: segment.work.podName,
        stationInPod: segment.work.stationInPod,
        round: segment.work.round,
        workIndex: segment.work.workIndex,
      }),
    })

  it('holds for a segment rebuilt from the same values', () => {
    expect(segmentsEqual(work, retimed(work, work.durationMillis))).toBe(true)
    expect(segmentsEqual(rest, rest)).toBe(true)
  })

  it('fails when the kind differs', () => {
    expect(segmentsEqual(work, rest)).toBe(false)
    expect(segmentsEqual(work, new ReadySegment({ durationMillis: work.durationMillis }))).toBe(
      false,
    )
  })

  it('fails when the duration differs', () => {
    expect(segmentsEqual(work, retimed(work, work.durationMillis + 1000))).toBe(false)
  })

  it('fails when the work context differs', () => {
    expect(segmentsEqual(work, restationed(work, 'Something else'))).toBe(false)
  })

  it('holds across a whole recompile of the same workout', () => {
    const first = compile(athletica).segments
    const second = compile(athletica).segments
    expect(
      first.every((segment, index) => segmentsEqual(segment, defined(second[index], 'gap'))),
    ).toBe(true)
  })
})
