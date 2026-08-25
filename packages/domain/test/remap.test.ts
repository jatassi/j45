import { describe, it } from '@effect/vitest'
import * as Either from 'effect/Either'
import { expect } from 'vitest'

import { PlanExhausted, remapPosition } from '../src/remap.js'
import { compile, type Segment } from '../src/segments.js'
import { Flow, Pod, Round, Station, Workout, type FlowType } from '../src/workout.js'

const pod = (name: string, ...stationNames: readonly string[]) =>
  new Pod({
    name,
    stations: stationNames.map((stationName) => new Station({ name: stationName })) as [
      Station,
      ...Station[],
    ],
  })

const flow = (type: FlowType, ...rounds: readonly (readonly [number, number])[]) =>
  new Flow({
    type,
    rounds: rounds.map(([workSeconds, restSeconds]) => new Round({ workSeconds, restSeconds })) as [
      Round,
      ...Round[],
    ],
  })

const plan = (workoutFlow: Flow, ...pods: readonly Pod[]) =>
  new Workout({ name: 'Plan', focus: 'hybrid', pods: pods as [Pod, ...Pod[]], flow: workoutFlow })

/** One round of 40s work and 20s rest — the plain case. */
const uniform = flow('sets', [40, 20])

/** Index of the work segment carrying `workIndex`, in compile order. */
const workAt = (segments: readonly Segment[], workIndex: number): number => {
  const index = segments.findIndex(
    (segment) => segment._tag === 'work' && segment.work.workIndex === workIndex,
  )
  if (index === -1) {
    throw new Error(`no work segment carries work ordinal ${workIndex}`)
  }
  return index
}

/** Index of the rest segment that precedes the work carrying `workIndex`. */
const restBefore = (segments: readonly Segment[], workIndex: number): number => {
  const index = segments.findIndex(
    (segment) => segment._tag === 'rest' && segment.nextWork.workIndex === workIndex,
  )
  if (index === -1) {
    throw new Error(`no rest segment precedes work ordinal ${workIndex}`)
  }
  return index
}

const segmentAt = (segments: readonly Segment[], index: number): Segment => {
  const segment = segments[index]
  if (segment === undefined) {
    throw new Error(`no segment at index ${index}`)
  }
  return segment
}

/** The landed index, or a thrown failure — keeps the case bodies readable. */
const landed = (result: Either.Either<number, PlanExhausted>): number => {
  if (Either.isLeft(result)) {
    throw new Error(`expected a landing, got exhaustion at work ${result.left.workIndex}`)
  }
  return result.right
}

/** Station name of the work (or of the work a rest leads into) at `index`. */
const stationNameAt = (segments: readonly Segment[], index: number): string => {
  const segment = segmentAt(segments, index)
  if (segment._tag === 'work') {
    return segment.work.station.name
  }
  if (segment._tag === 'rest') {
    return segment.nextWork.station.name
  }
  throw new Error('the ready segment carries no station')
}

// Flat work ordinals 0 Push-up, 1 Sit-up, 2 Burpee, 3 Squat.
const fourStations = pod('Circuit', 'Push-up', 'Sit-up', 'Burpee', 'Squat')

describe('remapPosition — retiming only', () => {
  it('holds the work ordinal, the Station and the round when only the intervals changed', () => {
    const from = compile(plan(uniform, fourStations))
    const to = compile(plan(flow('sets', [25, 15]), fourStations))

    const index = landed(remapPosition(from.segments, workAt(from.segments, 2), to.segments))

    expect(index).toBe(workAt(to.segments, 2))
    expect(stationNameAt(to.segments, index)).toBe('Burpee')
    expect(segmentAt(to.segments, index).durationMillis).toBe(25_000)
  })
})

