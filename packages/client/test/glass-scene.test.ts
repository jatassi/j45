// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { SliceGeometry } from '@/glass/backdrop'
import type { DocRect, SceneProxy, SceneProxyHandle } from '@/glass/scene'
import { dirtyToSubRect, intersectDocRects, paintOrder, sceneRegistry } from '@/glass/scene'

afterEach(() => {
  document.body.innerHTML = ''
  vi.restoreAllMocks()
})

const d = (left: number, top: number, wh: readonly [number, number]): DocRect => ({
  left,
  top,
  width: wh[0],
  height: wh[1],
})
const slice = (o: Partial<SliceGeometry> = {}): SliceGeometry => ({
  sliceLeft: 0,
  sliceTop: 0,
  bufferWidth: 300,
  bufferHeight: 200,
  dpr: 1,
  ...o,
})
const px = (o: Partial<SceneProxy> & Pick<SceneProxy, 'rect' | 'z'>): SceneProxy => ({
  paint: () => undefined,
  ...o,
})

type Call = { op: string; args: unknown[] }
function stubCtx(calls: Call[]): CanvasRenderingContext2D {
  const rec =
    (op: string) =>
    (...args: unknown[]) => {
      calls.push({ op, args })
    }
  return {
    fillStyle: '',
    scale: rec('scale'),
    translate: rec('translate'),
    save: rec('save'),
    restore: rec('restore'),
    beginPath: rec('beginPath'),
    rect: rec('rect'),
    clip: rec('clip'),
    fillRect: rec('fillRect'),
    createRadialGradient: (...args: unknown[]) => {
      calls.push({ op: 'createRadialGradient', args })
      return {
        addColorStop: (...a: unknown[]) => {
          calls.push({ op: 'addColorStop', args: a })
        },
      }
    },
  } as unknown as CanvasRenderingContext2D
}
const mock2d = (ctx: CanvasRenderingContext2D) =>
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx)
const disposeAll = (hs: SceneProxyHandle[]) => {
  for (const h of hs) {
    h.dispose()
  }
}

describe('intersectDocRects', () => {
  it.each([
    { n: 'disjoint both', a: d(0, 0, [10, 10]), b: d(20, 20, [10, 10]) },
    { n: 'disjoint x', a: d(0, 0, [10, 10]), b: d(20, 5, [10, 10]) },
    { n: 'disjoint y', a: d(0, 0, [10, 10]), b: d(5, 20, [10, 10]) },
    { n: 'edge vertical', a: d(0, 0, [10, 10]), b: d(10, 0, [10, 10]) },
    { n: 'edge horizontal', a: d(0, 0, [10, 10]), b: d(0, 10, [10, 10]) },
  ])('$n → null', ({ a, b }) => {
    expect(intersectDocRects(a, b)).toBeNull()
  })
  it.each([
    { n: 'corner', a: d(0, 0, [20, 20]), b: d(10, 10, [20, 20]), e: d(10, 10, [10, 10]) },
    { n: 'strip', a: d(100, 50, [40, 30]), b: d(120, 40, [50, 30]), e: d(120, 50, [20, 20]) },
    { n: 'contained', a: d(0, 0, [100, 100]), b: d(10, 20, [30, 40]), e: d(10, 20, [30, 40]) },
  ])('$n overlap', ({ a, b, e }) => {
    expect(intersectDocRects(a, b)).toEqual(e)
  })
})

describe('dirtyToSubRect', () => {
  it.each([
    {
      n: 'fully inside dpr=1',
      region: d(120, 70, [40, 20]),
      s: slice({ sliceLeft: 100, sliceTop: 50, bufferWidth: 200, bufferHeight: 100, dpr: 1 }),
      e: { x: 20, y: 20, width: 40, height: 20 },
    },
    {
      n: 'partial clamped',
      region: d(80, 40, [60, 100]),
      s: slice({ sliceLeft: 100, sliceTop: 50, bufferWidth: 100, bufferHeight: 80, dpr: 1 }),
      e: { x: 0, y: 0, width: 40, height: 80 },
    },
    {
      n: 'dpr=2 scaling',
      region: d(120, 70, [40, 20]),
      s: slice({ sliceLeft: 100, sliceTop: 50, bufferWidth: 400, bufferHeight: 200, dpr: 2 }),
      e: { x: 40, y: 40, width: 80, height: 40 },
    },
  ])('$n', ({ region, s, e }) => {
    expect(dirtyToSubRect(region, s)).toEqual(e)
  })
  it('returns null when disjoint', () => {
    const s = slice({ sliceLeft: 100, sliceTop: 50, bufferWidth: 100, bufferHeight: 80, dpr: 1 })
    expect(dirtyToSubRect(d(300, 300, [10, 10]), s)).toBeNull()
  })
})

