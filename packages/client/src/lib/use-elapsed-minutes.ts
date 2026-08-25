import { useEffect, useState } from 'react'

import * as DateTime from 'effect/DateTime'

const MINUTE_MS = 60_000

/** Milliseconds since `startedAtMillis` on this clock. Negative before it. */
function elapsedMillisOf(startedAtMillis: number): number {
  return Date.now() - startedAtMillis
}

/** Whole minutes since `startedAtMillis`, clamped at 0. */
function elapsedMinutesOf(startedAtMillis: number): number {
  return Math.floor(Math.max(0, elapsedMillisOf(startedAtMillis)) / MINUTE_MS)
}

/**
 * Milliseconds until the whole-minute count next turns over. The delay comes
 * from the start time, not from the last tick, so the count turns over on the
 * boundary. It does not turn over up to a minute after it.
 *
 * A start time that this clock has not reached gives the delay to the start
 * time itself. The count is thus aligned from its first minute.
 */
function millisUntilNextTurnover(startedAtMillis: number): number {
  const elapsed = elapsedMillisOf(startedAtMillis)
  return elapsed < 0 ? -elapsed : MINUTE_MS - (elapsed % MINUTE_MS)
}

/**
 * Whole minutes since `startedAt`, on a clock of its own: the count advances
 * when no new session data arrives.
 *
 * The first render reads the wall clock, so the count is correct before the
 * first tick. Each tick reads the wall clock again. It does not add one to
 * the last value. A tab that was suspended, or a timer that fired late, thus
 * gives the correct count on the next tick instead of a count that drifts.
 *
 * A start time that this clock has not reached — a host whose clock runs
 * ahead — reads as 0, not as a negative count.
 */
export function useElapsedMinutes(startedAt: DateTime.Utc): number {
  const startedAtMillis = DateTime.toEpochMillis(startedAt)
  const [minutes, setMinutes] = useState(() => elapsedMinutesOf(startedAtMillis))

  useEffect(() => {
    setMinutes(elapsedMinutesOf(startedAtMillis))

    let handle: ReturnType<typeof globalThis.setTimeout> | undefined
    const scheduleNextTurnover = (): void => {
      handle = globalThis.setTimeout(() => {
        setMinutes(elapsedMinutesOf(startedAtMillis))
        scheduleNextTurnover()
      }, millisUntilNextTurnover(startedAtMillis))
    }
    scheduleNextTurnover()

    return () => {
      globalThis.clearTimeout(handle)
    }
  }, [startedAtMillis])

  return minutes
}
