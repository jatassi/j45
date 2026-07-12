import type { CSSProperties, JSX } from 'react'
import { useRef } from 'react'

import { useSceneSurface } from '@/glass/use-scene-surface'
import { cn } from '@/lib/utils'

import type { PlayerPhase } from './phase'
import { PHASE_HUE, resolvePhaseHue } from './phase'

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
  // the token so the canvas fill is a valid `fillStyle`.
  useSceneSurface(ref, { color: resolvePhaseHue(phase), z: -50 })

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
      className={cn('player-phase-backdrop pointer-events-none fixed inset-0 -z-10')}
      style={style}
    />
  )
}
