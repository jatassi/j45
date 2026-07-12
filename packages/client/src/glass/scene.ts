/**
 * Document-anchored scene registry: pure slice math, a proxy store, and
 * `compositeSlice` — the generalization of `rasteriseCardSlice` that paints
 * the backdrop gradient first (implicit z = -∞), then every registered
 * proxy that intersects the slice, in ascending z.
 */
import type { RasteriseOptions, SliceGeometry } from './backdrop'
import { rasteriseCardSlice } from './backdrop'

/** Document-space rectangle in CSS px. */
export type DocRect = { left: number; top: number; width: number; height: number }

export type SceneProxy = {
  rect: DocRect
  /** Paint order; backdrop gradient is implicitly z = -Infinity. */
  z: number
  /** Origin translated to rect's top-left, CSS px. */
  paint: (ctx: CanvasRenderingContext2D) => void
  /** Only used for the no-glass-proxy guard. */
  source?: Element
}

export type SceneProxyHandle = {
  update: (next: Partial<SceneProxy>) => void
  invalidate: (region?: DocRect) => void
  dispose: () => void
}

type ProxyEntry = { proxy: SceneProxy }

const entries: ProxyEntry[] = []
const listeners = new Set<(region: DocRect) => void>()

function noop(): void {
  return undefined
}

const noopHandle: SceneProxyHandle = {
  update: noop,
  invalidate: noop,
  dispose: noop,
}

function notify(region: DocRect): void {
  for (const listener of listeners) {
    listener(region)
  }
}

/** Smallest axis-aligned rect containing both inputs. */
function unionDocRects(a: DocRect, b: DocRect): DocRect {
  const left = Math.min(a.left, b.left)
  const top = Math.min(a.top, b.top)
  const right = Math.max(a.left + a.width, b.left + b.width)
  const bottom = Math.max(a.top + a.height, b.top + b.height)
  return { left, top, width: right - left, height: bottom - top }
}

/** Document-space rect of a slice's drawing buffer (CSS px). */
function sliceDocRect(slice: SliceGeometry): DocRect {
  return {
    left: slice.sliceLeft,
    top: slice.sliceTop,
    width: slice.bufferWidth / slice.dpr,
    height: slice.bufferHeight / slice.dpr,
  }
}

/**
 * Overlapping `DocRect` of two rects, or `null` if they are disjoint.
 * Edge-touching (zero-width or zero-height overlap) is treated as disjoint.
 */
export function intersectDocRects(a: DocRect, b: DocRect): DocRect | null {
  const left = Math.max(a.left, b.left)
  const top = Math.max(a.top, b.top)
  const right = Math.min(a.left + a.width, b.left + b.width)
  const bottom = Math.min(a.top + a.height, b.top + b.height)
  const width = right - left
  const height = bottom - top
  if (width <= 0 || height <= 0) {
    return null
  }
  return { left, top, width, height }
}

/**
 * Maps a document-space dirty `region` onto the device-px sub-rectangle of
 * the slice's drawing buffer that it overlaps. Clamped to buffer bounds;
 * `null` when region and slice are disjoint.
 */
export function dirtyToSubRect(
  region: DocRect,
  slice: SliceGeometry,
): { x: number; y: number; width: number; height: number } | null {
  const overlap = intersectDocRects(region, sliceDocRect(slice))
  if (!overlap) {
    return null
  }

  const dpr = slice.dpr
  let x = (overlap.left - slice.sliceLeft) * dpr
  let y = (overlap.top - slice.sliceTop) * dpr
  let width = overlap.width * dpr
  let height = overlap.height * dpr

  const right = Math.min(x + width, slice.bufferWidth)
  const bottom = Math.min(y + height, slice.bufferHeight)
  x = Math.max(0, x)
  y = Math.max(0, y)
  width = right - x
  height = bottom - y
  if (width <= 0 || height <= 0) {
    return null
  }
  return { x, y, width, height }
}

