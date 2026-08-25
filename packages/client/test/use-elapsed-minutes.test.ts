// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import * as DateTime from 'effect/DateTime'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useElapsedMinutes } from '@/lib/use-elapsed-minutes'

/** Advance the fake clock by `ms` and flush the React updates it causes. */
async function advance(ms: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}

const now = '2026-03-01T10:00:00.000Z'

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date(now))
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('useElapsedMinutes', () => {
  it('reads the whole minutes elapsed on the first render, before any tick', () => {
    const startedAt = DateTime.unsafeMake('2026-03-01T09:47:20.000Z')
    const { result } = renderHook(() => useElapsedMinutes(startedAt))

    expect(result.current).toBe(12)
  })

  it('turns over on the minute boundary with no new session data', async () => {
    const startedAt = DateTime.unsafeMake('2026-03-01T09:47:20.000Z')
    const { result } = renderHook(() => useElapsedMinutes(startedAt))

    expect(result.current).toBe(12)

    // One second short of the boundary — still the same whole minute.
    await advance(19_000)
    expect(result.current).toBe(12)

    // Crossing 13 minutes elapsed.
    await advance(1000)
    expect(result.current).toBe(13)

    // And it keeps going, one minute at a time.
    await advance(60_000)
    expect(result.current).toBe(14)
    await advance(60_000)
    expect(result.current).toBe(15)
  })

  it('does not re-render between boundaries', async () => {
    const startedAt = DateTime.unsafeMake('2026-03-01T09:47:20.000Z')
    let renders = 0
    renderHook(() => {
      renders += 1
      return useElapsedMinutes(startedAt)
    })
    const seeded = renders

    await advance(19_000)
    expect(renders).toBe(seeded)
  })

  it('reads a session that has just started as zero minutes', async () => {
    const startedAt = DateTime.unsafeMake(now)
    const { result } = renderHook(() => useElapsedMinutes(startedAt))

    expect(result.current).toBe(0)

    await advance(59_000)
    expect(result.current).toBe(0)
    await advance(1000)
    expect(result.current).toBe(1)
  })

  it('clamps a start time ahead of this clock to zero minutes', async () => {
    const startedAt = DateTime.unsafeMake('2026-03-01T10:05:00.000Z')
    const { result } = renderHook(() => useElapsedMinutes(startedAt))

    expect(result.current).toBe(0)

    await advance(240_000)
    expect(result.current).toBe(0)
  })

  it('leaves no timer behind when it unmounts', async () => {
    const startedAt = DateTime.unsafeMake('2026-03-01T09:47:20.000Z')
    const { result, unmount } = renderHook(() => useElapsedMinutes(startedAt))

    await advance(20_000)
    expect(result.current).toBe(13)

    unmount()
    expect(vi.getTimerCount()).toBe(0)

    await advance(300_000)
    expect(result.current).toBe(13)
  })

  it('re-seeds when the start time changes', () => {
    const first = DateTime.unsafeMake('2026-03-01T09:47:20.000Z')
    const second = DateTime.unsafeMake('2026-03-01T09:30:00.000Z')
    const { result, rerender } = renderHook(
      ({ startedAt }: { startedAt: DateTime.Utc }) => useElapsedMinutes(startedAt),
      { initialProps: { startedAt: first } },
    )

    expect(result.current).toBe(12)

    rerender({ startedAt: second })
    expect(result.current).toBe(30)
  })

  it('keeps its schedule across an equal start time decoded into a new value', async () => {
    const startedAt = DateTime.unsafeMake('2026-03-01T09:47:20.000Z')
    const { result, rerender } = renderHook(
      ({ startedAt: at }: { startedAt: DateTime.Utc }) => useElapsedMinutes(at),
      { initialProps: { startedAt } },
    )

    // A fresh snapshot carries an equal-but-not-identical start time.
    await advance(10_000)
    rerender({ startedAt: DateTime.unsafeMake('2026-03-01T09:47:20.000Z') })
    expect(result.current).toBe(12)

    await advance(10_000)
    expect(result.current).toBe(13)
  })
})
