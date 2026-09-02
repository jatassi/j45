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

/**
 * How wide the player's tabular figures set, in em, measured on the running
 * app. A colon is narrower than a figure: tabular figures make the *figures*
 * one width, and leave the colon its own.
 *
 * These measurements are what make the buckets below necessary. A `Segment`
 * has no upper bound, so one size for every reachable value would have to be
 * the size the longest one fits at, and the two-character case — which a
 * Session shows for most of its running time — would be set far below what its
 * own arc has room for. The buckets let the common case take the room it has.
 */
const FIGURE_EM = 0.624
const COLON_EM = 0.306

/**
 * The share of the arc's width the countdown takes, by its character count.
 *
 * **One and two characters share a bucket on purpose.** A scale that read the
 * literal character count would make `10` → `9` jump about 48%, once every
 * interval, at the moment a Participant watches most, with no phase change
 * behind it. That reads as a fault in the layout.
 *
 * **The order of the buckets is the rule they must not break.** The countdown
 * grows as the time runs out and never the other way, so the two-character
 * bucket is the largest and the five-character bucket the smallest. A step
 * that shrank the count on entering the last minute would say the wrong thing
 * at the moment it is read hardest.
 *
 * The `1:00` → `59` step is therefore a swell, by about a third. It used to be
 * about 57%, which set the two-character case so large that it crowded the arc
 * it sits in. A third is still plainly a swell, and it lands on a boundary the
 * Participant already feels.
 *
 * The shares are set by eye against the arc, and the geometry only bounds
 * them. A figure carries 0.742em of ink, and the countdown's centre is on the
 * arc's chord, so the ink reaches 0.371em above the chord and the top corner of
 * it is the point nearest the stroke. That corner must stay inside a circle of
 * radius 135 on the arc's 300-unit box — 0.45 of the arc's width — which is the
 * arc's radius (142.5) less half its stroke (15). Every bucket here sits at
 * about half of that, which is the room the count was asked to give back.
 * `player-progress-arc.test.tsx` holds that geometry, and
 * `player-countdown-format.test.ts` checks these shares against it and against
 * their order; a change to the arc must bring the shares with it.
 */
const SHARE_BY_CHARACTERS = new Map<number, number>([
  [1, 0.28],
  [2, 0.28],
  [4, 0.21],
  [5, 0.165],
])

/** The largest share the table gives: the one- and two-character bucket. */
const LARGEST_SHARE = 0.28
/** The longest countdown the table holds, and the share it takes. */
const LONGEST_IN_TABLE = { countdown: '10:00', share: 0.165 }

/** How wide `countdown` sets, in em, at whatever size it is given. */
function widthEm(countdown: string): number {
  let em = 0
  for (const character of countdown) {
    em += character === ':' ? COLON_EM : FIGURE_EM
  }
  return em
}

/**
 * The share of the arc's width `countdown` takes — the bucket decision, as a
 * plain number. See {@link SHARE_BY_CHARACTERS} for the buckets and why they
 * are what they are.
 *
 * The share comes from the character count, not from the value.
 *
 * A `Segment`'s duration has no upper bound, so a countdown can run past the
 * table — `100:00` is six characters. Off the table the share shrinks with the
 * width, measured off the longest bucket, so a countdown of any length still
 * fits inside the arc. The largest bucket is the ceiling on that, which keeps
 * the share finite for a countdown with no characters at all.
 */
export function countdownArcShare(countdown: string): number {
  const bucket = SHARE_BY_CHARACTERS.get(countdown.length)
  if (bucket !== undefined) {
    return bucket
  }
  const byWidth =
    (LONGEST_IN_TABLE.share * widthEm(LONGEST_IN_TABLE.countdown)) / widthEm(countdown)
  return Number(Math.min(LARGEST_SHARE, byWidth).toFixed(4))
}

/**
 * The type scale for `countdown`, as a CSS length: {@link countdownArcShare}
 * of `--arc-width`, which the arc box publishes. The scale therefore stays
 * exact at every arc size, on both player screens, and it reads no viewport
 * term at all.
 */
export function countdownTypeScale(countdown: string): string {
  return `calc(var(--arc-width) * ${countdownArcShare(countdown)})`
}
