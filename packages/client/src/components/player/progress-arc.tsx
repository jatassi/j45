import type { JSX, ReactNode, RefObject } from 'react'
import { useEffect, useRef } from 'react'

import type { DocRect, SceneProxyHandle } from '@/glass/scene'
import { sceneRegistry } from '@/glass/scene'

import type { PlayerPhase } from './phase'
import { PHASE_HUE } from './phase'

/**
 * The viewBox the arc is drawn on: wide, and half as tall.
 *
 * The half-height box is what makes the half circle a vertical saving rather
 * than a vertical cost. A square box carries an empty bottom half. That half
 * still takes layout, and it pushes the Progress strip and the Participants
 * off the bottom of the screen.
 */
const ARC_BOX_WIDTH = 300
const ARC_BOX_HEIGHT = 150
const ARC_VIEW_BOX = `0 0 ${ARC_BOX_WIDTH} ${ARC_BOX_HEIGHT}`

/**
 * The stroke, in viewBox units, so that it scales with the arc. On a 390px
 * screen it measures about 18px. A stroke in pixels was rejected: it reads
 * heavy on a small phone and thin on a large one, against its own arc.
 */
const ARC_STROKE = 15

/**
 * The circle the arc is cut from. Its centre is the middle of the box's bottom
 * edge, so the arc's chord *is* that edge.
 *
 * The radius is the box height less half the stroke. Half the stroke lies
 * outside the radius, so the stroke's outer edge falls on the box's left, top
 * and right edges exactly, and no side keeps a dead margin.
 */
export const ARC_RADIUS = ARC_BOX_HEIGHT - ARC_STROKE / 2
const ARC_CENTER_X = ARC_BOX_WIDTH / 2
const ARC_CENTER_Y = ARC_BOX_HEIGHT

/**
 * The gap the arc leaves: 180°, centred on the bottom. Nothing is drawn there.
 * The gap is the room the countdown digits grow into.
 */
const ARC_GAP_DEGREES = 180
/** What the arc and its track occupy: everything the gap leaves. */
const ARC_SWEEP_DEGREES = 360 - ARC_GAP_DEGREES

/**
 * The arc length of the sweep. All dash measurements use this length, not the
 * circumference. A whole arc is therefore a whole 180°, and no part of the
 * dash is left over to draw in the gap.
 */
export const ARC_SWEEP_LENGTH = 2 * Math.PI * ARC_RADIUS * (ARC_SWEEP_DEGREES / 360)

/** A point on the arc's circle, `degrees` clockwise from the top of the box. */
function arcPoint(degrees: number): string {
  const radians = (degrees * Math.PI) / 180
  const x = ARC_CENTER_X + ARC_RADIUS * Math.sin(radians)
  const y = ARC_CENTER_Y - ARC_RADIUS * Math.cos(radians)
  return `${x.toFixed(3)} ${y.toFixed(3)}`
}

/**
 * The sweep, as one arc command. It starts at the left end of the chord. It
 * runs clockwise, the direction the countdown has always depleted in, over the
 * top and down to the right end of the chord. The track and the arc both use
 * this path. A track drawn as a closed circle behind the sweep would make the
 * sweep look broken.
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
   * The content on the arc's chord. Pass **two** elements: the phase label,
   * then the countdown digits. Both player screens pass this same shape.
   * Anything else a screen must say goes below the arc, not inside it.
   *
   * Mark the element that carries the countdown with `data-arc-digits`. That
   * mark does two things: the countdown is the element centred on the chord,
   * and the glass proxy repaints it at the size and place it renders at.
   */
  children?: ReactNode
}

/** How the countdown is drawn, in the proxy rect's own coordinates. */
type RenderedDigits = { font: string; centerX: number; centerY: number }

/** The region the glass repaints, and how the countdown is drawn in it. */
type DigitsRegion = { rect: DocRect; digits: RenderedDigits }

/** Only held before the first measurement, which happens before the register. */
const UNMEASURED: DigitsRegion = {
  rect: { left: 0, top: 0, width: 0, height: 0 },
  digits: { font: 'bold 16px sans-serif', centerX: 0, centerY: 0 },
}

