import type { RefObject } from 'react'
import { useEffect } from 'react'

import type { RasteriseOptions, SliceGeometry } from './backdrop'
import type { GeometryInput, RenderParams } from './geometry'
import { computeRenderParams, geometryKey } from './geometry'
import type { RefractionParams, SurfaceTexture } from './renderer'
import { refractionRenderer } from './renderer'
import { rimTintFromSlice } from './rim'
import type { DocRect } from './scene'
import { dirtyToSubRect, sceneRegistry } from './scene'
import { glassScheduler } from './scheduler'

/**
 * Per-surface refraction knobs, forwarded to the shader (`bevel`/`strength`/
 * `curvature`/`chroma`/`reflect`) or applied as the layer canvas's CSS filter
 * (`blur`/`saturate`). The corner radius is measured from computed
 * `border-radius`, never passed. `maxTier` caps a surface at the CSS tier even
 * when WebGL2 is available (the phone-gate escape hatch). Defaults were tuned
 * on `/glass-lab` (2026-07); the personal-site port's originals were
 * bevel 34 / strength 11 / curvature 3 / chroma 0.24 / saturate 1.5.
 */
export type GlassOptions = {
  bevel: number
  strength: number
  curvature: number
  chroma: number
  blur: number
  saturate: number
  /** Rim-reflection weight, forwarded to the shader as `RefractionParams.reflect`. */
  reflect: number
  /** Ceiling tier: `'css'` never acquires a GPU surface texture or canvas. */
  maxTier: 'css' | 'refract'
}

export const GLASS_DEFAULTS: GlassOptions = {
  bevel: 13,
  strength: 17,
  curvature: 2.2,
  chroma: 0.13,
  blur: 1.5,
  saturate: 1,
  reflect: 0.27,
  maxTier: 'refract',
}

const LAYER_CLASS = 'glass-layer'

/** Monotonic id source so every mounted surface owns a distinct GPU texture. */
let surfaceSeq = 0
function nextSurfaceId(): string {
  surfaceSeq += 1
  return `glass-surface-${surfaceSeq}`
}

type Layer = { canvas: HTMLCanvasElement; ctx: ImageBitmapRenderingContext }

/** The per-surface state machine the three render triggers share. */
type SurfaceState = {
  id: string
  lastKey: string | null
  /** Geometry of the last composited slice — dirt/scroll re-evaluation reads it. */
  lastSlice: RenderParams | null
  renders: number
  layer: Layer | null
  /** Lazily acquired on the first refract-tier paint; disposed at teardown. */
  surface: SurfaceTexture | null
}

/** The bundle every render trigger operates on — one per mounted surface. */
type SurfaceContext = { el: HTMLElement; options: GlassOptions; state: SurfaceState }

/** Corner radius in CSS px, read from computed `border-radius` (0 if unset). */
function measureRadius(el: HTMLElement): number {
  const value = Number.parseFloat(getComputedStyle(el).borderTopLeftRadius)
  return Number.isFinite(value) ? value : 0
}

/** Snapshot the surface's document-space geometry — the render trigger's input.
 *  The measured radius is clamped to half the shorter side, mirroring how CSS
 *  resolves overlapping corners — so `rounded-full` pills (border-radius:
 *  9999px) feed the SDF the radius the browser actually paints. */
function readGeometryInput(el: HTMLElement): GeometryInput {
  const rect = el.getBoundingClientRect()
  const radiusCap = Math.min(rect.width, rect.height) / 2
  return {
    rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
    scroll: { x: window.scrollX, y: window.scrollY },
    dpr: window.devicePixelRatio || 1,
    radius: Math.min(measureRadius(el), radiusCap),
  }
}

/** Composite options for a slice, reading the current viewport/document size. */
function compositeOptions(slice: SliceGeometry): RasteriseOptions {
  return {
    slice,
    viewport: { width: window.innerWidth, height: window.innerHeight },
    documentWidth: document.documentElement.scrollWidth,
  }
}

/** Shader params for the surface's full slice, folding in the material options. */
function toRefractionParams(slice: RenderParams, options: GlassOptions): RefractionParams {
  return {
    widthPx: slice.bufferWidth,
    heightPx: slice.bufferHeight,
    dpr: slice.dpr,
    radiusCss: slice.radiusCss,
    bevel: options.bevel,
    strength: options.strength,
    curvature: options.curvature,
    chroma: options.chroma,
    reflect: options.reflect,
  }
}

/** Feed the composited slice's border-band average into the CSS rim gradient. */
function setRimTint(el: HTMLElement, canvas: HTMLCanvasElement): void {
  const tint = rimTintFromSlice(canvas)
  if (tint) {
    el.style.setProperty('--rim-tint', tint)
  }
}

/**
 * Wrap a dirt-driven composite+upload in `performance.measure('glass-dirty-update')`
 * so the demo's perf harness can observe each sub-update's wall time. Degrades to
 * a bare call when the User Timing API is missing.
 */
