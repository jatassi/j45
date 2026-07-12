// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { DIGIT_SIZE, TICK_COUNT, TICK_INTERVAL_MS, TickingDigit } from '@/glass-demo/ticking-digit'
import type { DocRect, SceneProxy, SceneProxyHandle } from '@/glass/scene'
import { sceneRegistry } from '@/glass/scene'

const RECT: DocRect = { left: 24, top: 8, width: DIGIT_SIZE, height: DIGIT_SIZE }

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

beforeEach(() => {
  vi.useFakeTimers()
})

describe('TickingDigit', () => {
  it('registers a digit-block-sized proxy and mounts glass-ticking-digit', () => {
    const handle: SceneProxyHandle = {
      update: vi.fn(),
      invalidate: vi.fn(),
      dispose: vi.fn(),
    }
    const register = vi.spyOn(sceneRegistry, 'register').mockReturnValue(handle)

    render(<TickingDigit armed={false} rect={RECT} />)

    expect(screen.getByTestId('glass-ticking-digit')).toBeTruthy()
    expect(register).toHaveBeenCalledTimes(1)
    const firstCall = register.mock.calls.at(0)
    expect(firstCall).toBeDefined()
    if (!firstCall) {
      return
    }
    const proxy = firstCall[0]
    expect(proxy.rect).toEqual(RECT)
    expect(proxy.rect.width).toBe(DIGIT_SIZE)
    expect(proxy.rect.height).toBe(DIGIT_SIZE)
  })

  it('runs zero updates while unarmed', () => {
    const handle: SceneProxyHandle = {
      update: vi.fn(),
      invalidate: vi.fn(),
      dispose: vi.fn(),
    }
    vi.spyOn(sceneRegistry, 'register').mockReturnValue(handle)

    render(<TickingDigit armed={false} rect={RECT} />)

    act(() => {
      vi.advanceTimersByTime(TICK_INTERVAL_MS * 20)
    })

    expect(handle.invalidate).not.toHaveBeenCalled()
    expect(handle.update).not.toHaveBeenCalled()
  })

  it('once armed, fires exactly ten invalidates of the digit rect at 1 Hz, then stops', () => {
    const handle: SceneProxyHandle = {
      update: vi.fn(),
      invalidate: vi.fn(),
      dispose: vi.fn(),
    }
    vi.spyOn(sceneRegistry, 'register').mockReturnValue(handle)

    const { rerender } = render(<TickingDigit armed={false} rect={RECT} />)
    expect(handle.invalidate).not.toHaveBeenCalled()

    rerender(<TickingDigit armed rect={RECT} />)

    act(() => {
      vi.advanceTimersByTime(TICK_INTERVAL_MS * TICK_COUNT)
    })
    expect(handle.invalidate).toHaveBeenCalledTimes(TICK_COUNT)
    const invalidate = vi.mocked(handle.invalidate)
    for (const call of invalidate.mock.calls) {
      expect(call[0]).toEqual(RECT)
    }

    act(() => {
      vi.advanceTimersByTime(TICK_INTERVAL_MS * 20)
    })
    expect(handle.invalidate).toHaveBeenCalledTimes(TICK_COUNT)
  })

  it('paints only the digit block region (fillRect within digit size)', () => {
    let captured: SceneProxy | undefined
    const handle: SceneProxyHandle = {
      update: vi.fn(),
      invalidate: vi.fn(),
      dispose: vi.fn(),
    }
    vi.spyOn(sceneRegistry, 'register').mockImplementation((proxy) => {
      captured = proxy
      return handle
    })

    render(<TickingDigit armed={false} rect={RECT} />)
    expect(captured).toBeDefined()

    const fillRect = vi.fn()
    const fillText = vi.fn()
    const ctx = {
      fillStyle: '',
      font: '',
      textAlign: 'start',
      textBaseline: 'alphabetic',
      fillRect,
      fillText,
    } as unknown as CanvasRenderingContext2D

    captured?.paint(ctx)

    expect(fillRect).toHaveBeenCalledWith(0, 0, DIGIT_SIZE, DIGIT_SIZE)
    expect(fillText).toHaveBeenCalled()
    for (const call of fillRect.mock.calls) {
      expect(call[2]).toBeLessThanOrEqual(DIGIT_SIZE)
      expect(call[3]).toBeLessThanOrEqual(DIGIT_SIZE)
    }
  })

  it('disposes the registry handle on unmount', () => {
    const handle: SceneProxyHandle = {
      update: vi.fn(),
      invalidate: vi.fn(),
      dispose: vi.fn(),
    }
    vi.spyOn(sceneRegistry, 'register').mockReturnValue(handle)

    const { unmount } = render(<TickingDigit armed={false} rect={RECT} />)
    unmount()
    expect(handle.dispose).toHaveBeenCalledTimes(1)
  })
})
