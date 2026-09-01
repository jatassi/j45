import type { JSX, ReactNode, RefObject } from 'react'
import { useEffect, useRef } from 'react'

import type { DocRect, SceneProxyHandle } from '@/glass/scene'
import { sceneRegistry } from '@/glass/scene'
import { cn } from '@/lib/utils'

import type { PlayerPhase } from './phase'
import { PHASE_HUE } from './phase'

/** Arc geometry — a thin arc on a 300×300 viewBox (the /proto reference). */
export const ARC_RADIUS = 132
const ARC_CENTER = 150

/**
 * The gap the arc leaves: 90°, centred on the bottom. Nothing is drawn there.
 * The gap is the room the countdown digits grow into.
 */
const ARC_GAP_DEGREES = 90
/** What the arc and its track occupy: everything the gap leaves. */
const ARC_SWEEP_DEGREES = 360 - ARC_GAP_DEGREES

/**
 * The arc length of the sweep. All dash measurements use this length, not the
 * circumference. A whole arc is therefore a whole 270°, and no part of the
 * dash is left over to draw in the gap.
 */
export const ARC_SWEEP_LENGTH = 2 * Math.PI * ARC_RADIUS * (ARC_SWEEP_DEGREES / 360)

/** A point on the arc's circle, `degrees` clockwise from the top of the box. */
function arcPoint(degrees: number): string {
  const radians = (degrees * Math.PI) / 180
  const x = ARC_CENTER + ARC_RADIUS * Math.sin(radians)
  const y = ARC_CENTER - ARC_RADIUS * Math.cos(radians)
  return `${x.toFixed(3)} ${y.toFixed(3)}`
}

/**
 * The sweep, as one arc command. It starts at the gap's trailing edge. It runs
 * clockwise, the direction the countdown has always depleted in, over the top
 * and down to the gap's leading edge. The track and the arc both use this path.
 * A track drawn as a closed circle behind the sweep would make the sweep look
 * broken.
 */
const ARC_SWEEP_PATH = [
  `M ${arcPoint(180 + ARC_GAP_DEGREES / 2)}`,
  `A ${ARC_RADIUS} ${ARC_RADIUS} 0 ${ARC_SWEEP_DEGREES > 180 ? 1 : 0} 1`,
  arcPoint(180 - ARC_GAP_DEGREES / 2),
].join(' ')

/**
 * Depleting stroke offset for a remaining `fraction` (0..1). At full (1) the
 * arc is the whole sweep, so the offset is 0. At empty (0) the arc is fully
 * retracted, so the offset is the sweep's length. The dash always starts where
 * the sweep starts. Only its far end moves. The fraction is clamped, so
 * out-of-range interpolation cannot overdraw.
 */
function arcDashOffset(fraction: number): number {
  const clamped = Math.max(0, Math.min(1, fraction))
  return ARC_SWEEP_LENGTH * (1 - clamped)
}