describe('remapPosition — insertion', () => {
  it('holds the work ordinal when a Station goes in before the current position', () => {
    const from = compile(plan(uniform, fourStations))
    const to = compile(
      plan(uniform, pod('Circuit', 'Lunge', 'Push-up', 'Sit-up', 'Burpee', 'Squat')),
    )

    const index = landed(remapPosition(from.segments, workAt(from.segments, 2), to.segments))

    // Ordinal 2 is kept, so the Participant stays the same distance into the
    // plan. The Station there moved along by one: with no stable Station id
    // to key on, the ordinal is the only anchor there is.
    expect(index).toBe(workAt(to.segments, 2))
    expect(stationNameAt(to.segments, index)).toBe('Sit-up')
  })

  it('leaves the position untouched when a Station goes in after the current one', () => {
    const from = compile(plan(uniform, fourStations))
    const to = compile(
      plan(uniform, pod('Circuit', 'Push-up', 'Sit-up', 'Burpee', 'Squat', 'Lunge')),
    )

    const index = landed(remapPosition(from.segments, workAt(from.segments, 1), to.segments))

    expect(index).toBe(workAt(from.segments, 1))
    expect(stationNameAt(to.segments, index)).toBe('Sit-up')
  })
})

describe('remapPosition — deletion', () => {
  it('holds the work ordinal when a Station before the current position goes away', () => {
    const from = compile(plan(uniform, fourStations))
    const to = compile(plan(uniform, pod('Circuit', 'Sit-up', 'Burpee', 'Squat')))

    const index = landed(remapPosition(from.segments, workAt(from.segments, 2), to.segments))

    expect(index).toBe(workAt(to.segments, 2))
    expect(stationNameAt(to.segments, index)).toBe('Squat')
  })

  it('leaves the position untouched when a Station after the current one goes away', () => {
    const from = compile(plan(uniform, fourStations))
    const to = compile(plan(uniform, pod('Circuit', 'Push-up', 'Sit-up', 'Burpee')))

    const index = landed(remapPosition(from.segments, workAt(from.segments, 1), to.segments))

    expect(index).toBe(workAt(from.segments, 1))
    expect(stationNameAt(to.segments, index)).toBe('Sit-up')
  })

  it('keeps the ordinal when the current Station itself goes away but the plan still reaches it', () => {
    const from = compile(plan(uniform, fourStations))
    // Burpee, the current Station, is removed; the plan still has 3 works.
    const to = compile(plan(uniform, pod('Circuit', 'Push-up', 'Sit-up', 'Squat')))

    const index = landed(remapPosition(from.segments, workAt(from.segments, 2), to.segments))

    expect(index).toBe(workAt(to.segments, 2))
    expect(stationNameAt(to.segments, index)).toBe('Squat')
  })

  it('reports exhaustion when the current Station was the last work and goes away', () => {
    const from = compile(plan(uniform, fourStations))
    const to = compile(plan(uniform, pod('Circuit', 'Push-up', 'Sit-up', 'Burpee')))

    const result = remapPosition(from.segments, workAt(from.segments, 3), to.segments)

    expect(result).toStrictEqual(Either.left(new PlanExhausted({ workIndex: 3 })))
  })
})

describe('remapPosition — reorder and regroup', () => {
  it('holds the work ordinal when the Stations are reordered', () => {
    const from = compile(plan(uniform, fourStations))
    const to = compile(plan(uniform, pod('Circuit', 'Squat', 'Burpee', 'Sit-up', 'Push-up')))

    const index = landed(remapPosition(from.segments, workAt(from.segments, 1), to.segments))

    expect(index).toBe(workAt(to.segments, 1))
    expect(stationNameAt(to.segments, index)).toBe('Burpee')
  })

  it('holds the work ordinal when the Stations are regrouped into different Pods', () => {
    const laps = flow('laps', [40, 20], [40, 20])
    // One Pod of four, two laps: ordinals 0-3 are lap 1, ordinals 4-7 lap 2.
    const from = compile(plan(laps, fourStations))
    // Two Pods of two, two laps: Pod 1 runs both its laps (ordinals 0-3)
    // before Pod 2 starts (ordinals 4-7).
    const to = compile(
      plan(laps, pod('Upper', 'Push-up', 'Sit-up'), pod('Lower', 'Burpee', 'Squat')),
    )

    const index = landed(remapPosition(from.segments, workAt(from.segments, 5), to.segments))

    expect(index).toBe(workAt(to.segments, 5))
    expect(stationNameAt(to.segments, index)).toBe('Squat')
    const segment = segmentAt(to.segments, index)
    expect(segment._tag === 'work' && segment.work.round).toBe(1)
  })
})

