import type { CSSProperties, JSX } from 'react'
import { useRef } from 'react'

import { useSceneSurface } from '@/glass/use-scene-surface'
import { cn } from '@/lib/utils'

import type { PlayerPhase } from './phase'
import { PHASE_HUE, resolvePhaseHue } from './phase'

/**
 * Inject an alpha channel into a resolved space-syntax CSS colour function
 * (`oklch(0.75 0.14 233)` → `oklch(0.75 0.14 233 / 0.25)`). Comma-form or
 * otherwise unparsable colours are returned as-is (full strength).
 */
function withAlpha(color: string, alpha: number): string {
  return /^[a-z-]+\([^),/]*\)$/i.test(color) ? color.replace(/\)$/, ` / ${alpha})`) : color
}

export type PhaseBackdropProps = {
  /** Current player phase — selects the hue and the `data-phase` value. */
  phase: PlayerPhase
  /** When paused, the tint desaturates (the workout is on hold, not live). */
  paused?: boolean
}

/**
 * Full-bleed radial phase tint for the immersive player. The hue comes from the
 * {@link PHASE_HUE} map only (exposed to CSS as `--phase-hue`); the slow
 * breathing pulse and its `prefers-reduced-motion` suppression live in
 * `index.css` on `.player-phase-backdrop`. The element also registers as a
 * scene proxy (via {@link useSceneSurface}), so glass surfaces stacked above it
 * refract the current phase tint. `paused` desaturates the tint in place.
 */
export function PhaseBackdrop(props: PhaseBackdropProps): JSX.Element {
  const { phase, paused = false } = props
  const ref = useRef<HTMLDivElement>(null)

  // Behind everything else in the scene; the concrete colour is resolved from
  // the token so the canvas fill is a valid `fillStyle`. Registered at
  // backdrop strength (alpha over the scene base), not the raw token —
  // refract-tier glass above would otherwise paint a fully saturated slab
  // instead of the muted tint actually on screen.
  useSceneSurface(ref, { color: withAlpha(resolvePhaseHue(phase), 0.25), z: -50 })

  const style: CSSProperties & Record<'--phase-hue', string> = {
    '--phase-hue': PHASE_HUE[phase],
    ...(paused ? { filter: 'saturate(0.35)' } : {}),
  }

  return (
    <div
      ref={ref}
      data-testid="player-phase-backdrop"
      data-phase={phase}
      data-paused={paused ? 'true' : 'false'}
      aria-hidden="true"
      // -z-[1] (not lower): the glass scene backdrop is an opaque z-index -1
      // element prepended to <body>; this element sits later in tree order at
      // the same z, so it paints above that backdrop yet behind all content.
      className={cn('player-phase-backdrop pointer-events-none fixed inset-0 -z-[1]')}
      style={style}
    />
  )
}
