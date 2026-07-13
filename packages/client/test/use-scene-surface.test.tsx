// @vitest-environment jsdom
import type { JSX } from 'react'
import { useRef } from 'react'

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { DocRect, SceneProxy, SceneProxyHandle } from '@/glass/scene'
import { sceneRegistry } from '@/glass/scene'
import { useSceneSurface } from '@/glass/use-scene-surface'

type SurfaceOptions = {
  color: string
  radius?: number
  z?: number
  hairline?: string
}

let geom: { left: number; top: number; width: number; height: number }
let resizeCallbacks: ResizeObserverCallback[]

function Probe(props: { options: SurfaceOptions; className?: string }): JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  useSceneSurface(ref, props.options)
  return (
    <div ref={ref} data-testid="surface" className={props.className}>
      card
    </div>
  )
}

function stubScroll(x: number, y: number): void {
  Object.defineProperty(globalThis, 'scrollX', { value: x, writable: true, configurable: true })
  Object.defineProperty(globalThis, 'scrollY', { value: y, writable: true, configurable: true })
}

function stubPaintCtx(): CanvasRenderingContext2D & {
  beginPath: ReturnType<typeof vi.fn>
  roundRect: ReturnType<typeof vi.fn>
  fill: ReturnType<typeof vi.fn>
  stroke: ReturnType<typeof vi.fn>
} {
  return {
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 0,
    beginPath: vi.fn(),
    roundRect: vi.fn(),
    fill: vi.fn(),
    stroke: vi.fn(),
  } as unknown as CanvasRenderingContext2D & {
    beginPath: ReturnType<typeof vi.fn>
    roundRect: ReturnType<typeof vi.fn>
    fill: ReturnType<typeof vi.fn>
    stroke: ReturnType<typeof vi.fn>
  }
}

function firstProxy(register: {
  mock: { calls: readonly (readonly [SceneProxy, ...unknown[]])[] }
}): SceneProxy {
  const call = register.mock.calls[0]
  expect(call).toBeDefined()
  return call[0]
}

beforeEach(() => {
  geom = { left: 10, top: 20, width: 100, height: 60 }
  resizeCallbacks = []
  stubScroll(0, 0)
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
    () =>
      ({
        left: geom.left,
        top: geom.top,
        width: geom.width,
        height: geom.height,
      }) as unknown as DOMRect,
  )
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(cb: ResizeObserverCallback) {
        resizeCallbacks.push(cb)
      }
      observe(): void {
        /* capture only */
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

describe('useSceneSurface — registration + paint contract', () => {
  it('registers document-space rect, paints fill + hairline, disposes on unmount', () => {
    stubScroll(40, 80)
    const handle: SceneProxyHandle = {
      update: vi.fn(),
      invalidate: vi.fn(),
      dispose: vi.fn(),
    }
    const register = vi.spyOn(sceneRegistry, 'register').mockReturnValue(handle)

    const options: SurfaceOptions = {
      color: '#112233',
      radius: 12,
      z: 3,
      hairline: 'rgba(255,255,255,0.4)',
    }
    const { unmount } = render(<Probe options={options} />)
    const el = screen.getByTestId('surface')

    expect(register).toHaveBeenCalledTimes(1)
    const proxy = firstProxy(register)
    expect(proxy.rect).toEqual({
      left: 10 + 40,
      top: 20 + 80,
      width: 100,
      height: 60,
    } satisfies DocRect)
    expect(proxy.z).toBe(3)
    expect(proxy.source).toBe(el)

    const ctx = stubPaintCtx()
    proxy.paint(ctx)
    expect(ctx.beginPath).toHaveBeenCalled()
    expect(ctx.roundRect).toHaveBeenCalledWith(0, 0, 100, 60, 12)
    expect(ctx.fillStyle).toBe('#112233')
    expect(ctx.fill).toHaveBeenCalled()
    expect(ctx.strokeStyle).toBe('rgba(255,255,255,0.4)')
    expect(ctx.lineWidth).toBe(1)
    expect(ctx.stroke).toHaveBeenCalled()

    unmount()
    expect(handle.dispose).toHaveBeenCalledTimes(1)
  })

  it('defaults z to 0 and skips hairline stroke when unset', () => {
    const handle: SceneProxyHandle = {
      update: vi.fn(),
      invalidate: vi.fn(),
      dispose: vi.fn(),
    }
    const register = vi.spyOn(sceneRegistry, 'register').mockReturnValue(handle)

    render(<Probe options={{ color: '#abc' }} />)

    const proxy = firstProxy(register)
    expect(proxy.z).toBe(0)

    const ctx = stubPaintCtx()
    proxy.paint(ctx)
    expect(ctx.roundRect).toHaveBeenCalledWith(0, 0, 100, 60, 0)
    expect(ctx.fillStyle).toBe('#abc')
    expect(ctx.fill).toHaveBeenCalled()
    expect(ctx.stroke).not.toHaveBeenCalled()
  })
})

describe('useSceneSurface — document-space + resize-driven update', () => {
  it('incorporates scroll, updates rect on ResizeObserver / resize / orientationchange, no scroll listener', () => {
    stubScroll(50, 75)
    const update = vi.fn()
    const handle: SceneProxyHandle = {
      update,
      invalidate: vi.fn(),
      dispose: vi.fn(),
    }
    const register = vi.spyOn(sceneRegistry, 'register').mockReturnValue(handle)
    const addEventListener = vi.spyOn(globalThis, 'addEventListener')

    render(<Probe options={{ color: '#000', z: 1 }} />)

    const proxy = firstProxy(register)
    expect(proxy.rect).toEqual({
      left: 10 + 50,
      top: 20 + 75,
      width: 100,
      height: 60,
    })

    expect(addEventListener.mock.calls.filter((c) => c[0] === 'scroll')).toEqual([])
    expect(addEventListener).toHaveBeenCalledWith('resize', expect.any(Function))

    geom = { left: 15, top: 25, width: 200, height: 80 }
    expect(resizeCallbacks.length).toBeGreaterThan(0)
    for (const cb of resizeCallbacks) {
      cb([], {} as ResizeObserver)
    }
    expect(update).toHaveBeenCalledWith({
      rect: { left: 15 + 50, top: 25 + 75, width: 200, height: 80 },
    })

    update.mockClear()
    geom = { left: 30, top: 40, width: 120, height: 50 }
    globalThis.dispatchEvent(new Event('resize'))
    expect(update).toHaveBeenCalledWith({
      rect: { left: 30 + 50, top: 40 + 75, width: 120, height: 50 },
    })

    update.mockClear()
    geom = { left: 5, top: 8, width: 90, height: 40 }
    globalThis.dispatchEvent(new Event('orientationchange'))
    expect(update).toHaveBeenCalledWith({
      rect: { left: 5 + 50, top: 8 + 75, width: 90, height: 40 },
    })
  })
})

describe('useSceneSurface — glass-surface source guard', () => {
  it('never registers an element that is itself a glass surface (silent skip, no warn)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const register = vi.spyOn(sceneRegistry, 'register')

    render(<Probe options={{ color: '#f00', z: 2 }} className="glass-surface" />)

    expect(register).not.toHaveBeenCalled()
    expect(warn).not.toHaveBeenCalled()
    warn.mockRestore()
  })
})