function measureDirtyUpdate(work: () => void): void {
  const perf = globalThis.performance
  if (typeof perf.mark !== 'function' || typeof perf.measure !== 'function') {
    work()
    return
  }
  const startMark = 'glass-dirty-update-start'
  perf.mark(startMark)
  try {
    work()
  } finally {
    perf.measure('glass-dirty-update', startMark)
  }
}

/**
 * The `bitmaprenderer` display canvas, created and prepended on first use. When
 * `bitmaprenderer` is unavailable no canvas is ever inserted, so the surface
 * stays on the CSS tier with no refraction canvas.
 */
function ensureLayer(el: HTMLElement, state: SurfaceState): Layer | null {
  if (state.layer) {
    return state.layer
  }
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('bitmaprenderer')
  if (!ctx) {
    return null
  }
  canvas.className = LAYER_CLASS
  canvas.setAttribute('aria-hidden', 'true')
  Object.assign(canvas.style, {
    position: 'absolute',
    inset: '0',
    // A canvas is a replaced element: `inset: 0` alone leaves width/height
    // `auto`, which resolves to the *intrinsic* size — the drawing buffer, in
    // device px. On a dpr > 1 display that lays the layer out dpr× too large,
    // so the refraction reads as a magnified backdrop cropped to the card's
    // top-left corner (and the rim bevel falls outside it). Pin the box to the
    // surface so one buffer px maps to one device px.
    width: '100%',
    height: '100%',
    zIndex: '0',
    pointerEvents: 'none',
  })
  el.prepend(canvas)
  state.layer = { canvas, ctx }
  return state.layer
}

/** The pinned GPU surface texture for this element, acquired once. */
function ensureSurface(state: SurfaceState): SurfaceTexture {
  state.surface ??= refractionRenderer.surface(state.id)
  return state.surface
}

function paint(layer: Layer, bitmap: ImageBitmap, slice: RenderParams): void {
  layer.canvas.width = slice.bufferWidth
  layer.canvas.height = slice.bufferHeight
  layer.ctx.transferFromImageBitmap(bitmap)
}

/**
 * Geometry trigger: re-render iff the geometry key moved. Composites the full
 * slice (also refreshing `--rim-tint`); on the refract tier it then does a full
 * `texImage2D` upload + render and bumps `data-glass-renders`. On the CSS tier —
 * `maxTier: 'css'`, no WebGL2, or no `bitmaprenderer` — it composites solely for
 * the rim tint and never touches the GPU or the render counter.
 */
function renderGeometry(ctx: SurfaceContext): void {
  const { el, options, state } = ctx
  const input = readGeometryInput(el)
  const key = geometryKey(input)
  if (key === state.lastKey) {
    return
  }
  const params = computeRenderParams(input)
  const canvas = sceneRegistry.compositeSlice(compositeOptions(params))
  setRimTint(el, canvas)

  if (options.maxTier === 'css' || !refractionRenderer.available) {
    // CSS-only path (maxTier or missing WebGL2): composite solely for
    // `--rim-tint`. Commit lastKey/lastSlice so geometry de-dupes and dirt
    // updates can still refresh the tint without a GPU surface.
    state.lastKey = key
    state.lastSlice = params
    return
  }

  const surface = ensureSurface(state)
  surface.upload(canvas)
  const bitmap = surface.render(toRefractionParams(params, options))
  if (!bitmap) {
    return
  }
  const layer = ensureLayer(el, state)
  if (!layer) {
    return
  }
  paint(layer, bitmap, params)
  el.dataset.glassTier = 'refract'
  state.renders += 1
  el.dataset.glassRenders = String(state.renders)
  state.lastKey = key
  state.lastSlice = params
}

/**
 * Scene-dirt trigger: re-composite only the region of the surface's slice the
 * dirty rect touches and patch it in with `texSubImage2D` — never a full
 * `texImage2D` re-upload — then render and bump the counter. On the CSS tier the
 * sub-composite refreshes `--rim-tint` only. Callers guarantee `region`
 * intersects the surface (`onDirty` filters non-intersecting regions out).
 */
function updateDirty(ctx: SurfaceContext, region: DocRect): void {
  const { el, options, state } = ctx
  const slice = state.lastSlice
  if (!slice) {
    return
  }
  const subRect = dirtyToSubRect(region, slice)
  if (!subRect) {
    return
  }
  measureDirtyUpdate(() => {
    const dpr = slice.dpr
    const subSlice: SliceGeometry = {
      sliceLeft: slice.sliceLeft + subRect.x / dpr,
      sliceTop: slice.sliceTop + subRect.y / dpr,
      bufferWidth: subRect.width,
      bufferHeight: subRect.height,
      dpr,
    }
    const canvas = sceneRegistry.compositeSlice(compositeOptions(subSlice))
    setRimTint(el, canvas)

    if (options.maxTier === 'css' || !refractionRenderer.available || !state.surface) {
      return
    }
    state.surface.uploadRegion(canvas, subRect.x, subRect.y)
    const bitmap = state.surface.render(toRefractionParams(slice, options))
    if (!bitmap || !state.layer) {
      return
    }
    paint(state.layer, bitmap, slice)
    state.renders += 1
    el.dataset.glassRenders = String(state.renders)
  })
}

