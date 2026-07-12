import type { RefObject } from 'react'
import { useEffect } from 'react'

import type { DocRect } from './scene'
import { sceneRegistry } from './scene'

export type SceneSurfaceOptions = {
  color: string
  radius?: number
  z?: number
  hairline?: string
}

/** Element geometry in document space (CSS px): viewport rect + scroll. */
function readDocRect(el: HTMLElement): DocRect {
  const rect = el.getBoundingClientRect()
  return {
    left: rect.left + window.scrollX,
    top: rect.top + window.scrollY,
    width: rect.width,
    height: rect.height,
  }
}

/**
 * Static-contract watch set: element ResizeObserver + window resize /
 * orientationchange. No scroll listener — static content does not move in
 * document space.
 */
function observe(el: HTMLElement, onChange: () => void): () => void {
  let observer: ResizeObserver | undefined
  if (typeof ResizeObserver !== 'undefined') {
    observer = new ResizeObserver(onChange)
    observer.observe(el)
  }
  window.addEventListener('resize', onChange)
  globalThis.addEventListener('orientationchange', onChange)
  return () => {
    observer?.disconnect()
    window.removeEventListener('resize', onChange)
    globalThis.removeEventListener('orientationchange', onChange)
  }
}

/**
 * Register `ref`'s element as an opaque card proxy with the scene registry.
 * Geometry is document-space; paint draws a filled rounded rect (optional
 * hairline) at the proxy origin. The registry's own `.glass-surface` guard
 * refuses sources inside glass — the hook always registers and lets that
 * guard decide.
 */
export function useSceneSurface(
  ref: RefObject<HTMLElement | null>,
  options: SceneSurfaceOptions,
): void {
  const { color, radius = 0, z = 0, hairline } = options

  useEffect(() => {
    const el = ref.current
    if (!el) {
      return undefined
    }

    // Mutable so paint always uses the latest geometry after resize updates.
    const live = {
      rect: readDocRect(el),
      color,
      radius,
      hairline,
    }

    const handle = sceneRegistry.register({
      rect: live.rect,
      z,
      source: el,
      paint(ctx) {
        ctx.beginPath()
        ctx.roundRect(0, 0, live.rect.width, live.rect.height, live.radius)
        ctx.fillStyle = live.color
        ctx.fill()
        if (live.hairline) {
          ctx.strokeStyle = live.hairline
          ctx.lineWidth = 1
          ctx.stroke()
        }
      },
    })

    const syncRect = (): void => {
      const rect = readDocRect(el)
      live.rect = rect
      handle.update({ rect })
    }

    const stopObserving = observe(el, syncRect)
    return () => {
      stopObserving()
      handle.dispose()
    }
  }, [ref, color, radius, z, hairline])
}
