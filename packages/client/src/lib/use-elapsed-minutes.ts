import { useEffect, useState } from 'react'

import * as DateTime from 'effect/DateTime'

const MINUTE_MS = 60_000

/** Whole minutes between `startedAtMillis` and the wall clock, clamped at 0. */
function elapsedMinutesOf(startedAtMillis: number): number {
  return Math.floor(Math.max(0, Date.now() - startedAtMillis) / MINUTE_MS)
}

/**
 * Milliseconds until the whole-minute count next turns over. Measured from
 * the start time, not from the last tick, so the display flips on the
 * boundary itself instead of up to a minute after it.
 */
function millisUntilNextMinute(startedAtMillis: number): number {
  const elapsed = Math.max(0, Date.now() - startedAtMillis)
  return MINUTE_MS - (elapsed % MINUTE_MS)
}

/**
 * Whole minutes since `startedAt`, on a clock of its own: it advances while
 * no new session data arrives at all.
 *
 * It is seeded from the wall clock on the first render, so it reads correctly
 * before the first tick, and each tick re-reads the wall clock rather than
 * adding one to the last value. A tab that was suspended and a timer that
 * fired late thus both heal on the next tick instead of accumulating drift.
 *
 * A start time this clock has not reached yet — a host whose clock runs
 * ahead — reads as 0 rather than a negative count.
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
      }, millisUntilNextMinute(startedAtMillis))
    }
    scheduleNextTurnover()

    return () => {
      globalThis.clearTimeout(handle)
    }
  }, [startedAtMillis])

  return minutes
}
