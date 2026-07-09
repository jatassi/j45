import { useEffect, useRef, useState } from 'react'

export type UseCountdownResult = {
  /** Milliseconds until the deadline, clamped at 0. `null` when no deadline is active. */
  remainingMillis: number | null
}

export type UseCountdownOptions = {
  /**
   * Fires once per whole-second boundary crossed while counting down. The
   * argument is the new `ceil(remaining/1000)` value (e.g. 3, then 2, then 1,
   * then 0). Subscribers drive 3-2-1 and segment-boundary beeps from this —
   * not from the high-frequency remaining-time render updates.
   */
  onSecondTransition?: (wholeSeconds: number) => void
}

function remainingOf(deadlineMillis: number): number {
  return Math.max(0, deadlineMillis - Date.now())
}

/** Whole seconds left for cueing — matches `formatDuration`'s ceil convention. */
function wholeSecondsOf(remainingMillis: number): number {
  return Math.ceil(remainingMillis / 1000)
}

/**
 * One rAF loop interpolating `deadline − now` for smooth display. Seeds its
 * whole-second cursor on the first sample so a new deadline never re-fires
 * the second the previous one was on; subsequent decreases emit each crossed
 * boundary once (including multi-second catch-up after a long frame).
 */
function startLoop(
  deadlineMillis: number,
  onRemaining: (remainingMillis: number) => void,
  onSecond: (wholeSeconds: number) => void,
): () => void {
  let rafId = 0
  let lastWhole: number | null = null
  let stopped = false

  const tick = (): void => {
    if (stopped) {
      return
    }
    const remaining = remainingOf(deadlineMillis)
    onRemaining(remaining)

    const whole = wholeSecondsOf(remaining)
    if (lastWhole === null) {
      lastWhole = whole
    } else if (whole < lastWhole) {
      for (let second = lastWhole - 1; second >= whole; second--) {
        onSecond(second)
      }
      lastWhole = whole
    }

    if (remaining > 0) {
      rafId = requestAnimationFrame(tick)
    }
  }

  rafId = requestAnimationFrame(tick)
  return () => {
    stopped = true
    cancelAnimationFrame(rafId)
  }
}

/**
 * Display-only countdown against an absolute `deadlineMillis` owned elsewhere
 * (domain timer). Never advances timer state. Pass `null` while idle — no rAF
 * loop runs and remaining reads as absent.
 */
export function useCountdown(
  deadlineMillis: number | null,
  options?: UseCountdownOptions,
): UseCountdownResult {
  const [remainingMillis, setRemainingMillis] = useState<number | null>(() =>
    deadlineMillis === null ? null : remainingOf(deadlineMillis),
  )

  // Latest callback without restarting the rAF effect on every render.
  const onSecondRef = useRef(options?.onSecondTransition)
  onSecondRef.current = options?.onSecondTransition

  useEffect(() => {
    if (deadlineMillis === null) {
      setRemainingMillis(null)
      return undefined
    }
    setRemainingMillis(remainingOf(deadlineMillis))
    return startLoop(deadlineMillis, setRemainingMillis, (second) => onSecondRef.current?.(second))
  }, [deadlineMillis])

  return { remainingMillis }
}
