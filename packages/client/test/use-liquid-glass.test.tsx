// @vitest-environment jsdom
import type { JSX } from 'react'
import { useRef } from 'react'

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { RefractionParams } from '@/glass/renderer'
import type { GlassOptions } from '@/glass/use-liquid-glass'
import { GLASS_DEFAULTS, useLiquidGlass } from '@/glass/use-liquid-glass'

// The shared renderer is faked so the hook's composition (geometry + backdrop +
// renderer) is exercised without a GPU: geometry and backdrop run for real.
const mocks = vi.hoisted(() => {
  const subscribers = new Set<(event: 'lost' | 'restored') => void>()
  const bitmap = {} as ImageBitmap
  return {
    subscribers,
    bitmap,
    renderer: {
      available: true,
      render: vi.fn((_gradient: unknown, _params: RefractionParams): ImageBitmap | null => bitmap),
      subscribe: vi.fn((listener: (event: 'lost' | 'restored') => void) => {
        subscribers.add(listener)
        return (): boolean => subscribers.delete(listener)
      }),
    },
  }
})

vi.mock('@/glass/renderer', () => ({ refractionRenderer: mocks.renderer }))

let geom: { left: number; top: number; width: number; height: number }

function Probe(props: { options?: Partial<GlassOptions> }): JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  useLiquidGlass(ref, props.options)
  return (
    <div ref={ref} data-testid="surface">
      content
    </div>
  )
}

function stubBorderRadius(px: number): void {
  const real = globalThis.getComputedStyle.bind(globalThis)
  vi.spyOn(globalThis, 'getComputedStyle').mockImplementation((element, pseudo) => {
    const style = real(element, pseudo)
    Object.defineProperty(style, 'borderTopLeftRadius', {
      configurable: true,
      get: () => `${px}px`,
    })
    return style
  })
}

beforeEach(() => {
  mocks.renderer.available = true
  mocks.renderer.render.mockClear()
  mocks.renderer.subscribe.mockClear()
  mocks.subscribers.clear()
  geom = { left: 0, top: 0, width: 100, height: 60 }
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
    () =>
      ({
        left: geom.left,
        top: geom.top,
        width: geom.width,
        height: geom.height,
      }) as unknown as DOMRect,
  )
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation((type: string) => {
    if (type === 'bitmaprenderer') {
      return { transferFromImageBitmap: vi.fn() } as unknown as ImageBitmapRenderingContext
    }
    if (type === '2d') {
      return {
        fillStyle: '',
        fillRect: vi.fn(),
        createRadialGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
      } as unknown as CanvasRenderingContext2D
    }
    return null
  })
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe(): void {
        /* no-op: geometry changes are driven via window resize in tests */
      }
      disconnect(): void {
        /* no-op */
      }
    },
  )
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('useLiquidGlass — refract tier', () => {
  it('paints into a prepended bitmaprenderer canvas, flips the tier, and counts the render', () => {
    stubBorderRadius(28)
    render(<Probe />)
    const el = screen.getByTestId('surface')
    const canvas = el.querySelector<HTMLCanvasElement>('canvas.glass-layer')

    expect(canvas).not.toBeNull()
    expect(el.firstElementChild).toBe(canvas)
    expect(canvas?.getAttribute('aria-hidden')).toBe('true')
    expect(canvas?.style.position).toBe('absolute')
    expect(canvas?.style.zIndex).toBe('0')
    expect(canvas?.style.pointerEvents).toBe('none')
    expect(el.dataset.glassTier).toBe('refract')
    expect(el.dataset.glassRenders).toBe('1')
  })

  it('measures radius from computed border-radius and forwards the option defaults', () => {
    stubBorderRadius(28)
    render(<Probe />)
    const params = mocks.renderer.render.mock.calls.at(0)?.[1]

    expect(params?.radiusCss).toBe(28)
    expect(params?.bevel).toBe(34)
    expect(params?.strength).toBe(11)
    expect(params?.curvature).toBe(3)
    expect(params?.chroma).toBe(0.24)
  })
})

describe('useLiquidGlass — static render contract', () => {
  it('re-renders only on geometry change: stable fires are no-ops, a resize is not', () => {
    render(<Probe />)
    const el = screen.getByTestId('surface')
    expect(el.dataset.glassRenders).toBe('1')

    // Same geometry (as under content mutation): a fire must not re-render.
    globalThis.dispatchEvent(new Event('resize'))
    expect(el.dataset.glassRenders).toBe('1')

    // Geometry moves: the surface re-renders.
    geom.width = 240
    globalThis.dispatchEvent(new Event('resize'))
    expect(el.dataset.glassRenders).toBe('2')
  })
})

describe('useLiquidGlass — degraded paths', () => {
  it('keeps the css tier, adds no canvas, and logs nothing when the renderer is unavailable', () => {
    mocks.renderer.available = false
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    render(<Probe />)
    const el = screen.getByTestId('surface')

    expect(el.dataset.glassTier).toBe('css')
    expect(el.querySelector('canvas')).toBeNull()
    expect(error).not.toHaveBeenCalled()
    expect(warn).not.toHaveBeenCalled()
  })

  it('drops to the css tier on context loss and re-renders on restore', () => {
    render(<Probe />)
    const el = screen.getByTestId('surface')
    expect(el.dataset.glassTier).toBe('refract')

    const listener = [...mocks.subscribers].at(0)
    expect(listener).toBeTypeOf('function')

    listener?.('lost')
    expect(el.dataset.glassTier).toBe('css')

    listener?.('restored')
    expect(el.dataset.glassTier).toBe('refract')
    expect(el.dataset.glassRenders).toBe('2')
  })
})

describe('GLASS_DEFAULTS', () => {
  it('are the personal-site port values', () => {
    expect(GLASS_DEFAULTS).toEqual({
      bevel: 34,
      strength: 11,
      curvature: 3,
      chroma: 0.24,
      blur: 1.5,
      saturate: 1.5,
    })
  })
})
