import type { JSX, ReactNode, RefObject } from 'react'
import { useEffect, useRef } from 'react'

import type { DocRect, SceneProxyHandle } from '@/glass/scene'
import { sceneRegistry } from '@/glass/scene'
import { cn } from '@/lib/utils'

import type { PlayerPhase } from './phase'
import { PHASE_HUE } from './phase'

/** Ring geometry — a thin arc on a 300×300 viewBox (the /proto reference). */
export const RING_RADIUS = 132
export const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS

/**
 * Depleting stroke offset for a remaining `fraction` (0..1). At full (1) the
 * arc is whole (offset 0); at empty (0) it is fully retracted (offset =
 * circumference). Clamped so out-of-range interpolation never overdraws.
 */
function ringDashOffset(fraction: number): number {
  const clamped = Math.max(0, Math.min(1, fraction))
  return RING_CIRCUMFERENCE * (1 - clamped)
}

export type ProgressRingProps = {
  /** Remaining fraction of the current segment, 0..1 — drives the arc. */
  fraction: number
  /** Current phase — tints the progress stroke from the hue map. */
  phase: PlayerPhase
  /**
   * The currently displayed value (e.g. `mm:ss`). A change invalidates the
   * digits' dirty-region scene proxy so a glass dock overlapping them
   * re-composites just that region.
   */
  dirtyValue?: string | number
  /** The centred content — typically the huge countdown digits. */
  children?: ReactNode
}

const EMPTY_RECT: DocRect = { left: 0, top: 0, width: 0, height: 0 }

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

type LiveDigits = { rect: DocRect; value: string }

function paintDigits(ctx: CanvasRenderingContext2D, live: LiveDigits): void {
  if (!live.value) {
    return
  }
  ctx.fillStyle = 'rgb(255, 255, 255)'
  ctx.font = `bold ${Math.floor(live.rect.height * 0.6)}px sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(live.value, live.rect.width / 2, live.rect.height / 2)
}

/**
 * Register the digits region as a dirty-region scene proxy and invalidate it
 * whenever `value` changes — the `glass-demo/ticking-digit.tsx` pattern applied
 * to the countdown. The initial value is not an invalidation.
 */
function useDigitProxy(ref: RefObject<HTMLElement | null>, value: string): void {
  const handleRef = useRef<SceneProxyHandle | null>(null)
  const liveRef = useRef<LiveDigits>({ rect: EMPTY_RECT, value })
  liveRef.current.value = value

  useEffect(() => {
    const el = ref.current
    if (!el) {
      return undefined
    }
    const live = liveRef.current
    live.rect = readDocRect(el)
    const handle = sceneRegistry.register({
      rect: live.rect,
      z: 4,
      source: el,
      paint(ctx) {
        paintDigits(ctx, live)
      },
    })
    handleRef.current = handle
    return () => {
      handle.dispose()
      handleRef.current = null
    }
  }, [ref])

  const prevRef = useRef<string | null>(null)
  useEffect(() => {
    if (prevRef.current === null || prevRef.current === value) {
      prevRef.current = value
      return
    }
    prevRef.current = value
    handleRef.current?.invalidate(liveRef.current.rect)
  }, [value])
}

/**
 * The immersive centrepiece: a thin phase-tinted SVG ring that depletes across
 * the current segment via `stroke-dashoffset` (driven purely from `fraction` —
 * no timers of its own), with arbitrary `children` (the countdown digits)
 * centred inside. The digits region registers a dirty-region scene proxy keyed
 * on {@link ProgressRingProps.dirtyValue}.
 */
export function ProgressRing(props: ProgressRingProps): JSX.Element {
  const { fraction, phase, dirtyValue, children } = props
  const digitsRef = useRef<HTMLDivElement>(null)
  useDigitProxy(digitsRef, dirtyValue === undefined ? '' : String(dirtyValue))

  return (
    <div
      data-testid="player-progress-ring"
      className={cn('relative flex items-center justify-center')}
    >
      <svg viewBox="0 0 300 300" className="size-full -rotate-90" aria-hidden="true">
        <circle
          cx="150"
          cy="150"
          r={RING_RADIUS}
          fill="none"
          stroke="rgb(255 255 255 / 0.08)"
          strokeWidth="8"
        />
        <circle
          data-testid="player-progress-ring-arc"
          cx="150"
          cy="150"
          r={RING_RADIUS}
          fill="none"
          stroke={PHASE_HUE[phase]}
          strokeWidth="8"
          strokeLinecap="round"
          strokeDasharray={RING_CIRCUMFERENCE}
          strokeDashoffset={ringDashOffset(fraction)}
        />
      </svg>
      <div
        ref={digitsRef}
        data-testid="player-progress-ring-digits"
        className="absolute inset-0 flex flex-col items-center justify-center"
      >
        {children}
      </div>
    </div>
  )
}
