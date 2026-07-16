import { useEffect, useState } from 'react'

/**
 * The current visual viewport height in CSS px, scale-corrected so pinch-zoom
 * doesn't shrink it — effectively the height of the *visible* layout viewport.
 *
 * Why not `100dvh` alone: iOS Safari only re-resolves `dvh` after its bottom
 * toolbar finishes expanding/collapsing, so a `dvh`-sized player snaps once at
 * the end of the transition. `visualViewport` fires `resize` throughout, which
 * lets the immersive player (and its bottom control dock, anchored to the
 * container's bottom edge) track the toolbar continuously. Callers keep a
 * `dvh` class as the base and override with this value when defined.
 *
 * Returns `undefined` where the API is unavailable (jsdom, old browsers) —
 * callers then stay on their `100dvh` fallback.
 */
export function useVisualViewportHeight(): number | undefined {
  const [height, setHeight] = useState<number | undefined>(readHeight)

  useEffect(() => {
    const viewport = globalThis.visualViewport
    if (!viewport) return
    const update = (): void => setHeight(readHeight())
    viewport.addEventListener('resize', update)
    return () => viewport.removeEventListener('resize', update)
  }, [])

  return height
}

function readHeight(): number | undefined {
  const viewport = globalThis.visualViewport
  if (!viewport) return undefined
  return Math.round(viewport.height * viewport.scale)
}
