// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ProgressRing, RING_CIRCUMFERENCE } from '@/components/player/progress-ring'
import type { SceneProxyHandle } from '@/glass/scene'
import { sceneRegistry } from '@/glass/scene'

function handle(): SceneProxyHandle {
  return { update: vi.fn(), invalidate: vi.fn(), dispose: vi.fn() }
}

/** Read the progress arc's rendered dashoffset for a given remaining fraction. */
function offsetAt(fraction: number): string {
  const { unmount } = render(
    <ProgressRing fraction={fraction} phase="work">
      <span>12:00</span>
    </ProgressRing>,
  )
  const arc = screen.getByTestId('player-progress-ring-arc')
  const dasharray = arc.getAttribute('stroke-dasharray')
  const dashoffset = arc.getAttribute('stroke-dashoffset')
  expect(dasharray).toBe(String(RING_CIRCUMFERENCE))
  unmount()
  return dashoffset ?? ''
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('ProgressRing — depleting dashoffset math', () => {
  it('offsets 0 at full, half circumference at 0.5, full circumference at empty', () => {
    vi.spyOn(sceneRegistry, 'register').mockReturnValue(handle())

    expect(offsetAt(1)).toBe('0')
    expect(Number(offsetAt(0.5))).toBeCloseTo(RING_CIRCUMFERENCE / 2, 10)
    expect(offsetAt(0)).toBe(String(RING_CIRCUMFERENCE))
  })
})

describe('ProgressRing — centered children + dirty-region proxy', () => {
  it('centers arbitrary children and registers a dirty-region proxy for the digits', () => {
    const register = vi.spyOn(sceneRegistry, 'register').mockReturnValue(handle())

    render(
      <ProgressRing fraction={0.5} phase="work" dirtyValue="12:00">
        <span data-testid="ring-digits">12:00</span>
      </ProgressRing>,
    )

    expect(screen.getByTestId('ring-digits').textContent).toBe('12:00')
    expect(register).toHaveBeenCalledTimes(1)
  })

  it('invalidates the digit proxy when the displayed value changes', () => {
    const h = handle()
    vi.spyOn(sceneRegistry, 'register').mockReturnValue(h)

    const { rerender } = render(
      <ProgressRing fraction={0.5} phase="work" dirtyValue="12:00">
        <span>12:00</span>
      </ProgressRing>,
    )
    expect(h.invalidate).not.toHaveBeenCalled()

    rerender(
      <ProgressRing fraction={0.49} phase="work" dirtyValue="11:59">
        <span>11:59</span>
      </ProgressRing>,
    )
    expect(h.invalidate).toHaveBeenCalledTimes(1)
  })
})