describe('paintOrder', () => {
  it('ascending z, stable for equal z, non-mutating', () => {
    const ids: string[] = []
    const t = (id: string, z: number) =>
      px({
        rect: d(0, 0, [1, 1]),
        z,
        paint: () => {
          ids.push(id)
        },
      })
    const input = [t('hi', 5), t('a', 1), t('b', 1), t('c', 1), t('d', 0)]
    const copy = [...input]
    const sorted = paintOrder(input)
    expect(input).toEqual(copy)
    expect(sorted).not.toBe(input)
    expect(sorted.map((p) => p.z)).toEqual([0, 1, 1, 1, 5])
    for (const p of sorted) {
      p.paint({} as CanvasRenderingContext2D)
    }
    expect(ids).toEqual(['d', 'a', 'b', 'c', 'hi'])
  })
})

describe('compositeSlice', () => {
  it('gradient first, z-order, scale/translate/clip; skip non-hit; no-ctx degrades', () => {
    const calls: Call[] = []
    const log: string[] = []
    const ctx = stubCtx(calls)
    const spy = mock2d(ctx)
    const s = slice({ sliceLeft: 100, sliceTop: 50, bufferWidth: 200, bufferHeight: 100, dpr: 2 })
    const high = px({
      rect: d(120, 60, [40, 20]),
      z: 10,
      paint: (c) => {
        log.push('high')
        calls.push({ op: 'proxyPaint', args: ['high', c] })
      },
    })
    const low = px({
      rect: d(110, 55, [30, 25]),
      z: 1,
      paint: (c) => {
        log.push('low')
        calls.push({ op: 'proxyPaint', args: ['low', c] })
      },
    })
    const miss = px({
      rect: d(500, 500, [10, 10]),
      z: 0,
      paint: () => {
        log.push('miss')
      },
    })
    const hs = [
      sceneRegistry.register(high),
      sceneRegistry.register(low),
      sceneRegistry.register(miss),
    ]
    const canvas = sceneRegistry.compositeSlice({
      slice: s,
      viewport: { width: 1000, height: 800 },
      documentWidth: 1000,
      document,
    })
    expect(canvas.width).toBe(200)
    expect(canvas.height).toBe(100)
    const first = calls.findIndex((c) => c.op === 'proxyPaint')
    expect(first).toBeGreaterThan(0)
    expect(calls.slice(0, first).map((c) => c.op)).toEqual(
      expect.arrayContaining(['fillRect', 'createRadialGradient', 'addColorStop']),
    )
    expect(log).toEqual(['low', 'high'])
    const ops = ['save', 'scale', 'translate', 'beginPath', 'rect', 'clip', 'restore']
    for (const [name, pr] of [
      ['low', low.rect],
      ['high', high.rect],
    ] as const) {
      const i = calls.findIndex((c) => c.op === 'proxyPaint' && c.args[0] === name)
      const w = calls.slice(Math.max(0, i - 8), i + 2)
      expect(w.map((c) => c.op)).toEqual(expect.arrayContaining(ops))
      expect(w.find((c) => c.op === 'scale')?.args).toEqual([2, 2])
      expect(w.find((c) => c.op === 'translate')?.args).toEqual([
        pr.left - s.sliceLeft,
        pr.top - s.sliceTop,
      ])
      const hit = intersectDocRects(pr, {
        left: s.sliceLeft,
        top: s.sliceTop,
        width: s.bufferWidth / s.dpr,
        height: s.bufferHeight / s.dpr,
      })
      expect(hit).not.toBeNull()
      if (hit !== null) {
        expect(w.find((c) => c.op === 'rect')?.args).toEqual([
          hit.left - pr.left,
          hit.top - pr.top,
          hit.width,
          hit.height,
        ])
      }
    }
    disposeAll(hs)
    spy.mockRestore()
    const nullSpy = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
    const bare = sceneRegistry.compositeSlice({
      slice: slice({ bufferWidth: 240, bufferHeight: 160 }),
      viewport: { width: 1000, height: 800 },
      documentWidth: 1000,
      document,
    })
    expect(bare.width).toBe(240)
    expect(bare.height).toBe(160)
    nullSpy.mockRestore()
  })
})

