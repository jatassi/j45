import { describe, it } from '@effect/vitest'
import * as Clock from 'effect/Clock'
import * as Effect from 'effect/Effect'
import * as Schema from 'effect/Schema'
import * as TestClock from 'effect/TestClock'
import { expect } from 'vitest'

import type { Segment } from '../src/segments.js'
import { ReadySegment, RestSegment, WorkContext, WorkSegment } from '../src/segments.js'
import {
  advanceIfDue,
  pause,
  prev,
  resume,
  skip,
  start,
  TimerDone,
  TimerIdle,
  TimerPaused,
  TimerRunning,
  TimerState,
} from '../src/timer.js'
import { Station } from '../src/workout.js'

const station = new Station({ name: 'Burpee' })
const workContext = (workIndex: number) =>
  new WorkContext({ station, podIndex: 0, podName: 'Pod 1', stationInPod: 1, round: 1, workIndex })

// ready(5s), work(10s), rest(5s), work(10s), rest(5s), work(10s) — six
// segments, chosen so a single long adjustment crosses several boundaries.
const segments: readonly Segment[] = [
  new ReadySegment({ durationMillis: 5000 }),
  new WorkSegment({ durationMillis: 10_000, work: workContext(0) }),
  new RestSegment({ durationMillis: 5000, nextWork: workContext(1) }),
  new WorkSegment({ durationMillis: 10_000, work: workContext(1) }),
  new RestSegment({ durationMillis: 5000, nextWork: workContext(2) }),
  new WorkSegment({ durationMillis: 10_000, work: workContext(2) }),
]

const durationAt = (index: number): number => {
  const segment = segments[index]
  if (!segment) {
    throw new Error(`missing segment at index ${index}`)
  }
  return segment.durationMillis
}

describe('TimerState schema', () => {
  it.effect('round-trips every variant through encode/decode', () =>
    Effect.gen(function* () {
      const states = [
        new TimerIdle({}),
        new TimerRunning({ segmentIndex: 1, endsAtMillis: 12_345 }),
        new TimerPaused({ segmentIndex: 1, remainingMillis: 6789 }),
        new TimerDone({}),
      ]
      for (const state of states) {
        const encoded = yield* Schema.encode(TimerState)(state)
        const decoded = yield* Schema.decodeUnknown(TimerState)(encoded)
        expect(decoded).toStrictEqual(state)
      }
    }),
  )
})

describe('advanceIfDue', () => {
  it.effect(
    'crosses segment boundaries exactly at their chained deadlines, catching up across several boundaries after a long adjust',
    () =>
      Effect.gen(function* () {
        const now0 = yield* Clock.currentTimeMillis
        const running0 = start(segments, now0)

        yield* TestClock.adjust(5000) // exactly the ready segment's deadline
        const now1 = yield* Clock.currentTimeMillis
        const state1 = advanceIfDue(running0, segments, now1)
        expect(state1).toStrictEqual(
          new TimerRunning({ segmentIndex: 1, endsAtMillis: now0 + 15_000 }),
        )

        // 25s further crosses three boundaries (15_000, 20_000, 30_000) in
        // one call — the multi-segment catch-up after a long adjust.
        yield* TestClock.adjust(25_000)
        const now2 = yield* Clock.currentTimeMillis
        const state2 = advanceIfDue(state1, segments, now2)
        expect(state2).toStrictEqual(
          new TimerRunning({ segmentIndex: 4, endsAtMillis: now0 + 35_000 }),
        )
      }),
  )

  it.effect('advances past the last segment into done', () =>
    Effect.gen(function* () {
      const now0 = yield* Clock.currentTimeMillis
      const running = new TimerRunning({
        segmentIndex: segments.length - 1,
        endsAtMillis: now0 + 1,
      })
      yield* TestClock.adjust(1)
      const now1 = yield* Clock.currentTimeMillis
      expect(advanceIfDue(running, segments, now1)).toStrictEqual(new TimerDone({}))
    }),
  )
})

describe('pause and resume', () => {
  it.effect('pause freezes remainingMillis across TestClock.adjust', () =>
    Effect.gen(function* () {
      const now0 = yield* Clock.currentTimeMillis
      const running = new TimerRunning({ segmentIndex: 1, endsAtMillis: now0 + 10_000 })
      const paused = pause(running, now0)
      expect(paused).toStrictEqual(new TimerPaused({ segmentIndex: 1, remainingMillis: 10_000 }))

      yield* TestClock.adjust(4000)
      expect(paused).toStrictEqual(new TimerPaused({ segmentIndex: 1, remainingMillis: 10_000 }))
    }),
  )

  it.effect('resume re-anchors endsAt to now + remaining', () =>
    Effect.gen(function* () {
      const paused = new TimerPaused({ segmentIndex: 1, remainingMillis: 6000 })
      const now = yield* Clock.currentTimeMillis
      const resumed = resume(paused, now)
      expect(resumed).toStrictEqual(new TimerRunning({ segmentIndex: 1, endsAtMillis: now + 6000 }))
    }),
  )
})

describe('skip and prev', () => {
  it.effect('skip and prev enter the target segment at full duration', () =>
    Effect.gen(function* () {
      const now = yield* Clock.currentTimeMillis
      const running = new TimerRunning({ segmentIndex: 1, endsAtMillis: now + 3000 })

      const skipped = skip(running, segments, now)
      expect(skipped).toStrictEqual(
        new TimerRunning({ segmentIndex: 2, endsAtMillis: now + durationAt(2) }),
      )

      const back = prev(skipped, segments, now)
      expect(back).toStrictEqual(
        new TimerRunning({ segmentIndex: 1, endsAtMillis: now + durationAt(1) }),
      )
    }),
  )

  it.effect('skip on the last segment yields done', () =>
    Effect.gen(function* () {
      const now = yield* Clock.currentTimeMillis
      const running = new TimerRunning({
        segmentIndex: segments.length - 1,
        endsAtMillis: now + 1000,
      })
      expect(skip(running, segments, now)).toStrictEqual(new TimerDone({}))
    }),
  )

  it.effect('prev on segment 0 is a no-op', () =>
    Effect.gen(function* () {
      const now = yield* Clock.currentTimeMillis
      const running = new TimerRunning({ segmentIndex: 0, endsAtMillis: now + 5000 })
      expect(prev(running, segments, now)).toStrictEqual(running)
    }),
  )

  it.effect('prev from done enters the last segment at full duration', () =>
    Effect.gen(function* () {
      const now = yield* Clock.currentTimeMillis
      const last = segments.length - 1
      expect(prev(new TimerDone({}), segments, now)).toStrictEqual(
        new TimerRunning({ segmentIndex: last, endsAtMillis: now + durationAt(last) }),
      )
    }),
  )
})