describe('remapPosition — a Ladder flow', () => {
  // Three laps over three Stations, rest descending: ordinals 0-2 are lap 1,
  // 3-5 lap 2, 6-8 lap 3.
  const ladderPod = pod('Circuit', 'Push-up', 'Sit-up', 'Burpee')
  const from = compile(plan(flow('laps', [60, 30], [30, 15], [20, 10]), ladderPod))

  it('re-enters the same ordinal on the new plan, at that round of the new Ladder', () => {
    const to = compile(plan(flow('laps', [45, 25], [35, 20], [25, 5]), ladderPod))

    const index = landed(remapPosition(from.segments, workAt(from.segments, 4), to.segments))

    expect(index).toBe(workAt(to.segments, 4))
    expect(stationNameAt(to.segments, index)).toBe('Sit-up')
    const segment = segmentAt(to.segments, index)
    expect(segment._tag === 'work' && segment.work.round).toBe(2)
    // Lap 2 of the new Ladder, not the 30s the Participant started under.
    expect(segment.durationMillis).toBe(35_000)
  })

  it('reports exhaustion when the new Ladder has fewer laps than the current ordinal', () => {
    const to = compile(plan(flow('laps', [60, 30], [30, 15]), ladderPod))

    const result = remapPosition(from.segments, workAt(from.segments, 7), to.segments)

    expect(result).toStrictEqual(Either.left(new PlanExhausted({ workIndex: 7 })))
  })
})

describe('remapPosition — a rest position', () => {
  it('lands on the rest before the same work ordinal when the new plan still rests there', () => {
    const from = compile(plan(uniform, fourStations))
    const to = compile(plan(flow('sets', [25, 10]), fourStations))

    const index = landed(remapPosition(from.segments, restBefore(from.segments, 2), to.segments))

    expect(index).toBe(restBefore(to.segments, 2))
    expect(segmentAt(to.segments, index).durationMillis).toBe(10_000)
  })

  it('lands on the work itself when the new plan drops that rest', () => {
    const from = compile(plan(uniform, fourStations))
    const to = compile(plan(flow('sets', [40, 0]), fourStations))

    const index = landed(remapPosition(from.segments, restBefore(from.segments, 2), to.segments))

    expect(index).toBe(workAt(to.segments, 2))
    expect(stationNameAt(to.segments, index)).toBe('Burpee')
  })

  it('reports exhaustion when the work the rest leads into is off the end of the new plan', () => {
    const from = compile(plan(uniform, fourStations))
    const to = compile(plan(uniform, pod('Circuit', 'Push-up', 'Sit-up')))

    const result = remapPosition(from.segments, restBefore(from.segments, 3), to.segments)

    expect(result).toStrictEqual(Either.left(new PlanExhausted({ workIndex: 3 })))
  })
})

describe('remapPosition — positions with no work context', () => {
  it('holds the ready segment, whatever the new plan looks like', () => {
    const from = compile(plan(uniform, fourStations))
    const to = compile(plan(flow('laps', [10, 5]), pod('Other', 'Lunge')))

    expect(remapPosition(from.segments, 0, to.segments)).toStrictEqual(Either.right(0))
  })

  it('takes an index outside the old plan to the start of the new one', () => {
    const from = compile(plan(uniform, fourStations))
    const to = compile(plan(uniform, fourStations))

    expect(remapPosition(from.segments, from.segments.length, to.segments)).toStrictEqual(
      Either.right(0),
    )
    expect(remapPosition(from.segments, -1, to.segments)).toStrictEqual(Either.right(0))
  })
})
