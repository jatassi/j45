// @vitest-environment jsdom
import type { JSX } from 'react'
import { useRef } from 'react'

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { RefractionParams, SurfaceTexture } from '@/glass/renderer'
import { sceneRegistry, type DocRect, type SceneProxyHandle } from '@/glass/scene'
import type { GlassOptions } from '@/glass/use-liquid-glass'
import { GLASS_DEFAULTS, useLiquidGlass } from '@/glass/use-liquid-glass'

// The shared renderer is faked so the hook's composition (geometry + scene
// compositor + per-surface texture) is exercised without a GPU. The scene
// registry, scheduler, and rim modules run for real, so the render triggers,
// sub-upload discipline, and rim tint are exercised end to end.
const mocks = vi.hoisted(() => {
  const subscribers = new Set<(event: 'lost' | 'restored') => void>()
  const bitmap = {} as ImageBitmap
  const surfaceTex = {
    upload: vi.fn((_source: TexImageSource): void => undefined),
    uploadRegion: vi.fn((_source: TexImageSource, _x: number, _y: number): void => undefined),
    render: vi.fn((_params: RefractionParams): ImageBitmap | null => bitmap),
    dispose: vi.fn((): void => undefined),
  }
  return {
    subscribers,
    bitmap,
    surfaceTex,
    renderer: {
      available: true,
      // Legacy path — must never be called once the hook uses surface().
      render: vi.fn((_gradient: unknown, _params: RefractionParams): ImageBitmap | null => bitmap),
      surface: vi.fn((_id: string): SurfaceTexture => surfaceTex),
      subscribe: vi.fn((listener: (event: 'lost' | 'restored') => void) => {
        subscribers.add(listener)
        return (): boolean => subscribers.delete(listener)
      }),
    },
  }
})

vi.mock('@/glass/renderer', () => ({ refractionRenderer: mocks.renderer }))

let geom: { left: number; top: number; width: number; height: number }
let scrollY: number

/** Injectable rAF/cAF that queue callbacks for a manual `flush()`. The glass
 *  scheduler resolves `requestAnimationFrame` at call time, so stubbing the
 *  globals drives the shared singleton deterministically. */
function installFakeRaf(): { flush: () => void } {
  let nextId = 0
  const callbacks = new Map<number, (time: number) => void>()
  vi.stubGlobal('requestAnimationFrame', (cb: (time: number) => void): number => {
    nextId += 1
    callbacks.set(nextId, cb)
    return nextId
  })
  vi.stubGlobal('cancelAnimationFrame', (id: number): void => {
    callbacks.delete(id)
  })
  return {
    flush(time = 0): void {
      const pending = [...callbacks.values()]
      callbacks.clear()
      for (const cb of pending) {
        cb(time)
      }
    },
  }
}

let raf: { flush: () => void }
const handles: SceneProxyHandle[] = []

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

/** A 2D context rich enough for the scene compositor and the rim reducer. */
function fake2dContext(): CanvasRenderingContext2D {
  return {
    fillStyle: '',
    fillRect: vi.fn(),
    createRadialGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
    save: vi.fn(),
    restore: vi.fn(),
    scale: vi.fn(),
    translate: vi.fn(),
    beginPath: vi.fn(),
    rect: vi.fn(),
    clip: vi.fn(),
    drawImage: vi.fn(),
    getImageData: vi.fn(() => ({ data: new Uint8ClampedArray([12, 34, 56, 255]) })),
  } as unknown as CanvasRenderingContext2D
}

beforeEach(() => {
  mocks.renderer.available = true
  mocks.renderer.render.mockClear()
  mocks.renderer.surface.mockClear()
  mocks.renderer.subscribe.mockClear()
  mocks.surfaceTex.upload.mockClear()
  mocks.surfaceTex.uploadRegion.mockClear()
  mocks.surfaceTex.render.mockClear()
  mocks.surfaceTex.dispose.mockClear()
  mocks.subscribers.clear()
  geom = { left: 0, top: 0, width: 100, height: 60 }
  scrollY = 0
  Object.defineProperty(globalThis, 'scrollY', { configurable: true, get: () => scrollY })
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
      return fake2dContext()
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
  raf = installFakeRaf()
})

