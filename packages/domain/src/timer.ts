import * as Option from 'effect/Option'
import * as Schema from 'effect/Schema'

import type { Segment } from './segments.js'

export class TimerIdle extends Schema.TaggedClass<TimerIdle>()('idle', {}) {}
export class TimerRunning extends Schema.TaggedClass<TimerRunning>()('running', {
  segmentIndex: Schema.Int,
  endsAtMillis: Schema.Number,
}) {}
export class TimerPaused extends Schema.TaggedClass<TimerPaused>()('paused', {
  segmentIndex: Schema.Int,
  remainingMillis: Schema.Number,
}) {}
export class TimerDone extends Schema.TaggedClass<TimerDone>()('done', {}) {}
export const TimerState = Schema.Union(TimerIdle, TimerRunning, TimerPaused, TimerDone)
export type TimerState = typeof TimerState.Type

const durationAt = (segments: readonly Segment[], index: number): number =>
  segments[index]?.durationMillis ?? 0

/**
 * Enter `segmentIndex` at full duration, anchored to `nowMillis`.
 *
 * Exported because a deadline must sometimes be recomputed from the current
 * instant rather than chained off the previous one — applying a plan change
 * to a running session is the case, since the segment it enters has a
 * duration the old chain knew nothing about.
 */
export const enterSegment = (
  segmentIndex: number,
  segments: readonly Segment[],
  nowMillis: number,
): TimerState =>
  new TimerRunning({ segmentIndex, endsAtMillis: nowMillis + durationAt(segments, segmentIndex) })

/** Begin a compiled workout at its first (`ready`) segment. */
export const start = (segments: readonly Segment[], nowMillis: number): TimerState =>
  enterSegment(0, segments, nowMillis)

/**
 * While running and the deadline has passed, enter the next segment —
 * chaining each deadline off the previous one (`nextEndsAt = prevEndsAt +
 * nextDur`) rather than off `now`, so a late or slept driver produces no
 * drift. Loops across every boundary the clock has crossed. Past the last
 * segment, the workout is done. A no-op unless currently running.
 */
export const advanceIfDue = (
  state: TimerState,
  segments: readonly Segment[],
  nowMillis: number,
): TimerState => {
  if (state._tag !== 'running') {
    return state
  }
  let segmentIndex = state.segmentIndex
  let endsAtMillis = state.endsAtMillis
  while (nowMillis >= endsAtMillis) {
    const nextIndex = segmentIndex + 1
    if (nextIndex >= segments.length) {
      return new TimerDone({})
    }
    segmentIndex = nextIndex
    endsAtMillis += durationAt(segments, nextIndex)
  }
  return new TimerRunning({ segmentIndex, endsAtMillis })
}

/** Running → paused, freezing the time left. A no-op otherwise. */
export const pause = (state: TimerState, nowMillis: number): TimerState =>
  state._tag === 'running'
    ? new TimerPaused({
        segmentIndex: state.segmentIndex,
        remainingMillis: Math.max(0, state.endsAtMillis - nowMillis),
      })
    : state

/** Paused → running, re-anchoring the deadline to `now + remaining`. */
export const resume = (state: TimerState, nowMillis: number): TimerState =>
  state._tag === 'paused'
    ? new TimerRunning({
        segmentIndex: state.segmentIndex,
        endsAtMillis: nowMillis + state.remainingMillis,
      })
    : state

/** Enter the next segment at full duration; past the last, the workout is done. */
export const skip = (
  state: TimerState,
  segments: readonly Segment[],
  nowMillis: number,
): TimerState => {
  if (state._tag !== 'running' && state._tag !== 'paused') {
    return state
  }
  const nextIndex = state.segmentIndex + 1
  return nextIndex >= segments.length
    ? new TimerDone({})
    : enterSegment(nextIndex, segments, nowMillis)
}

/**
 * Re-enter the previous segment at full duration. From `done`, re-enters the
 * last segment. On segment `0`, a no-op — there is nothing before the start.
 */
export const prev = (
  state: TimerState,
  segments: readonly Segment[],
  nowMillis: number,
): TimerState => {
  if (state._tag === 'done') {
    return enterSegment(segments.length - 1, segments, nowMillis)
  }
  if (state._tag !== 'running' && state._tag !== 'paused') {
    return state
  }
  return state.segmentIndex === 0
    ? state
    : enterSegment(state.segmentIndex - 1, segments, nowMillis)
}

/** Any state → idle. */
export const quit = (_state: TimerState): TimerState => new TimerIdle({})

/** Time left in the current segment: 0 when idle or done. */
export const remainingMillis = (state: TimerState, nowMillis: number): number => {
  if (state._tag === 'running') {
    return Math.max(0, state.endsAtMillis - nowMillis)
  }
  return state._tag === 'paused' ? state.remainingMillis : 0
}

/** The whole driver contract: sleep until this, then call `advanceIfDue`. */
export const nextTransitionAt = (state: TimerState): Option.Option<number> =>
  state._tag === 'running' ? Option.some(state.endsAtMillis) : Option.none()