export type ProgressArcProps = {
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
  /**
   * The centred content — typically the huge countdown digits. Mark the
   * element that carries the countdown with `data-arc-digits` so the glass
   * proxy repaints it at the size and place it actually renders at.
   */
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

/** How the countdown is drawn, in the proxy rect's own coordinates. */
type RenderedDigits = { font: string; centerX: number; centerY: number }

/** Only held before the first measurement, which happens before the register. */
const UNMEASURED: RenderedDigits = { font: 'bold 16px sans-serif', centerX: 0, centerY: 0 }

/**
 * Measure the countdown the arc draws. The caller marks that element with
 * `data-arc-digits`. Without the mark, the whole box is measured, as before.
 *
 * The refraction repaints these digits, so it must use the size they render
 * at. A fixed share of the box's height cannot give that size. The box and the
 * digits take their clamps from different viewport terms, so a share drifts
 * with the screen, and drifts again each time the type scale changes.
 */
function readRenderedDigits(container: HTMLElement): RenderedDigits {
  const el = container.querySelector<HTMLElement>('[data-arc-digits]') ?? container
  const box = el.getBoundingClientRect()
  const host = container.getBoundingClientRect()
  const style = getComputedStyle(el)
  const size = style.fontSize === '' ? '16px' : style.fontSize
  const family = style.fontFamily === '' ? 'sans-serif' : style.fontFamily
  const weight = style.fontWeight === '' ? 'normal' : style.fontWeight
  return {
    font: `${weight} ${size} ${family}`,
    centerX: box.left - host.left + box.width / 2,
    centerY: box.top - host.top + box.height / 2,
  }
}

type LiveDigits = { rect: DocRect; value: string; digits: RenderedDigits }

function paintDigits(ctx: CanvasRenderingContext2D, live: LiveDigits): void {
  if (!live.value) {
    return
  }
  ctx.fillStyle = 'rgb(255, 255, 255)'
  ctx.font = live.digits.font
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(live.value, live.digits.centerX, live.digits.centerY)
}

/**
 * Register the digits region as a dirty-region scene proxy and invalidate it
 * whenever `value` changes — the `glass-demo/ticking-digit.tsx` pattern applied
 * to the countdown. The initial value is not an invalidation. The rect and the
 * rendered size are measured together, once, when the proxy is registered.
 */
function useDigitProxy(ref: RefObject<HTMLElement | null>, value: string): void {
  const handleRef = useRef<SceneProxyHandle | null>(null)
  const liveRef = useRef<LiveDigits>({ rect: EMPTY_RECT, value, digits: UNMEASURED })
  liveRef.current.value = value

  useEffect(() => {
    const el = ref.current
    if (!el) {
      return undefined
    }
    const live = liveRef.current
    live.rect = readDocRect(el)
    live.digits = readRenderedDigits(el)
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
 * The immersive centrepiece: a thin phase-tinted SVG arc that depletes across
 * the current segment via `stroke-dashoffset` (driven purely from `fraction` —
 * no timers of its own), with arbitrary `children` (the countdown digits)
 * centred inside. The arc sweeps 270° and leaves a gap on the bottom. The
 * digits may overflow the circle into that gap. The digits region registers a
 * dirty-region scene proxy keyed on {@link ProgressArcProps.dirtyValue}.
 */
export function ProgressArc(props: ProgressArcProps): JSX.Element {
  const { fraction, phase, dirtyValue, children } = props
  const digitsRef = useRef<HTMLDivElement>(null)
  useDigitProxy(digitsRef, dirtyValue === undefined ? '' : String(dirtyValue))

  return (
    <div
      data-testid="player-progress-arc"
      className={cn('relative flex items-center justify-center')}
    >
      {/*
        `pathLength` is not decoration. A browser measures this arc by
        flattening it, and gets 622.123 where the geometry gives 622.035.
        Declaring the length makes the dash values exact instead of near.
      */}
      <svg viewBox="0 0 300 300" className="size-full" aria-hidden="true">
        <path
          d={ARC_SWEEP_PATH}
          fill="none"
          stroke="rgb(255 255 255 / 0.08)"
          strokeWidth="8"
          strokeLinecap="round"
          pathLength={ARC_SWEEP_LENGTH}
        />
        <path
          data-testid="player-progress-arc-sweep"
          d={ARC_SWEEP_PATH}
          fill="none"
          stroke={PHASE_HUE[phase]}
          strokeWidth="8"
          strokeLinecap="round"
          pathLength={ARC_SWEEP_LENGTH}
          strokeDasharray={ARC_SWEEP_LENGTH}
          strokeDashoffset={arcDashOffset(fraction)}
        />
      </svg>
      <div
        ref={digitsRef}
        data-testid="player-progress-arc-digits"
        className="absolute inset-0 flex flex-col items-center justify-center"
      >
        {children}
      </div>
    </div>
  )
}