/** Stable ascending-z paint order (equal z keeps input relative order). */
export function paintOrder(proxies: readonly SceneProxy[]): SceneProxy[] {
  return proxies
    .map((proxy, index) => ({ proxy, index }))
    .toSorted((a, b) => a.proxy.z - b.proxy.z || a.index - b.index)
    .map(({ proxy }) => proxy)
}

function isGlassSurfaceSource(source: Element | undefined): boolean {
  return Boolean(source?.closest('.glass-surface'))
}

function createHandle(entry: ProxyEntry): SceneProxyHandle {
  let disposed = false
  return {
    update(next) {
      if (disposed) {
        return
      }
      const before = entry.proxy.rect
      entry.proxy = { ...entry.proxy, ...next }
      notify(unionDocRects(before, entry.proxy.rect))
    },
    invalidate(region) {
      if (disposed) {
        return
      }
      notify(region ?? entry.proxy.rect)
    },
    dispose() {
      if (disposed) {
        return
      }
      disposed = true
      const rect = entry.proxy.rect
      const idx = entries.indexOf(entry)
      if (idx !== -1) {
        entries.splice(idx, 1)
      }
      notify(rect)
    },
  }
}

function paintProxy(
  ctx: CanvasRenderingContext2D,
  proxy: SceneProxy,
  geometry: { slice: SliceGeometry; sliceRect: DocRect },
): void {
  const { slice, sliceRect } = geometry
  const intersection = intersectDocRects(proxy.rect, sliceRect)
  if (!intersection) {
    return
  }
  ctx.save()
  // CSS-px drawing space (matches rasteriseCardSlice's buffer convention).
  ctx.scale(slice.dpr, slice.dpr)
  // Proxy top-left becomes the paint origin, relative to the slice.
  ctx.translate(proxy.rect.left - slice.sliceLeft, proxy.rect.top - slice.sliceTop)
  // Clip to proxy ∩ slice, in the proxy's local CSS-px space.
  ctx.beginPath()
  ctx.rect(
    intersection.left - proxy.rect.left,
    intersection.top - proxy.rect.top,
    intersection.width,
    intersection.height,
  )
  ctx.clip()
  proxy.paint(ctx)
  ctx.restore()
}

export const sceneRegistry: {
  register: (proxy: SceneProxy) => SceneProxyHandle
  compositeSlice: (options: RasteriseOptions) => HTMLCanvasElement
  subscribe: (onDirty: (region: DocRect) => void) => () => void
} = {
  register(proxy) {
    if (isGlassSurfaceSource(proxy.source)) {
      // Vite's DEV flag; remains a runtime property under vitest for stubbing.
      if (import.meta.env.DEV) {
        console.warn(
          '[glass/scene] refused to register a proxy whose source is inside .glass-surface (no glass-refracting-glass)',
        )
      }
      return noopHandle
    }

    const entry: ProxyEntry = {
      proxy: {
        rect: proxy.rect,
        z: proxy.z,
        paint: proxy.paint,
        source: proxy.source,
      },
    }
    entries.push(entry)
    return createHandle(entry)
  },

  compositeSlice(options) {
    // Gradient first — identical to rasteriseCardSlice when no proxies hit.
    const canvas = rasteriseCardSlice(options)
    const ctx = canvas.getContext('2d')
    if (!ctx) {
      return canvas
    }

    const { slice } = options
    const sliceRect = sliceDocRect(slice)
    const intersecting = entries
      .map((e) => e.proxy)
      .filter((p) => intersectDocRects(p.rect, sliceRect) !== null)

    for (const proxy of paintOrder(intersecting)) {
      paintProxy(ctx, proxy, { slice, sliceRect })
    }
    return canvas
  },

  subscribe(onDirty) {
    listeners.add(onDirty)
    return () => {
      listeners.delete(onDirty)
    }
  },
}
