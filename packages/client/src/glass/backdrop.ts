/**
 * The document-anchored backdrop: a single radial gradient, centred at the
 * top-middle of the document, that every glass surface refracts a slice
 * of. The gradient constants below are the single source of truth — the
 * full-document element `installBackdrop` paints and the small card-space
 * slices `rasteriseCardSlice` rasterises both read from the same three
 * exports, so there is exactly one writer for what "the backdrop" looks
 * like.
 */
import type { RenderParams } from './geometry'

/** The base fill under the gradient. Also the page's `--background` token
 *  (pinned cross-task: index.css's `--background` must equal this). */
export const BACKDROP_BASE = '#08090b'

export type BackdropStop = { offset: number; color: string }

export const BACKDROP_STOPS: readonly BackdropStop[] = [
  { offset: 0, color: '#15171c' },
  { offset: 0.38, color: '#0b0c10' },
  { offset: 1, color: '#08090b' },
]

/** Gradient radius, as a multiple of `max(viewport width, viewport height)`. */
export const BACKDROP_RADIUS_FACTOR = 1.25

const BACKDROP_ATTR = 'data-glass-backdrop'

function backdropGradient(radiusPx: number): string {
  const stops = BACKDROP_STOPS.map(({ offset, color }) => `${color} ${offset * 100}%`).join(', ')
  return `radial-gradient(circle ${radiusPx}px at 50% 0px, ${stops})`
}

/**
 * Idempotent: paints the full-document backdrop element, creating it (and
 * prepending it to `<body>`) on first call, then repainting that same
 * element — sized and positioned to the current document — on every later
 * call. Never a second element.
 */
export function installBackdrop(doc: Document = document): HTMLElement {
  const existing = doc.querySelector<HTMLElement>(`[${BACKDROP_ATTR}]`)
  const el = existing ?? doc.createElement('div')
  if (!existing) {
    el.setAttribute(BACKDROP_ATTR, '')
    el.setAttribute('aria-hidden', 'true')
    doc.body.prepend(el)
  }

  const view = doc.defaultView
  const width = doc.documentElement.scrollWidth
  const height = doc.documentElement.scrollHeight
  const radius =
    BACKDROP_RADIUS_FACTOR * Math.max(view?.innerWidth ?? width, view?.innerHeight ?? height)

  Object.assign(el.style, {
    position: 'absolute',
    top: '0',
    left: '0',
    width: `${width}px`,
    height: `${height}px`,
    zIndex: '-1',
    pointerEvents: 'none',
    // Set separately, not as a comma-joined `background` shorthand: the
    // gradient is the image layer, BACKDROP_BASE the solid colour beneath
    // it (where the gradient falls transparent at the rim, if it ever
    // does) — also keeps each layer independently inspectable/testable.
    backgroundImage: backdropGradient(radius),
    backgroundColor: BACKDROP_BASE,
  })
  return el
}

/** The render-params fields the card-space slice needs from `geometry.ts` —
 *  its document-space offset, the buffer it fills, and the dpr both are
 *  expressed at. */
export type SliceGeometry = Pick<
  RenderParams,
  'sliceLeft' | 'sliceTop' | 'bufferWidth' | 'bufferHeight' | 'dpr'
>

export type ViewportSize = { width: number; height: number }

export type SliceMapping = {
  /** The small canvas's own drawing-buffer size, device px — copied
   *  straight from the render params. */
  canvasWidth: number
  canvasHeight: number
  /** Gradient centre, device px, relative to the small canvas's own
   *  origin (already offset by the card's document-space position). */
  centerX: number
  centerY: number
  /** Gradient radius, device px. */
  radius: number
}

export type MapSliceOptions = {
  slice: SliceGeometry
  viewport: ViewportSize
  documentWidth: number
}

/**
 * Pure mapping from a card's render params plus the page's viewport/
 * document dimensions to where, in the small per-card canvas, the
 * document-anchored gradient's centre and radius fall. Exported separately
 * from `rasteriseCardSlice` so the offset/scale math is unit-testable
 * without a working 2D canvas context.
 */
export function mapSliceToGradient(options: MapSliceOptions): SliceMapping {
  const { slice, viewport, documentWidth } = options
  const centerXDoc = documentWidth / 2
  return {
    canvasWidth: slice.bufferWidth,
    canvasHeight: slice.bufferHeight,
    centerX: (centerXDoc - slice.sliceLeft) * slice.dpr,
    centerY: (0 - slice.sliceTop) * slice.dpr,
    radius: BACKDROP_RADIUS_FACTOR * Math.max(viewport.width, viewport.height) * slice.dpr,
  }
}

export type RasteriseOptions = MapSliceOptions & { document?: Document }

/**
 * Draws this card's slice of the document-anchored gradient (document-
 * space offset = viewport rect + scroll offset, folded into `slice` by
 * `geometry.ts`) into a small 2D canvas sized at the params' dpr, ready to
 * upload as the shader's `uGradient` texture. Degrades to an unpainted (but
 * correctly sized) canvas if a 2D context isn't available — callers never
 * need to guard.
 */
export function rasteriseCardSlice(options: RasteriseOptions): HTMLCanvasElement {
  const mapping = mapSliceToGradient(options)
  const doc = options.document ?? document
  const canvas = doc.createElement('canvas')
  canvas.width = mapping.canvasWidth
  canvas.height = mapping.canvasHeight

  const ctx = canvas.getContext('2d')
  if (!ctx) return canvas

  ctx.fillStyle = BACKDROP_BASE
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  const gradient = ctx.createRadialGradient(
    mapping.centerX,
    mapping.centerY,
    0,
    mapping.centerX,
    mapping.centerY,
    mapping.radius,
  )
  for (const { offset, color } of BACKDROP_STOPS) gradient.addColorStop(offset, color)
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  return canvas
}
