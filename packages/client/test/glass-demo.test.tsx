// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { GlassDemo } from '@/glass-demo'
import type { DocRect, SceneProxy, SceneProxyHandle } from '@/glass/scene'
import { sceneRegistry } from '@/glass/scene'

// jsdom has no WebGL2 — surfaces stay on the css tier. We still exercise
// demo wiring: mounts, proxy registration, button handle calls, and layout.

const handles: SceneProxyHandle[] = []
const registered: SceneProxy[] = []

function makeHandle(): SceneProxyHandle {
  const handle: SceneProxyHandle = {
    update: vi.fn(),
    invalidate: vi.fn(),
    dispose: vi.fn(),
  }
  handles.push(handle)
  return handle
}

function mockCalls(fn: (...args: never[]) => unknown): unknown[][] {
  return vi.mocked(fn).mock.calls
}

beforeEach(() => {
  handles.length = 0
  registered.length = 0
  vi.spyOn(sceneRegistry, 'register').mockImplementation((proxy) => {
    registered.push(proxy)
    return makeHandle()
  })
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe(): void {
        /* no-op */
      }
      disconnect(): void {
        /* no-op */
      }
    },
  )
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    left: 100,
    top: 100,
    width: 120,
    height: 80,
    right: 220,
    bottom: 180,
    x: 100,
    y: 100,
    toJSON: () => ({}),
  })
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('GlassDemo — mount surface + fixture ids', () => {
  it('mounts the fixed bar, three sized surfaces, capped surface, mutating text, tier indicator, and perf controls', () => {
    render(<GlassDemo />)

    expect(screen.getByTestId('glass-fixed-bar')).toBeTruthy()
    expect(screen.getByTestId('glass-surface-small')).toBeTruthy()
    expect(screen.getByTestId('glass-surface-medium')).toBeTruthy()
    expect(screen.getByTestId('glass-surface-large')).toBeTruthy()
    expect(screen.getByTestId('glass-capped-surface')).toBeTruthy()
    expect(screen.getByTestId('glass-mutating-text')).toBeTruthy()
    expect(screen.getByTestId('glass-tier-indicator')).toBeTruthy()
    expect(screen.getByTestId('glass-move-proxy')).toBeTruthy()
    expect(screen.getByTestId('glass-proxy-color')).toBeTruthy()
    expect(screen.getByTestId('glass-perf-start')).toBeTruthy()
    expect(screen.getByTestId('glass-perf-scenario')).toBeTruthy()
    expect(screen.getByTestId('glass-ticking-digit')).toBeTruthy()
  })

  it('is tall enough to scroll (min-height well above one viewport)', () => {
    const { container } = render(<GlassDemo />)
    const root = container.firstElementChild
    expect(root instanceof HTMLElement && root.className).toMatch(/min-h-\[200vh\]/)
  })

  it('puts fixed positioning on a wrapper, not on the glass-fixed-bar surface itself', () => {
    render(<GlassDemo />)
    const bar = screen.getByTestId('glass-fixed-bar')
    expect(bar.classList.contains('glass-surface')).toBe(true)
    const wrapper = bar.parentElement
    expect(wrapper instanceof HTMLElement && wrapper.className).toMatch(/\bfixed\b/)
    expect(bar.className).not.toMatch(/\bfixed\b/)
  })

  it('mounts the capped surface with maxTier css (stays data-glass-tier=css)', () => {
    render(<GlassDemo />)
    const capped = screen.getByTestId('glass-capped-surface')
    expect(capped.dataset.glassTier).toBe('css')
  })

  it('registers scene proxies that are not glass surfaces', () => {
    render(<GlassDemo />)

    expect(registered.length).toBeGreaterThanOrEqual(2)
    for (const proxy of registered) {
      const source = proxy.source
      if (source instanceof Element) {
        expect(source.closest('.glass-surface')).toBeNull()
        expect(source.classList.contains('glass-surface')).toBe(false)
      }
    }
  })
})

describe('GlassDemo — movable / recolorable proxy controls', () => {
  it('glass-move-proxy calls handle.update on the registered movable proxy', () => {
    render(<GlassDemo />)

    const updatesBefore = handles.map((h) => mockCalls(h.update).length)

    fireEvent.click(screen.getByTestId('glass-move-proxy'))

    const anyUpdated = handles.some((h, i) => mockCalls(h.update).length > (updatesBefore[i] ?? 0))
    expect(anyUpdated).toBe(true)

    const moveHandle = handles.find((h) => mockCalls(h.update).length > 0)
    expect(moveHandle).toBeDefined()
    const last = mockCalls(moveHandle?.update ?? vi.fn()).at(-1)?.[0] as
      { rect?: DocRect } | undefined
    expect(last?.rect).toBeDefined()
  })

  it('glass-proxy-color calls handle.update + handle.invalidate', () => {
    render(<GlassDemo />)

    fireEvent.click(screen.getByTestId('glass-proxy-color'))

    const recolorHandle = handles.find((h) => mockCalls(h.invalidate).length > 0)
    expect(recolorHandle).toBeDefined()
    if (recolorHandle) {
      expect(recolorHandle.update).toHaveBeenCalled()
      expect(recolorHandle.invalidate).toHaveBeenCalled()
    }
  })
})

describe('GlassDemo — mutating text steady-state', () => {
  it('glass-mutating-text mutates every 250ms', () => {
    vi.useFakeTimers()
    render(<GlassDemo />)

    const text = screen.getByTestId('glass-mutating-text')
    expect(text.textContent).toMatch(/tick 0/)

    act(() => {
      vi.advanceTimersByTime(250)
    })
    expect(text.textContent).toMatch(/tick 1/)

    act(() => {
      vi.advanceTimersByTime(500)
    })
    expect(text.textContent).toMatch(/tick 3/)
  })
})

describe('GlassDemo — perf start arms the ticking digit', () => {
  it('clicking glass-perf-start arms the scenario (ticking digit begins invalidating)', () => {
    vi.useFakeTimers()
    render(<GlassDemo />)

    const countInvalidates = (): number =>
      handles.reduce((sum, h) => sum + mockCalls(h.invalidate).length, 0)

    const invalidatesBefore = countInvalidates()
    act(() => {
      vi.advanceTimersByTime(5000)
    })
    expect(countInvalidates()).toBe(invalidatesBefore)

    fireEvent.click(screen.getByTestId('glass-perf-start'))

    act(() => {
      vi.advanceTimersByTime(1000)
    })
    expect(countInvalidates()).toBeGreaterThan(invalidatesBefore)
  })
})