describe('register / update / invalidate / dispose / subscribe', () => {
  it('dirty notifications, rect-union, dispose unregisters, unsubscribe isolates', () => {
    const regions: DocRect[] = []
    const unsub = sceneRegistry.subscribe((r) => {
      regions.push(r)
    })
    const paint = vi.fn()
    const h = sceneRegistry.register(px({ rect: d(0, 0, [50, 50]), z: 0, paint }))
    h.invalidate()
    expect(regions[0]).toEqual(d(0, 0, [50, 50]))
    h.invalidate(d(1, 2, [3, 4]))
    expect(regions[1]).toEqual(d(1, 2, [3, 4]))
    h.update({ rect: d(40, 40, [30, 30]) })
    expect(regions[2]).toEqual(d(0, 0, [70, 70]))
    h.update({ z: 3 })
    expect(regions[3]).toEqual(d(40, 40, [30, 30]))
    const spy = mock2d(stubCtx([]))
    const opts = {
      slice: slice({ bufferWidth: 100, bufferHeight: 100, dpr: 1 }),
      viewport: { width: 100, height: 100 },
      documentWidth: 100,
      document,
    }
    sceneRegistry.compositeSlice(opts)
    expect(paint).toHaveBeenCalledTimes(1)
    const n = regions.length
    h.dispose()
    expect(regions).toHaveLength(n + 1)
    expect(regions.at(-1)).toEqual(d(40, 40, [30, 30]))
    paint.mockClear()
    sceneRegistry.compositeSlice(opts)
    expect(paint).not.toHaveBeenCalled()
    h.dispose()
    h.update({ z: 9 })
    h.invalidate()
    expect(regions).toHaveLength(n + 1)
    unsub()
    spy.mockRestore()
    const a: DocRect[] = []
    const b: DocRect[] = []
    const ua = sceneRegistry.subscribe((r) => {
      a.push(r)
    })
    const ub = sceneRegistry.subscribe((r) => {
      b.push(r)
    })
    const h2 = sceneRegistry.register(px({ rect: d(1, 1, [1, 1]), z: 0 }))
    h2.invalidate()
    ua()
    h2.invalidate(d(2, 2, [2, 2]))
    expect(a).toHaveLength(1)
    expect(b).toHaveLength(2)
    expect(b[1]).toEqual(d(2, 2, [2, 2]))
    h2.dispose()
    ub()
  })
})

describe('no-glass-proxy guard', () => {
  function glassEl(kind: 'self' | 'child'): Element {
    const outer = document.createElement('div')
    outer.className = 'glass-surface'
    if (kind === 'self') {
      document.body.append(outer)
      return outer
    }
    const inner = document.createElement('span')
    outer.append(inner)
    document.body.append(outer)
    return inner
  }

  it.each([{ kind: 'self' as const }, { kind: 'child' as const }])(
    'refuses $kind glass-surface: a no-op handle that moves nothing and never paints',
    ({ kind }) => {
      const paint = vi.fn()
      const h = sceneRegistry.register(
        px({ rect: d(0, 0, [10, 10]), z: 0, paint, source: glassEl(kind) }),
      )
      const regions: DocRect[] = []
      const unsub = sceneRegistry.subscribe((r) => {
        regions.push(r)
      })
      h.invalidate()
      h.update({ z: 1 })
      h.dispose()
      expect(regions).toEqual([])
      unsub()
      const spy = mock2d(stubCtx([]))
      sceneRegistry.compositeSlice({
        slice: slice({ bufferWidth: 50, bufferHeight: 50 }),
        viewport: { width: 50, height: 50 },
        documentWidth: 50,
        document,
      })
      expect(paint).not.toHaveBeenCalled()
      spy.mockRestore()
    },
  )

  // The refusal says nothing, so every register of the same surface must be
  // refused on its own: a guard that let the second one through would leave
  // no trace anywhere else.
  it('refuses each register of the same glass surface, and none of them paint', () => {
    const el = glassEl('self')
    const first = vi.fn()
    const second = vi.fn()
    const h = sceneRegistry.register(
      px({ rect: d(0, 0, [10, 10]), z: 0, paint: first, source: el }),
    )
    h.dispose()
    sceneRegistry.register(px({ rect: d(0, 0, [1, 1]), z: 0, paint: second, source: el }))
    const spy = mock2d(stubCtx([]))
    sceneRegistry.compositeSlice({
      slice: slice({ bufferWidth: 50, bufferHeight: 50 }),
      viewport: { width: 50, height: 50 },
      documentWidth: 50,
      document,
    })
    expect(first).not.toHaveBeenCalled()
    expect(second).not.toHaveBeenCalled()
    spy.mockRestore()
  })
})
