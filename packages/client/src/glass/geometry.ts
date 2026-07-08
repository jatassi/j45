/**
 * Pure, DOM-free geometry math for glass surfaces: card rect × scroll ×
 * dpr × radius → render params (drawing-buffer size, document-space slice
 * offset/scale) and a stable geometry key. Nothing here touches the DOM —
 * callers (the `useLiquidGlass` hook) read `getBoundingClientRect()`,
 * `window.scrollX`/`scrollY`, and `devicePixelRatio` and feed the plain
 * numbers in.
 */

/** A card's CSS-px position and size, viewport-relative — exactly what
 *  `Element.getBoundingClientRect()` reports. */
export type CardRect = {
  left: number
  top: number
  width: number
  height: number
}

/** Page scroll offset in CSS px — `window.scrollX` / `window.scrollY`. */
export type ScrollOffset = {
  x: number
  y: number
}

export type GeometryInput = {
  rect: CardRect
  scroll: ScrollOffset
  dpr: number
  radius: number
}

export type RenderParams = {
  /** Drawing-buffer size in device px: CSS size × dpr, rounded to whole
   *  pixels (minimum 1×1 so a not-yet-laid-out surface never sizes a
   *  buffer to zero). */
  bufferWidth: number
  bufferHeight: number
  /** devicePixelRatio the buffer was sized at. */
  dpr: number
  /** Card corner radius, CSS px — forwarded to the shader as `uRadius`. */
  radiusCss: number
  /** Document-space position of the card's top-left corner, CSS px:
   *  viewport rect + scroll offset. This is where `backdrop.ts` slices
   *  the document-anchored gradient from. */
  sliceLeft: number
  sliceTop: number
  /** CSS px → device px scale for the slice; always equal to `dpr`,
   *  spelled out separately so callers of render params never have to
   *  know that fact. */
  sliceScale: number
}

/** Card rect × scroll × dpr × radius → render params. */
export function computeRenderParams(input: GeometryInput): RenderParams {
  const { rect, scroll, dpr, radius } = input
  return {
    bufferWidth: Math.max(1, Math.round(rect.width * dpr)),
    bufferHeight: Math.max(1, Math.round(rect.height * dpr)),
    dpr,
    radiusCss: radius,
    sliceLeft: rect.left + scroll.x,
    sliceTop: rect.top + scroll.y,
    sliceScale: dpr,
  }
}

/**
 * A stable identity for "does this surface need to re-render". Built from
 * document-space position (rect + scroll — exactly what stays constant as
 * the page scrolls) plus CSS size, dpr, and radius, so:
 *
 *   - scrolling never changes the key: for a card that hasn't moved in the
 *     document, `rect.top` falls by exactly as much as `scroll.y` rises,
 *     so `sliceTop` (their sum) is invariant;
 *   - content mutation never changes the key: nothing here reads text or
 *     children, only rect/scroll/dpr/radius;
 *   - the key changes when the card moves in the document, is resized in
 *     CSS px, its dpr changes (e.g. dragged to another monitor), or its
 *     measured corner radius changes.
 */
export function geometryKey(input: GeometryInput): string {
  const params = computeRenderParams(input)
  return [
    params.sliceLeft.toFixed(1),
    params.sliceTop.toFixed(1),
    input.rect.width.toFixed(1),
    input.rect.height.toFixed(1),
    params.dpr,
    params.radiusCss,
  ].join('|')
}