afterEach(() => {
  cleanup()
  // Proxies live in the module-singleton registry; drop them after the hook
  // has unsubscribed so their dispose-notify reaches no listeners.
  for (const handle of handles) {
    handle.dispose()
  }
  handles.length = 0
  raf.flush()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

/** Register a scene proxy and track it for teardown. */
function registerProxy(rect: DocRect): SceneProxyHandle {
  const handle = sceneRegistry.register({ rect, z: 0, paint: vi.fn() })
  handles.push(handle)
  return handle
}

describe('useLiquidGlass — geometry trigger (refract tier)', () => {
  it('composites the full slice, does a full upload + render, flips the tier, and counts the render', () => {
    stubBorderRadius(28)
    render(<Probe />)
    const el = screen.getByTestId('surface')
    const canvas = el.querySelector<HTMLCanvasElement>('canvas.glass-layer')

    expect(canvas).not.toBeNull()
    expect(el.firstElementChild).toBe(canvas)
    expect(canvas?.getAttribute('aria-hidden')).toBe('true')
    expect(canvas?.style.position).toBe('absolute')
    expect(el.dataset.glassTier).toBe('refract')
    expect(el.dataset.glassRenders).toBe('1')

    // A per-surface texture was acquired and the whole slice uploaded once.
    expect(mocks.renderer.surface).toHaveBeenCalledTimes(1)
    expect(mocks.surfaceTex.upload).toHaveBeenCalledTimes(1)
    expect(mocks.surfaceTex.upload.mock.calls[0]?.[0]).toBeInstanceOf(HTMLCanvasElement)
    expect(mocks.surfaceTex.render).toHaveBeenCalledTimes(1)
    // The legacy whole-slice render path is retired.
    expect(mocks.renderer.render).not.toHaveBeenCalled()
  })

  it('measures radius from computed border-radius and forwards the option defaults, incl reflect', () => {
    stubBorderRadius(28)
    render(<Probe />)
    const params = mocks.surfaceTex.render.mock.calls.at(0)?.[0]

    expect(params?.radiusCss).toBe(28)
    expect(params?.bevel).toBe(GLASS_DEFAULTS.bevel)
    expect(params?.strength).toBe(GLASS_DEFAULTS.strength)
    expect(params?.curvature).toBe(GLASS_DEFAULTS.curvature)
    expect(params?.chroma).toBe(GLASS_DEFAULTS.chroma)
    expect(params?.reflect).toBe(GLASS_DEFAULTS.reflect)
  })

  it('re-renders only on geometry change: a stable resize is a no-op, a moving one renders (rAF-coalesced)', () => {
    render(<Probe />)
    const el = screen.getByTestId('surface')
    expect(el.dataset.glassRenders).toBe('1')

    // Same geometry: the scheduled work runs but the key is unchanged — no render.
    globalThis.dispatchEvent(new Event('resize'))
    raf.flush()
    expect(el.dataset.glassRenders).toBe('1')

    // Geometry moves in document space: the surface re-renders.
    geom.width = 240
    globalThis.dispatchEvent(new Event('resize'))
    raf.flush()
    expect(el.dataset.glassRenders).toBe('2')
  })
})

describe('useLiquidGlass — scene dirt', () => {
  it('an intersecting dirt region sub-uploads (never a second full upload), renders, counts, and measures', () => {
    const measure = vi.spyOn(performance, 'measure')
    render(<Probe />)
    const el = screen.getByTestId('surface')
    expect(el.dataset.glassRenders).toBe('1')
    mocks.surfaceTex.upload.mockClear()

    const handle = registerProxy({ left: 20, top: 20, width: 30, height: 30 })
    handle.invalidate()
    // Coalesced through the scheduler — nothing until the frame flushes.
    expect(mocks.surfaceTex.uploadRegion).not.toHaveBeenCalled()
    raf.flush()

    expect(mocks.surfaceTex.uploadRegion).toHaveBeenCalledTimes(1)
    const [source, x, y] = mocks.surfaceTex.uploadRegion.mock.calls[0] ?? []
    expect(source).toBeInstanceOf(HTMLCanvasElement)
    expect(x).toBe(20)
    expect(y).toBe(20)
    // Discipline: the dirt path never falls back to a full texImage2D upload.
    expect(mocks.surfaceTex.upload).not.toHaveBeenCalled()
    expect(mocks.surfaceTex.render).toHaveBeenCalledTimes(2)
    expect(el.dataset.glassRenders).toBe('2')
    expect(measure.mock.calls.some((call) => call[0] === 'glass-dirty-update')).toBe(true)
  })

  it('a non-intersecting dirt region triggers nothing', () => {
    render(<Probe />)
    const el = screen.getByTestId('surface')
    mocks.surfaceTex.render.mockClear()

    const handle = registerProxy({ left: 400, top: 400, width: 10, height: 10 })
    handle.invalidate()
    raf.flush()

    expect(mocks.surfaceTex.uploadRegion).not.toHaveBeenCalled()
    expect(mocks.surfaceTex.render).not.toHaveBeenCalled()
    expect(el.dataset.glassRenders).toBe('1')
  })
})

describe('useLiquidGlass — scroll', () => {
  it('a position-fixed surface re-composites at most once per frame while scrolling, and not after it stops', () => {
    // getBoundingClientRect().top stays put under scroll → the doc-space slice moves.
    render(<Probe />)
    const el = screen.getByTestId('surface')
    expect(el.dataset.glassRenders).toBe('1')

    scrollY = 15
    globalThis.dispatchEvent(new Event('scroll'))
    scrollY = 30
    globalThis.dispatchEvent(new Event('scroll'))
    // Multiple scroll events in one frame collapse to a single render.
    expect(el.dataset.glassRenders).toBe('1')
    raf.flush()
    expect(el.dataset.glassRenders).toBe('2')

    // Scroll stopped: a later frame renders nothing more.
    raf.flush()
    expect(el.dataset.glassRenders).toBe('2')
  })

  it('a scroll-invariant surface does not render on scroll', () => {
    render(<Probe />)
    const el = screen.getByTestId('surface')
    expect(el.dataset.glassRenders).toBe('1')

    // Static content: the rect rises exactly as scroll does → the slice's
    // document-space position is invariant, so the geometry key never moves.
    scrollY = 40
    geom.top = -40
    globalThis.dispatchEvent(new Event('scroll'))
    raf.flush()
    expect(el.dataset.glassRenders).toBe('1')
  })
})

describe('useLiquidGlass — maxTier: css', () => {
  it('never acquires a surface or canvas, pins tier=css with WebGL2 available, but still tints without counting', () => {
    render(<Probe options={{ maxTier: 'css' }} />)
    const el = screen.getByTestId('surface')

    expect(mocks.renderer.available).toBe(true)
    expect(el.dataset.glassTier).toBe('css')
    expect(el.querySelector('canvas')).toBeNull()
    expect(mocks.renderer.surface).not.toHaveBeenCalled()
    expect(el.dataset.glassRenders).toBe('0')
    // Composited solely for tinting.
    expect(el.style.getPropertyValue('--rim-tint')).toBe('rgb(12, 34, 56)')

    // A geometry change and an intersecting dirt region still composite (tint),
    // but never upload and never bump the GPU-upload counter.
    geom.width = 240
    globalThis.dispatchEvent(new Event('resize'))
    raf.flush()
    const handle = registerProxy({ left: 10, top: 10, width: 20, height: 20 })
    handle.invalidate()
    raf.flush()

    expect(mocks.renderer.surface).not.toHaveBeenCalled()
    expect(mocks.surfaceTex.upload).not.toHaveBeenCalled()
    expect(mocks.surfaceTex.uploadRegion).not.toHaveBeenCalled()
    expect(el.dataset.glassRenders).toBe('0')
  })

  it('forwards a custom reflect option to the renderer as RefractionParams.reflect', () => {
    render(<Probe options={{ reflect: 0.5 }} />)
    const params = mocks.surfaceTex.render.mock.calls.at(0)?.[0]
    expect(params?.reflect).toBe(0.5)
  })
})

describe('useLiquidGlass — rim tint', () => {
  it('sets --rim-tint on the element from the composited slice on the refract tier', () => {
    render(<Probe />)
    const el = screen.getByTestId('surface')
    expect(el.dataset.glassTier).toBe('refract')
    expect(el.style.getPropertyValue('--rim-tint')).toBe('rgb(12, 34, 56)')
  })
})

describe('useLiquidGlass — degraded paths and teardown', () => {
  it('keeps the css tier, adds no canvas, and logs nothing when the renderer is unavailable', () => {
    mocks.renderer.available = false
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    render(<Probe />)
    const el = screen.getByTestId('surface')

    expect(el.dataset.glassTier).toBe('css')
    expect(el.querySelector('canvas')).toBeNull()
    expect(mocks.renderer.surface).not.toHaveBeenCalled()
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

  it('teardown removes the scene subscription and scroll listener and disposes the surface texture', () => {
    const view = render(<Probe />)
    const el = screen.getByTestId('surface')
    const handle = registerProxy({ left: 20, top: 20, width: 30, height: 30 })

    const rendersBefore = mocks.surfaceTex.render.mock.calls.length
    view.unmount()
    expect(mocks.surfaceTex.dispose).toHaveBeenCalledTimes(1)

    // Post-teardown: neither dirt nor scroll drives any further render.
    handle.invalidate()
    scrollY = 100
    globalThis.dispatchEvent(new Event('scroll'))
    raf.flush()
    expect(mocks.surfaceTex.render.mock.calls.length).toBe(rendersBefore)
    expect(el.querySelector('canvas')).toBeNull()
  })
})

describe('GLASS_DEFAULTS', () => {
  it('are the /glass-lab-tuned material values plus the maxTier default', () => {
    expect(GLASS_DEFAULTS).toEqual({
      bevel: 13,
      strength: 17,
      curvature: 2.2,
      chroma: 0.13,
      blur: 1.5,
      saturate: 1,
      reflect: 0.27,
      maxTier: 'refract',
    })
  })
})