/** The static-contract watch set: element + body resize and window resize/
 *  orientation. Deliberately no scroll listener here — scroll is a separate,
 *  rAF-coalesced trigger wired in `mountGlass`. */
function observe(el: HTMLElement, onChange: () => void): () => void {
  const observers: ResizeObserver[] = []
  if (typeof ResizeObserver !== 'undefined') {
    const element = new ResizeObserver(onChange)
    const body = new ResizeObserver(onChange)
    element.observe(el)
    body.observe(document.body)
    observers.push(element, body)
  }
  window.addEventListener('resize', onChange)
  globalThis.addEventListener('orientationchange', onChange)
  return () => {
    for (const observer of observers) {
      observer.disconnect()
    }
    window.removeEventListener('resize', onChange)
    globalThis.removeEventListener('orientationchange', onChange)
  }
}

function applyFilterVars(el: HTMLElement, options: GlassOptions): void {
  el.style.setProperty('--glass-blur', `${options.blur}px`)
  el.style.setProperty('--glass-saturate', `${options.saturate}`)
}

/**
 * Wire one surface's state machine: seed its tier/render attributes, paint once,
 * then funnel all three render triggers — geometry (resize/observer), scene dirt
 * (`sceneRegistry.subscribe`), and scroll (a passive listener) — through
 * `glassScheduler` under one per-surface key, so each surface composites+uploads
 * at most once per frame. Returns the teardown that removes every subscription,
 * the scheduler key, the scroll listener, and disposes the GPU texture.
 */
function mountGlass(el: HTMLElement, options: GlassOptions): () => void {
  const state: SurfaceState = {
    id: nextSurfaceId(),
    lastKey: null,
    lastSlice: null,
    renders: 0,
    layer: null,
    surface: null,
  }
  el.dataset.glassTier = 'css'
  el.dataset.glassRenders = '0'
  applyFilterVars(el, options)
  const ctx: SurfaceContext = { el, options, state }

  const scheduleGeometry = (): void => {
    glassScheduler.schedule(state, () => {
      renderGeometry(ctx)
    })
  }

  // Initial paint — today's path, synchronous so the surface lands immediately.
  renderGeometry(ctx)

  const stopObserving = observe(el, scheduleGeometry)

  // Scroll follows fixed chrome whose document-space slice moves; static
  // surfaces re-evaluate to a scroll-invariant key and no-op.
  const onScroll = (): void => {
    scheduleGeometry()
  }
  window.addEventListener('scroll', onScroll, { passive: true })

  const unsubscribeScene = sceneRegistry.subscribe((region) => {
    // Filter here so a non-intersecting region schedules nothing at all.
    if (!state.lastSlice || !dirtyToSubRect(region, state.lastSlice)) {
      return
    }
    glassScheduler.schedule(state, () => {
      updateDirty(ctx, region)
    })
  })

  const unsubscribeRenderer = refractionRenderer.subscribe((event) => {
    if (event === 'lost') {
      el.dataset.glassTier = 'css'
      state.lastKey = null
    } else {
      renderGeometry(ctx)
    }
  })

  return () => {
    stopObserving()
    window.removeEventListener('scroll', onScroll)
    unsubscribeScene()
    unsubscribeRenderer()
    glassScheduler.cancel(state)
    state.surface?.dispose()
    state.layer?.canvas.remove()
  }
}

/**
 * Turn `ref`'s element into a liquid-glass surface. The shared WebGL2 renderer
 * composites the scene behind the surface (backdrop gradient + registered
 * proxies) into a per-surface GPU texture and paints its refraction into a
 * `bitmaprenderer` canvas; geometry, scene dirt, and scroll each re-drive it
 * through one rAF-coalesced scheduler. The element carries `data-glass-tier`
 * ("css" → "refract") and `data-glass-renders` (GPU uploads only) throughout,
 * and `--rim-tint` from every composite. Missing WebGL2 or `bitmaprenderer`, or
 * `maxTier: 'css'`, keeps it on the CSS tier (still tinted, no canvas).
 */
export function useLiquidGlass(
  ref: RefObject<HTMLElement | null>,
  options?: Partial<GlassOptions>,
): void {
  const {
    bevel = GLASS_DEFAULTS.bevel,
    strength = GLASS_DEFAULTS.strength,
    curvature = GLASS_DEFAULTS.curvature,
    chroma = GLASS_DEFAULTS.chroma,
    blur = GLASS_DEFAULTS.blur,
    saturate = GLASS_DEFAULTS.saturate,
    reflect = GLASS_DEFAULTS.reflect,
    maxTier = GLASS_DEFAULTS.maxTier,
  } = options ?? {}
  useEffect(() => {
    const el = ref.current
    if (!el) {
      return undefined
    }
    return mountGlass(el, {
      bevel,
      strength,
      curvature,
      chroma,
      blur,
      saturate,
      reflect,
      maxTier,
    })
  }, [ref, bevel, strength, curvature, chroma, blur, saturate, reflect, maxTier])
}
