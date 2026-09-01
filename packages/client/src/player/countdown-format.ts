/**
 * How the player writes the countdown, which a Participant reads from several
 * metres away. Pure: milliseconds in, the string on screen out, no dom and no
 * react.
 *
 * Under a minute the leading `0:` is dropped — `0:45` reads `45`. A Session
 * spends most of its time under a minute, and two characters fit far larger
 * than four. The **Progress arc** leaves an open gap below it, and this is
 * what lets the digits grow into that gap.
 *
 * The live Session player and the manual timer both use this, the manual
 * timer's idle preview included, so the countdown reads the same way before a
 * run starts as it does during it.
 *
 * This is deliberately not `formatDuration` in `@/lib/workouts`. Six screens —
 * home, library, workout detail, generate, and both editor drafts — write a
 * duration as `m:ss` and want the minute even when it is zero, because there
 * `0:45` is a workout's whole length and not a count running down. The two
 * share the rounding convention below and nothing else.
 */

/**
 * `remainingMillis` as the player's countdown: `9`, `45`, `1:30`, `10:00`.
 *
 * Rounds up to the next whole second, matching `formatDuration` and the whole
 * second `useCountdown` cues from, so the digits, the beeps and the urgency
 * tint all change on the same boundary.
 *
 * A `Segment`'s duration has no upper bound, so `10:00` and longer are
 * reachable and are written in full. Nothing here is capped.
 *
 * Non-positive input reads `0`, which is the completion state. Clamping keeps
 * the function total: without it a negative would print a negative minute and
 * a negative second.
 */
export function formatCountdown(remainingMillis: number): string {
  const totalSeconds = Math.max(0, Math.ceil(remainingMillis / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  if (minutes === 0) {
    return String(seconds)
  }
  return `${minutes}:${seconds.toString().padStart(2, '0')}`
}
