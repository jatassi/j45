// The player's countdown format is pure — no dom, no react, no environment.
// It is tested directly here, the way `progress-strip.test.ts` and
// `manual-workout.test.ts` exercise the other pure derivations in the client.
import { describe, expect, it } from 'vitest'

import { formatCountdown } from '@/player/countdown-format'

describe('formatCountdown', () => {
  it('drops the leading zero minute under a minute', () => {
    expect(formatCountdown(45_000)).toBe('45')
    expect(formatCountdown(9000)).toBe('9')
  })

  it('writes a minute and over as m:ss, zero-padding the seconds', () => {
    expect(formatCountdown(90_000)).toBe('1:30')
    expect(formatCountdown(61_000)).toBe('1:01')
    expect(formatCountdown(120_000)).toBe('2:00')
  })

  it('reads 0 when the segment is complete', () => {
    expect(formatCountdown(0)).toBe('0')
  })

  it('rounds up to the next whole second, never showing less time than is left', () => {
    // A second is on screen until it has fully elapsed: any part of the 45th
    // second still reads 45. This is `formatDuration`'s convention and the
    // whole second `useCountdown` cues the 3-2-1 beeps from, so the digits,
    // the beeps and the urgency tint all change on one boundary.
    expect(formatCountdown(44_999)).toBe('45')
    expect(formatCountdown(44_001)).toBe('45')
    expect(formatCountdown(44_000)).toBe('44')
    expect(formatCountdown(1)).toBe('1')
  })

  it('crosses the 1:00 boundary in both directions', () => {
    expect(formatCountdown(60_000)).toBe('1:00')
    expect(formatCountdown(59_001)).toBe('1:00')
    // 59 whole seconds left is the first value that drops the minute.
    expect(formatCountdown(59_000)).toBe('59')
    expect(formatCountdown(58_999)).toBe('59')
  })

  it('crosses the 10:00 boundary in both directions', () => {
    // Five characters are reachable: a `Segment`'s duration has no upper
    // bound, so a long finisher is written in full rather than capped.
    expect(formatCountdown(600_000)).toBe('10:00')
    expect(formatCountdown(599_001)).toBe('10:00')
    expect(formatCountdown(599_000)).toBe('9:59')
    expect(formatCountdown(601_000)).toBe('10:01')
  })

  it('writes durations well past ten minutes rather than assuming them away', () => {
    expect(formatCountdown(720_000)).toBe('12:00')
    expect(formatCountdown(3_600_000)).toBe('60:00')
    expect(formatCountdown(3_661_000)).toBe('61:01')
  })

  it('clamps a non-positive remainder to the completion value', () => {
    expect(formatCountdown(-1)).toBe('0')
    expect(formatCountdown(-1500)).toBe('0')
  })
})
