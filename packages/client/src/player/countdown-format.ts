/**
 * How the player writes the countdown, as the participant reads it across the
 * gym floor. Pure: milliseconds in, the string on screen out, no dom and no
 * react. Both the live session player and the manual timer use it, the manual
 * timer's idle preview included, so what a member sets is what they see.
 *
 * Under a minute the leading `0:` is dropped — `0:45` reads `45`. A session
 * spends most of its time under a minute, and two characters fit far larger
 * than four. That is what pays for the digits the arc was opened to hold.
 *
 * This is deliberately not `formatDuration` in `@/lib/workouts`. Six screens —
 * home, library, workout detail, generate, and both editor drafts — write a
 * duration as `m:ss` and want the minute even when it is zero, because there
 * `0:45` is a workout's whole length and not a count running out. The two
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
