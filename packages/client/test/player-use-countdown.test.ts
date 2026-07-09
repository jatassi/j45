// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useCountdown } from '@/player/use-countdown'

/** Flush one rAF tick under fake timers (React state updates included). */
function nextFrame(): void {
  act(() => {
    vi.advanceTimersToNextFrame()
  })
}

/** Advance fake clock by `ms` and flush any rAF callbacks scheduled along the way. */
async function advance(ms: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(1_000_000)
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('useCountdown', () => {
  it('interpolates remaining time on sub-second rAF ticks', async () => {
    const deadline = Date.now() + 3500
    const { result } = renderHook(() => useCountdown(deadline))

    nextFrame()
    const first = result.current.remainingMillis
    expect(first).not.toBeNull()
    expect(first).toBeGreaterThan(3400)
    expect(first).toBeLessThanOrEqual(3500)

    await advance(100)
    const second = result.current.remainingMillis
    expect(second).not.toBeNull()
    if (first === null || second === null) {
      return
    }
    // Smooth update: moved by ~100ms, not stuck on a whole-second step.
    expect(first - second).toBeGreaterThan(50)
    expect(first - second).toBeLessThan(200)
    // Still the same whole second (ceil 4 → still > 3000).
    expect(second).toBeGreaterThan(3000)
  })

  it('emits each whole-second transition exactly once with the correct second', async () => {
    const onSecondTransition = vi.fn()
    // Start just under 4s so the seed is 4; first boundary crossed is 3.
    const deadline = Date.now() + 3500
    const { result } = renderHook(() => useCountdown(deadline, { onSecondTransition }))

    nextFrame()
    // Seeded at ceil(3500/1000)=4 — no transition on the first sample.
    expect(onSecondTransition).not.toHaveBeenCalled()
    expect(result.current.remainingMillis).toBeGreaterThan(3000)

    // Cross the 4 → 3 boundary (remaining hits 3000).
    await advance(500)
    expect(onSecondTransition).toHaveBeenCalledTimes(1)
    expect(onSecondTransition).toHaveBeenCalledWith(3)
    expect(result.current.remainingMillis).toBeLessThanOrEqual(3000)
    expect(result.current.remainingMillis).toBeGreaterThan(2000)

    // Further sub-second frames inside the "3" bucket must not re-fire.
    onSecondTransition.mockClear()
    await advance(400)
    expect(onSecondTransition).not.toHaveBeenCalled()

    // Cross 3 → 2 (remaining hits 2000).
    await advance(600)
    expect(onSecondTransition).toHaveBeenCalledTimes(1)
    expect(onSecondTransition).toHaveBeenCalledWith(2)
  })

  it('with a null deadline: remaining is absent, no rAF loop, no transitions', async () => {
    const onSecondTransition = vi.fn()
    const rafSpy = vi.spyOn(globalThis, 'requestAnimationFrame')

    const { result } = renderHook(() => useCountdown(null, { onSecondTransition }))

    expect(result.current.remainingMillis).toBeNull()
    expect(onSecondTransition).not.toHaveBeenCalled()
    expect(rafSpy).not.toHaveBeenCalled()

    const timersBefore = vi.getTimerCount()
    await advance(1000)
    expect(vi.getTimerCount()).toBe(timersBefore)
    expect(onSecondTransition).not.toHaveBeenCalled()
    expect(result.current.remainingMillis).toBeNull()

    rafSpy.mockRestore()
  })

  it('resets cleanly when deadlineMillis changes (no leaked transition)', async () => {
    const onSecondTransition = vi.fn()
    const start = Date.now()
    type Props = { deadline: number | null }
    const initial: Props = { deadline: start + 4500 }
    const { result, rerender } = renderHook(
      ({ deadline }: Props) => useCountdown(deadline, { onSecondTransition }),
      { initialProps: initial },
    )

    nextFrame()
    // Seed at ceil(4500)=5. Advance 1000ms → remaining ~3500, ceil 4 → emit 4.
    await advance(1000)
    expect(onSecondTransition).toHaveBeenCalledWith(4)
    onSecondTransition.mockClear()

    // New segment: ~2500ms left (ceil 3). If lastWhole leaked as 4, the first
    // tick would immediately fire 3 without time passing — that must not happen.
    const now = Date.now()
    rerender({ deadline: now + 2500 })
    nextFrame()
    expect(onSecondTransition).not.toHaveBeenCalled()
    expect(result.current.remainingMillis).toBeGreaterThan(2400)
    expect(result.current.remainingMillis).toBeLessThanOrEqual(2500)

    // Crossing the new deadline's 3 → 2 boundary still works once.
    await advance(500)
    expect(onSecondTransition).toHaveBeenCalledTimes(1)
    expect(onSecondTransition).toHaveBeenCalledWith(2)
  })

  it('stops the rAF loop when deadline becomes null', async () => {
    const onSecondTransition = vi.fn()
    type Props = { deadline: number | null }
    const initial: Props = { deadline: Date.now() + 5000 }
    const { result, rerender } = renderHook(
      ({ deadline }: Props) => useCountdown(deadline, { onSecondTransition }),
      { initialProps: initial },
    )

    nextFrame()
    expect(vi.getTimerCount()).toBeGreaterThan(0)

    rerender({ deadline: null })
    // Effect cleanup cancels the pending rAF; remaining clears synchronously
    // after the null-deadline effect runs.
    expect(result.current.remainingMillis).toBeNull()
    onSecondTransition.mockClear()
    const timersAfter = vi.getTimerCount()
    await advance(500)
    expect(vi.getTimerCount()).toBe(timersAfter)
    expect(onSecondTransition).not.toHaveBeenCalled()
  })
})