/**
 * Measure the countdown the arc draws, and the region it occupies in document
 * space (CSS px: viewport rect + scroll). The caller marks the countdown with
 * `data-arc-digits`. Without the mark, the whole box is measured, as before.
 *
 * The region is the container's box together with the countdown's own box. The
 * countdown is pushed down to straddle the arc's chord, and a transform on a
 * child never grows its parent's box. The container alone would therefore leave
 * the lower half of the countdown outside the region the glass repaints. The
 * countdown only moves down, so the union keeps the container's own origin, and
 * the coordinates below stay in the region's frame.
 *
 * The refraction repaints these digits, so it must use the size they render at.
 * A fixed share of the box's height cannot give that size. The box and the
 * digits take their clamps from different terms, so a share drifts with the
 * screen, and drifts again each time the type scale changes.
 */
function readDigitsRegion(container: HTMLElement): DigitsRegion {
  const el = container.querySelector<HTMLElement>('[data-arc-digits]') ?? container
  const box = el.getBoundingClientRect()
  const host = container.getBoundingClientRect()
  const left = Math.min(host.left, box.left)
  const top = Math.min(host.top, box.top)
  const style = getComputedStyle(el)
  const size = style.fontSize === '' ? '16px' : style.fontSize
  const family = style.fontFamily === '' ? 'sans-serif' : style.fontFamily
  const weight = style.fontWeight === '' ? 'normal' : style.fontWeight
  return {
    rect: {
      left: left + window.scrollX,
      top: top + window.scrollY,
      width: Math.max(host.right, box.right) - left,
      height: Math.max(host.bottom, box.bottom) - top,
    },
    digits: {
      font: `${weight} ${size} ${family}`,
      centerX: box.left - left + box.width / 2,
      centerY: box.top - top + box.height / 2,
    },
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
  const liveRef = useRef<LiveDigits>({ ...UNMEASURED, value })
  liveRef.current.value = value

  useEffect(() => {
    const el = ref.current
    if (!el) {
      return undefined
    }
    const live = liveRef.current
    const region = readDigitsRegion(el)
    live.rect = region.rect
    live.digits = region.digits
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
 * The immersive centrepiece: a phase-tinted SVG half circle that depletes
 * across the current segment via `stroke-dashoffset` (driven purely from
 * `fraction` — no timers of its own), with the `children` two-element contract
 * (the phase label and the countdown digits) sitting on its chord. The arc
 * sweeps 180° and leaves the whole bottom half open, so the digits overflow
 * below the chord into space nothing encloses.
 *
 * The children sit in a column whose bottom edge is the chord, so the label
 * stays inside the arc and clear of the stroke. The countdown is then pushed
 * down by half its own height, which puts its centre on the chord: half of it
 * is inside the arc and half is below, in the open.
 *
 * The countdown is the element that moves, not the whole column. A column
 * pushed down by half its own height would carry the label's height into the
 * offset, and the countdown would land below the chord by half of that.
 *
 * The digits region registers a dirty-region scene proxy keyed on
 * {@link ProgressArcProps.dirtyValue}.
 */
export function ProgressArc(props: ProgressArcProps): JSX.Element {
  const { fraction, phase, dirtyValue, children } = props
  const digitsRef = useRef<HTMLDivElement>(null)
  useDigitProxy(digitsRef, dirtyValue === undefined ? '' : String(dirtyValue))

  return (
    <div data-testid="player-progress-arc" className="relative size-full">
      {/*
        `pathLength` is not decoration. A browser measures this arc by
        flattening it, and gets 447.740 where the geometry gives 447.677.
        Declaring the length makes the dash values exact instead of near.
      */}
      <svg viewBox={ARC_VIEW_BOX} className="size-full" aria-hidden="true">
        <path
          d={ARC_SWEEP_PATH}
          fill="none"
          stroke="rgb(255 255 255 / 0.08)"
          strokeWidth={ARC_STROKE}
          strokeLinecap="round"
          pathLength={ARC_SWEEP_LENGTH}
        />
        <path
          data-testid="player-progress-arc-sweep"
          d={ARC_SWEEP_PATH}
          fill="none"
          stroke={PHASE_HUE[phase]}
          strokeWidth={ARC_STROKE}
          strokeLinecap="round"
          pathLength={ARC_SWEEP_LENGTH}
          strokeDasharray={ARC_SWEEP_LENGTH}
          strokeDashoffset={arcDashOffset(fraction)}
        />
      </svg>
      <div
        ref={digitsRef}
        data-testid="player-progress-arc-digits"
        className="absolute inset-x-0 bottom-0 flex flex-col items-center [&>[data-arc-digits]]:translate-y-1/2"
      >
        {children}
      </div>
    </div>
  )
}
