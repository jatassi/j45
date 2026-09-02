// The player's countdown format is pure — no dom, no react, no environment.
// It is tested directly here, the way `progress-strip.test.ts` and
// `manual-workout.test.ts` exercise the other pure derivations in the client.
import { describe, expect, it } from 'vitest'

import { countdownArcShare, countdownTypeScale, formatCountdown } from '@/player/countdown-format'

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
    // A second stays on screen until it has fully elapsed: any part of the
    // 45th second still reads 45.
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
    // Five characters are reachable. The digits are rebucketed here.
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

describe('countdownArcShare', () => {
  it('sizes one and two characters the same, so 10 to 9 does not change size', () => {
    expect(countdownArcShare('9')).toBe(countdownArcShare('10'))
  })

  it('takes the share of the arc each bucket is given', () => {
    expect(countdownArcShare('45')).toBe(0.28)
    expect(countdownArcShare('1:30')).toBe(0.21)
    expect(countdownArcShare('10:00')).toBe(0.165)
  })

  it('never gives a longer countdown a larger share, so the count only grows as time runs out', () => {
    const ladder = ['9', '45', '1:30', '10:00', '100:00']
    const shares = ladder.map(countdownArcShare)
    for (let i = 1; i < shares.length; i++) {
      expect(shares[i]).toBeLessThanOrEqual(shares[i - 1])
    }
    // The one- and two-character bucket is the largest of all of them, which
    // is what makes the 1:00 boundary a swell rather than a drop.
    expect(Math.max(...shares)).toBe(countdownArcShare('45'))
  })

  // The arc's geometry, which the module does not hold. Its stroke is 15 units
  // on a 300-unit box and its radius is 142.5, so the circle the countdown must
  // stay inside has a radius of 135 units — 0.45 of the arc's width. The
  // countdown's centre is on the chord, so its ink reaches half an ink height
  // above the chord, and its top corner is the point closest to the stroke.
  //
  // The font measurements below are the same ones the module holds — they are
  // measured facts about the player's font, not a second opinion. What is
  // independent here is the radius and the derivation they feed.
  const INNER_RADIUS_SHARE = 0.45
  const FIGURE_EM = 0.624
  const COLON_EM = 0.306
  const INK_EM = 0.742

  /** How far the countdown's top corner sits from the arc's centre, as a share of its width. */
  function cornerShare(countdown: string): number {
    let widthEm = 0
    for (const character of countdown) {
      widthEm += character === ':' ? COLON_EM : FIGURE_EM
    }
    return countdownArcShare(countdown) * Math.hypot(widthEm / 2, INK_EM / 2)
  }

  it('keeps every bucket inside the arc, with room to breathe', () => {
    for (const countdown of ['9', '45', '1:30', '10:00']) {
      expect(cornerShare(countdown)).toBeLessThanOrEqual(INNER_RADIUS_SHARE)
      // Well inside, not merely inside: no bucket reaches even 0.6 of the
      // radius. The count was pulled back from the stroke on purpose, and a
      // share that crept out towards it again would fail here.
      expect(cornerShare(countdown)).toBeLessThan(INNER_RADIUS_SHARE * 0.6)
    }
  })

  it('keeps shrinking past the buckets, so an hour-long segment still fits', () => {
    expect(cornerShare('100:00')).toBeLessThanOrEqual(INNER_RADIUS_SHARE)
    expect(cornerShare('1000:00')).toBeLessThanOrEqual(INNER_RADIUS_SHARE)
  })

  it('stays a finite share for a countdown with no characters', () => {
    expect(Number.isFinite(countdownArcShare(''))).toBe(true)
  })
})

// The two boundaries the format crosses, walked as the countdown walks them.
// Each one is a millisecond either side of a real transition, so a bucket that
// broke the minute path or the ten-minute path fails here.
describe('formatCountdown into countdownArcShare', () => {
  const shareAt = (millis: number): number => countdownArcShare(formatCountdown(millis))

  it('swells across 1:00 to 59, and that step is intended', () => {
    expect(formatCountdown(59_001)).toBe('1:00')
    expect(formatCountdown(59_000)).toBe('59')
    expect(shareAt(59_001)).toBe(0.21)
    expect(shareAt(59_000)).toBe(0.28)
    // About a third taller on entering the last minute — the one step the
    // scale takes on purpose, and it must stay a swell.
    expect(shareAt(59_000) / shareAt(59_001)).toBeCloseTo(1.33, 2)
    expect(shareAt(59_000)).toBeGreaterThan(shareAt(59_001))
  })

  it('shrinks across 9:59 to 10:00, so a long finisher still fits', () => {
    expect(formatCountdown(599_000)).toBe('9:59')
    expect(formatCountdown(600_000)).toBe('10:00')
    expect(shareAt(599_000)).toBe(0.21)
    expect(shareAt(600_000)).toBe(0.165)
  })

  it('holds one size across 1:00 down to the completion value', () => {
    // Every whole second under a minute, plus `0`, is one or two characters,
    // so nothing between the last minute and the end changes size.
    const shares = new Set<number>()
    for (let seconds = 0; seconds <= 59; seconds++) {
      shares.add(shareAt(seconds * 1000))
    }
    expect([...shares]).toEqual([0.28])
  })
})

describe('countdownTypeScale', () => {
  it('writes the share as a length off the arc, never off the viewport', () => {
    expect(countdownTypeScale('45')).toBe('calc(var(--arc-width) * 0.28)')
    for (const countdown of ['9', '45', '1:30', '10:00', '100:00']) {
      expect(countdownTypeScale(countdown)).toContain('var(--arc-width)')
      expect(countdownTypeScale(countdown)).not.toMatch(/vw|vh|svh|dvh|lvh/)
    }
  })
})
