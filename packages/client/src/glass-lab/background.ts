/**
 * The glass lab's multicolour test backdrop — one deterministic painter used
 * twice: once into the visible `<canvas>` the page shows, and once (via
 * `drawImage` of that same canvas) by the scene proxy the refraction pipeline
 * composites. One writer, so what you see and what the glass refracts can
 * never drift.
 *
 * Content is chosen to expose each material axis:
 *   • large saturated colour fields — translucency and tint;
 *   • hard-edged stripe bands — rim displacement (edges visibly bend);
 *   • a fine grid — refraction curvature and chromatic fringing.
 */

type ColorField = {
  /** Centre, as fractions of the painted width/height. */
  x: number
  y: number
  /** Radius as a fraction of the painted width. */
  r: number
  color: string
}

const BASE = '#101014'

const FIELDS: readonly ColorField[] = [
  { x: 0.16, y: 0.1, r: 0.42, color: 'rgba(234, 88, 12, 0.95)' }, // orange
  { x: 0.85, y: 0.06, r: 0.38, color: 'rgba(37, 99, 235, 0.9)' }, // blue
  { x: 0.5, y: 0.3, r: 0.34, color: 'rgba(219, 39, 119, 0.85)' }, // magenta
  { x: 0.08, y: 0.46, r: 0.36, color: 'rgba(22, 163, 74, 0.9)' }, // green
  { x: 0.92, y: 0.5, r: 0.34, color: 'rgba(202, 138, 4, 0.9)' }, // amber
  { x: 0.3, y: 0.72, r: 0.4, color: 'rgba(8, 145, 178, 0.9)' }, // cyan
  { x: 0.78, y: 0.86, r: 0.42, color: 'rgba(147, 51, 234, 0.9)' }, // violet
  { x: 0.14, y: 0.96, r: 0.36, color: 'rgba(220, 38, 38, 0.9)' }, // red
]

const STRIPE_COLORS = ['#f97316', '#facc15', '#22c55e', '#3b82f6', '#ec4899', '#f8fafc'] as const

const GRID_SPACING = 48
const GRID_COLOR = 'rgba(255, 255, 255, 0.16)'

function paintFields(ctx: CanvasRenderingContext2D, width: number, height: number): void {
  for (const field of FIELDS) {
    const cx = field.x * width
    const cy = field.y * height
    const radius = field.r * width
    const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius)
    gradient.addColorStop(0, field.color)
    gradient.addColorStop(1, 'rgba(0, 0, 0, 0)')
    ctx.fillStyle = gradient
    ctx.fillRect(0, 0, width, height)
  }
}

/** A band of hard-edged colour blocks — refraction bends these visibly. */
function paintStripeBand(
  ctx: CanvasRenderingContext2D,
  width: number,
  band: { top: number; height: number },
): void {
  const stripeWidth = 56
  for (let x = 0, i = 0; x < width; x += stripeWidth, i += 1) {
    ctx.fillStyle = STRIPE_COLORS[i % STRIPE_COLORS.length] ?? BASE
    ctx.fillRect(x, band.top, stripeWidth, band.height)
  }
}

function paintGrid(ctx: CanvasRenderingContext2D, width: number, height: number): void {
  ctx.strokeStyle = GRID_COLOR
  ctx.lineWidth = 1
  ctx.beginPath()
  for (let x = GRID_SPACING; x < width; x += GRID_SPACING) {
    ctx.moveTo(x + 0.5, 0)
    ctx.lineTo(x + 0.5, height)
  }
  for (let y = GRID_SPACING; y < height; y += GRID_SPACING) {
    ctx.moveTo(0, y + 0.5)
    ctx.lineTo(width, y + 0.5)
  }
  ctx.stroke()
}

/** Paint the whole test backdrop into a CSS-px drawing space of `width`×`height`. */
export function paintLabBackground(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
): void {
  ctx.fillStyle = BASE
  ctx.fillRect(0, 0, width, height)
  paintFields(ctx, width, height)
  paintStripeBand(ctx, width, { top: height * 0.22, height: 72 })
  paintStripeBand(ctx, width, { top: height * 0.68, height: 72 })
  paintGrid(ctx, width, height)
}
