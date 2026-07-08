import type { RefObject } from 'react'
import { useEffect } from 'react'

import { rasteriseCardSlice } from './backdrop'
import type { GeometryInput, RenderParams } from './geometry'
import { computeRenderParams, geometryKey } from './geometry'
import { refractionRenderer } from './renderer'

/**
 * Per-surface refraction knobs, forwarded to the shader (`bevel`/`strength`/
 * `curvature`/`chroma`) or applied as the layer canvas's CSS filter
 * (`blur`/`saturate`). The corner radius is measured from computed
 * `border-radius`, never passed. Defaults are the personal-site port's.
 */
export type GlassOptions = {
  bevel: number
  strength: number
  curvature: number
  chroma: number
  blur: number
  saturate: number
}

export const GLASS_DEFAULTS: GlassOptions = {
  bevel: 34,
  strength: 11,
  curvature: 3,
  chroma: 0.24,
  blur: 1.5,
  saturate: 1.5,
}

const LAYER_CLASS = 'glass-layer'

type Layer = { canvas: HTMLCanvasElement; ctx: ImageBitmapRenderingContext }
type SurfaceState = { lastKey: string | null; renders: number; layer: Layer | null }

/** Corner radius in CSS px, read from computed `border-radius` (0 if unset). */
function measureRadius(el: HTMLElement): number {
  const value = Number.parseFloat(getComputedStyle(el).borderTopLeftRadius)
  return Number.isFinite(value) ? value : 0
}

/** Snapshot the surface's document-space geometry — the render trigger's input. */
function readGeometryInput(el: HTMLElement): GeometryInput {
  const rect = el.getBoundingClientRect()
  return {
    rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
    scroll: { x: window.scrollX, y: window.scrollY },
    dpr: window.devicePixelRatio || 1,
    radius: measureRadius(el),
  }
}

/** Rasterise this surface's backdrop slice and drive the shared GPU renderer. */
function refract(params: RenderParams, options: GlassOptions): ImageBitmap | null {
  if (!refractionRenderer.available) {
    return null
  }
  const slice = rasteriseCardSlice({
    slice: params,
    viewport: { width: window.innerWidth, height: window.innerHeight },
    documentWidth: document.documentElement.scrollWidth,
  })
  return refractionRenderer.render(slice, {
    widthPx: params.bufferWidth,
    heightPx: params.bufferHeight,
    dpr: params.dpr,
    radiusCss: params.radiusCss,
    bevel: options.bevel,
    strength: options.strength,
    curvature: options.curvature,
    chroma: options.chroma,
  })
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
    zIndex: '0',
    pointerEvents: 'none',
  })
  el.prepend(canvas)
  state.layer = { canvas, ctx }
  return state.layer
}

function paint(layer: Layer, bitmap: ImageBitmap, params: RenderParams): void {
  layer.canvas.width = params.bufferWidth
  layer.canvas.height = params.bufferHeight
  layer.ctx.transferFromImageBitmap(bitmap)
}

/**
 * Render the surface iff its geometry key moved. Rare by construction (only
 * layout changes it), so the GPU pass and bitmap transfer stay off the hot
 * path; content mutation and scrolling leave the key — and the render count —
 * untouched.
 */
function renderSurface(el: HTMLElement, options: GlassOptions, state: SurfaceState): void {
  const input = readGeometryInput(el)
  const key = geometryKey(input)
  if (key === state.lastKey) {
    return
  }
  const params = computeRenderParams(input)
  const bitmap = refract(params, options)
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
}

/** The static-contract watch set: element + body resize and window resize/
 *  orientation. Deliberately no scroll listener and no animation-frame loop. */
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

/** Wire one surface: seed its tier/render attributes, watch geometry, subscribe
 *  to context loss, and paint once. Returns the teardown. */
function mountGlass(el: HTMLElement, options: GlassOptions): () => void {
  const state: SurfaceState = { lastKey: null, renders: 0, layer: null }
  el.dataset.glassTier = 'css'
  el.dataset.glassRenders = '0'
  applyFilterVars(el, options)
  const render = (): void => {
    renderSurface(el, options, state)
  }
  const stopObserving = observe(el, render)
  const unsubscribe = refractionRenderer.subscribe((event) => {
    if (event === 'lost') {
      el.dataset.glassTier = 'css'
      state.lastKey = null
    } else {
      render()
    }
  })
  render()
  return () => {
    stopObserving()
    unsubscribe()
    state.layer?.canvas.remove()
  }
}

/**
 * Turn `ref`'s element into a liquid-glass surface: the shared WebGL2 renderer
 * paints its refracted backdrop into a `bitmaprenderer` canvas whenever the
 * surface's geometry key changes, and the element carries `data-glass-tier`
 * ("css" → "refract") and `data-glass-renders` throughout. Missing WebGL2 or
 * `bitmaprenderer` leaves it silently on the CSS tier.
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
  } = options ?? {}
  useEffect(() => {
    const el = ref.current
    if (!el) {
      return undefined
    }
    return mountGlass(el, { bevel, strength, curvature, chroma, blur, saturate })
  }, [ref, bevel, strength, curvature, chroma, blur, saturate])
}
