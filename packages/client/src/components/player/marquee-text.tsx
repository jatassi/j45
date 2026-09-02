import type { ComponentPropsWithoutRef, CSSProperties, JSX } from 'react'
import { useLayoutEffect, useRef, useState } from 'react'

import { cn } from '@/lib/utils'

/**
 * Scroll speed, in CSS pixels per second. The duration is derived from the
 * distance so every label travels at this one speed — a fixed duration would
 * make a barely-long name crawl and a very long one race.
 */
const SPEED = 30
/** Share of one leg spent travelling; the rest of it waits at the two ends. */
const TRAVEL_SHARE = 0.6
/** Floor, so a name that overruns by a few pixels does not twitch. */
const MIN_DURATION = 3
/** Ceiling, so a very long name still comes back inside a sensible wait. */
const MAX_DURATION = 12
/** Sub-pixel overruns are measurement noise, not text worth scrolling. */
const OVERRUN_EPSILON = 1
/**
 * Width of the soft edge where glyphs leave. It is padding, not text, so at
 * rest it dims nothing — the CSS draws the ramp over it. Only a scrolling
 * label is padded, so a label that fits keeps its full width; the travel has
 * to cover the padding as well as the overrun.
 */
const LEAD_FADE = 12
/**
 * Width of the soft edge that says the string continues. The travel overshoots
 * by this much so the last glyph ends up clear of the ramp, not inside it.
 */
const TAIL_FADE = 14

/** How far the track must travel, and for how long, or `null` when it fits. */
type Scroll = { readonly shift: number; readonly duration: number }

function scrollFor(overrun: number): Scroll | null {
  if (overrun <= OVERRUN_EPSILON) return null
  const distance = overrun + LEAD_FADE + TAIL_FADE
  const duration = Math.min(MAX_DURATION, Math.max(MIN_DURATION, distance / SPEED / TRAVEL_SHARE))
  return { shift: -distance, duration }
}

/** Equal measurements, so an unchanged re-measure can keep the old object. */
function sameScroll(a: Scroll | null, b: Scroll | null): boolean {
  if (a === null || b === null) return a === b
  return a.shift === b.shift && a.duration === b.duration
}

type MarqueeTextProps = {
  readonly children: string
  readonly className?: string
  // `style` is not forwarded: the viewport's own custom properties live there,
  // and a caller's style object would replace them wholesale.
} & Omit<ComponentPropsWithoutRef<'span'>, 'children' | 'className' | 'style'>

/**
 * A single line of text that scrolls sideways when it is too long for its slot,
 * instead of dropping its tail to an ellipsis. It waits, travels to the end,
 * waits again and returns the way it came, and the edges fade so the glyphs
 * dissolve rather than meet a hard clip.
 *
 * The overrun is measured after layout and re-measured whenever the text or
 * either width changes — a font that loads late moves the track width, which
 * the observer sees. The measurement reads untransformed geometry on both
 * sides, so it settles in one pass and stays right mid-scroll. When the text
 * fits, nothing animates, nothing is masked, and no width is given up to the
 * lead ramp. The track is keyed by the text, so a new name starts
 * from rest at its first character rather than inheriting the previous name's
 * scroll position.
 *
 * Sizes itself to its content and shrinks under flex pressure, the same as the
 * `truncate` it replaces, so it drops into a flex row unchanged.
 */
export function MarqueeText({ children, className, ...rest }: MarqueeTextProps): JSX.Element {
  const viewportRef = useRef<HTMLSpanElement>(null)
  const trackRef = useRef<HTMLSpanElement>(null)
  const [scroll, setScroll] = useState<Scroll | null>(null)

  useLayoutEffect(() => {
    const viewport = viewportRef.current
    const track = trackRef.current
    if (viewport === null || track === null) return

    const measure = (): void => {
      // `offsetWidth` is the track's untransformed layout width, so a
      // re-measure that lands mid-scroll reads the same as one at rest.
      // `clientWidth` is the slot's padding box, which the flex row fixes
      // whether or not the lead padding is on.
      const next = scrollFor(track.offsetWidth - viewport.clientWidth)
      setScroll((prev) => (sameScroll(prev, next) ? prev : next))
    }
    measure()

    // jsdom, and any browser predating the API, simply never re-measure.
    if (typeof ResizeObserver === 'undefined') return
    // The track: a late-loading font changes its width without moving the
    // viewport, which is already clamped by the row it shares.
    const observer = new ResizeObserver(measure)
    observer.observe(viewport)
    observer.observe(track)
    return () => observer.disconnect()
  }, [children])

  const style: CSSProperties = {
    ['--marquee-fade' as string]: `${LEAD_FADE}px`,
    ['--marquee-tail' as string]: `${TAIL_FADE}px`,
    ...(scroll === null
      ? {}
      : {
          ['--marquee-shift' as string]: `${scroll.shift}px`,
          ['--marquee-duration' as string]: `${scroll.duration}s`,
        }),
  }

  return (
    <span
      ref={viewportRef}
      className={cn(
        'player-marquee block min-w-0',
        scroll !== null && 'player-marquee-scrolls',
        className,
      )}
      style={style}
      {...rest}
    >
      <span
        key={children}
        ref={trackRef}
        className={cn('inline-block whitespace-nowrap', scroll !== null && 'player-marquee-track')}
      >
        {children}
      </span>
    </span>
  )
}
