/**
 * CSS-tier rim tint: average a composited slice's border band to one color
 * and feed it into `glass.css` as `--rim-tint`. The cheap path is a
 * `drawImage` reduction of the four 1-device-px edges onto a 1×1 canvas.
 * Degrades to `null` without a 2d context — never throws (same convention
 * as `rasteriseCardSlice`).
 */

/**
 * Average color of the slice's 1-device-px border band as a CSS `rgb(...)`
 * string. Returns `null` when no 2d context is available.
 */
export function rimTintFromSlice(slice: HTMLCanvasElement): string | null {
  const w = slice.width
  const h = slice.height
  if (w < 1 || h < 1) return null

  const doc = slice.ownerDocument
  const out = doc.createElement('canvas')
  out.width = 1
  out.height = 1
  const ctx = out.getContext('2d')
  if (!ctx) return null

  // Degenerate: the whole slice is the border band — reduce in one step.
  if (w === 1 || h === 1) {
    ctx.drawImage(slice, 0, 0, 1, 1)
  } else {
    // Lay the four 1px edges into a single strip (corners once each via the
    // top/bottom rows), then reduce the strip to 1×1.
    const side = h - 2
    const strip = doc.createElement('canvas')
    strip.width = w * 2 + side * 2
    strip.height = 1
    const sctx = strip.getContext('2d')
    if (!sctx) return null

    let x = 0
    sctx.drawImage(slice, 0, 0, w, 1, x, 0, w, 1) // top
    x += w
    sctx.drawImage(slice, 0, h - 1, w, 1, x, 0, w, 1) // bottom
    x += w
    if (side > 0) {
      sctx.drawImage(slice, 0, 1, 1, side, x, 0, side, 1) // left
      x += side
      sctx.drawImage(slice, w - 1, 1, 1, side, x, 0, side, 1) // right
    }
    ctx.drawImage(strip, 0, 0, 1, 1)
  }

  const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data
  return `rgb(${r}, ${g}, ${b})`
}
