import type { RefObject } from 'react'
import { useEffect } from 'react'

import type { DocRect } from './scene'
import { sceneRegistry } from './scene'

export type SceneSurfaceOptions = {
  /** Fill colour. Omitted → measured from the element's computed
   *  `background-color` at mount (a fully transparent computed colour
   *  paints nothing). */
  color?: string
  /** Corner radius, CSS px. Omitted → measured from computed
   *  `border-radius`, clamped to half the shorter side (so `rounded-full`
   *  pills paint the radius the browser paints). */
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

/** Measured corner radius in CSS px, clamped like the glass hook's. */
function measureRadius(el: HTMLElement, rect: DocRect): number {
  const value = Number.parseFloat(getComputedStyle(el).borderTopLeftRadius)
  if (!Number.isFinite(value)) {
    return 0
  }
  return Math.min(value, Math.min(rect.width, rect.height) / 2)
}

/** True when the computed colour string is fully transparent. */
function isTransparent(color: string): boolean {
  return color === 'transparent' || /rgba\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*0\s*\)/.test(color)
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
 * hairline) at the proxy origin. `color`/`radius` omitted are measured from
 * computed style, so a plain content card registers with no configuration.
 * Elements inside a `.glass-surface` are silently skipped — glass never
 * refracts glass, and content laid over glass belongs to that surface, not
 * to the scene behind it.
 */
export function useSceneSurface(
  ref: RefObject<HTMLElement | null>,
  options: SceneSurfaceOptions = {},
): void {
  const { color, radius, z = 0, hairline } = options

  useEffect(() => {
    const el = ref.current
    if (!el || el.closest('.glass-surface')) {
      return undefined
    }

    const rect = readDocRect(el)
    // Mutable so paint always uses the latest geometry after resize updates.
    const live = {
      rect,
      color: color ?? getComputedStyle(el).backgroundColor,
      radius: radius ?? measureRadius(el, rect),
      hairline,
    }

    const handle = sceneRegistry.register({
      rect: live.rect,
      z,
      source: el,
      paint(ctx) {
        if (isTransparent(live.color)) {
          return
        }
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
      live.rect = readDocRect(el)
      live.radius = radius ?? measureRadius(el, live.rect)
      handle.update({ rect: live.rect })
    }

    const stopObserving = observe(el, syncRect)
    return () => {
      stopObserving()
      handle.dispose()
    }
  }, [ref, color, radius, z, hairline])
}
