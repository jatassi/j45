import type { JSX, RefObject } from 'react'
import { useEffect, useRef } from 'react'

import type { DocRect, SceneProxyHandle } from '@/glass/scene'
import { sceneRegistry } from '@/glass/scene'

/** Digit-block size in CSS px — small enough to only dirty a sub-region. */
export const DIGIT_SIZE = 28

/** Scripted scenario: ten dirt updates at 1 Hz, then stop. */
export const TICK_COUNT = 10
export const TICK_INTERVAL_MS = 1000

export type TickingDigitProps = {
  /** When true, start the 10-tick 1 Hz sequence (once). */
  armed: boolean
  /**
   * Document-space origin of the digit block. Must overlap the fixed glass
   * bar and no other glass surface.
   */
  rect: DocRect
}

type LiveDigit = { digit: number; rect: DocRect }

function paintDigit(ctx: CanvasRenderingContext2D, live: LiveDigit): void {
  const { digit, rect } = live
  ctx.fillStyle = 'rgb(20, 20, 28)'
  ctx.fillRect(0, 0, rect.width, rect.height)
  ctx.fillStyle = 'rgb(255, 200, 60)'
  ctx.font = `bold ${Math.floor(rect.height * 0.7)}px monospace`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(String(digit % 10), rect.width / 2, rect.height / 2)
}

/** Register the digit proxy; dispose on unmount or rect change. */
function useDigitProxy(rect: DocRect): {
  handleRef: RefObject<SceneProxyHandle | null>
  liveRef: RefObject<LiveDigit>
} {
  const handleRef = useRef<SceneProxyHandle | null>(null)
  const liveRef = useRef<LiveDigit>({ digit: 0, rect })
  liveRef.current.rect = rect

  const { left, top, width, height } = rect
  useEffect(() => {
    const live = liveRef.current
    live.digit = 0
    live.rect = { left, top, width, height }
    const handle = sceneRegistry.register({
      rect: live.rect,
      z: 5,
      paint(ctx) {
        paintDigit(ctx, live)
      },
    })
    handleRef.current = handle
    return () => {
      handle.dispose()
      handleRef.current = null
    }
  }, [left, top, width, height])

  return { handleRef, liveRef }
}

/** When armed, fire exactly ten 1 Hz invalidates of the digit rect, then stop. */
function useArmedTicks(
  armed: boolean,
  handleRef: RefObject<SceneProxyHandle | null>,
  liveRef: RefObject<LiveDigit>,
): void {
  const ranRef = useRef(false)

  useEffect(() => {
    if (!armed || ranRef.current) {
      return undefined
    }
    ranRef.current = true
    let ticks = 0
    const id = globalThis.setInterval(() => {
      const handle = handleRef.current
      if (!handle) {
        return
      }
      ticks += 1
      liveRef.current.digit = ticks
      handle.invalidate(liveRef.current.rect)
      if (ticks >= TICK_COUNT) {
        globalThis.clearInterval(id)
      }
    }, TICK_INTERVAL_MS)
    return () => {
      globalThis.clearInterval(id)
    }
  }, [armed, handleRef, liveRef])
}

/**
 * Dirty-region digit proxy for the `/glass` perf harness. Paints and
 * invalidates only its small digit-block rect. Idle until `armed`, then
 * exactly {@link TICK_COUNT} updates at 1 Hz.
 */
export function TickingDigit(props: TickingDigitProps): JSX.Element {
  const { armed, rect } = props
  const { handleRef, liveRef } = useDigitProxy(rect)
  useArmedTicks(armed, handleRef, liveRef)

  return (
    <div
      data-testid="glass-ticking-digit"
      aria-hidden="true"
      style={{
        position: 'absolute',
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
        pointerEvents: 'none',
        opacity: 0.01,
      }}
    />
  )
}
