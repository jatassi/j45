/**
 * The immersive player's phase vocabulary. One `PlayerPhase` and one
 * phase-to-hue map — every player component tints from this map, never from a
 * hand-rolled hex literal, so backdrop, ring, and dock stay in one voice.
 *
 * The hues are the design tokens in `src/index.css`: work → `--hue-work`
 * (green), rest → `--hue-rest` (amber), ready/countdown-in → `--hue-cardio`
 * (sky), and done → the signature orange `--primary`.
 */

export type PlayerPhase = 'ready' | 'work' | 'rest' | 'done'

/** Phase → the CSS `var(...)` reference for its hue. The single source of truth. */
export const PHASE_HUE: Record<PlayerPhase, string> = {
  ready: 'var(--hue-cardio)',
  work: 'var(--hue-work)',
  rest: 'var(--hue-rest)',
  done: 'var(--primary)',
}

/**
 * Resolve a phase hue to a concrete colour for canvas painting (a `var(...)`
 * reference is not a valid `fillStyle`). Reads the design token's computed
 * value off `:root`; falls back to the `var(...)` reference when no document is
 * available (e.g. SSR / unit-test environments), which callers only feed to a
 * mocked registry.
 */
export function resolvePhaseHue(phase: PlayerPhase): string {
  const expr = PHASE_HUE[phase]
  if (typeof document !== 'undefined') {
    const token = /var\((--[\w-]+)\)/.exec(expr)?.[1]
    if (token) {
      const resolved = getComputedStyle(document.documentElement).getPropertyValue(token).trim()
      if (resolved) {
        return resolved
      }
    }
  }
  return expr
}
