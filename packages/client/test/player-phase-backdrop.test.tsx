// @vitest-environment jsdom
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { PHASE_HUE } from '@/components/player/phase'
import { PhaseBackdrop } from '@/components/player/phase-backdrop'
import type { SceneProxyHandle } from '@/glass/scene'
import { sceneRegistry } from '@/glass/scene'

const indexCssPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '../src/index.css')

function handle(): SceneProxyHandle {
  return { update: vi.fn(), invalidate: vi.fn(), dispose: vi.fn() }
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('PhaseBackdrop — phase-to-hue attribute wiring', () => {
  it('maps every PlayerPhase to its design-token hue (no per-component hex)', () => {
    expect(PHASE_HUE).toEqual({
      ready: 'var(--hue-cardio)',
      work: 'var(--hue-work)',
      rest: 'var(--hue-rest)',
      done: 'var(--primary)',
    })
  })

  it('reflects the phase in data-phase and styles the tint from the hue map only', () => {
    vi.spyOn(sceneRegistry, 'register').mockReturnValue(handle())

    render(<PhaseBackdrop phase="work" />)
    const el = screen.getByTestId('player-phase-backdrop')

    expect(el.dataset.phase).toBe('work')
    expect(el.style.getPropertyValue('--phase-hue')).toBe(PHASE_HUE.work)
  })

  it('registers as a scene proxy so glass above it refracts the tint', () => {
    const register = vi.spyOn(sceneRegistry, 'register').mockReturnValue(handle())

    render(<PhaseBackdrop phase="rest" />)

    expect(register).toHaveBeenCalledTimes(1)
    const proxy = register.mock.calls.at(0)?.[0]
    expect(proxy).toBeDefined()
    expect(proxy?.source).toBe(screen.getByTestId('player-phase-backdrop'))
  })
})

describe('PhaseBackdrop — paused modifier', () => {
  it('desaturates the tint and flags data-paused when paused', () => {
    vi.spyOn(sceneRegistry, 'register').mockReturnValue(handle())

    const { rerender } = render(<PhaseBackdrop phase="work" />)
    const running = screen.getByTestId('player-phase-backdrop')
    expect(running.dataset.paused).toBe('false')
    // No filter at all while running: `none` ↔ `saturate(0.35)` interpolates
    // on its own, so the pause transition needs no identity filter held on
    // the largest layer of the screen for the whole of a workout.
    expect(running.style.filter).toBe('')

    rerender(<PhaseBackdrop phase="work" paused />)
    const paused = screen.getByTestId('player-phase-backdrop')
    expect(paused.dataset.paused).toBe('true')
    expect(paused.style.filter).toBe('saturate(0.35)')
  })
})

describe('PhaseBackdrop — CSS-only pulse', () => {
  it('adds slow-pulse keyframes to index.css, suppressed under prefers-reduced-motion', () => {
    const css = fs.readFileSync(indexCssPath, 'utf8')
    expect(css).toMatch(/@keyframes\s+player-phase-pulse\s*\{/)
    const reducedAt = css.search(/@media\s*\(prefers-reduced-motion:\s*reduce\)/)
    expect(reducedAt).toBeGreaterThanOrEqual(0)
    expect(css.slice(reducedAt)).toContain('player-phase-backdrop')
  })
})

/**
 * `@property --phase-hue` carries the `ready` hue as a literal, because
 * `initial-value` may not contain `var()`. Nothing in CSS keeps that literal
 * in step with the `--hue-cardio` token it copies, and nothing at runtime can:
 * jsdom does not implement `@property`, so no rendering test sees the
 * registration at all. Drift shows up only as a one-frame flash of a stale
 * colour on the first paint of every workout — which is why the two are
 * compared here, as text, rather than left to a reviewer to notice.
 */
describe('PhaseBackdrop — the registered hue keeps its initial value in step', () => {
  it('registers --phase-hue with the literal value of the --hue-cardio token', () => {
    const css = fs.readFileSync(indexCssPath, 'utf8')

    const registration = /@property\s+--phase-hue\s*\{([^}]*)\}/.exec(css)?.[1]
    expect(registration, '@property --phase-hue is missing from index.css').toBeDefined()
    const initialValue = /initial-value:\s*([^;]+);/.exec(registration ?? '')?.[1].trim()
    expect(initialValue, '@property --phase-hue has no initial-value').toBeDefined()

    // The `ready` phase the player starts in — see PHASE_HUE in player/phase.ts.
    expect(PHASE_HUE.ready).toBe('var(--hue-cardio)')
    const token = /--hue-cardio:\s*([^;]+);/.exec(css)?.[1].trim()
    expect(token, '--hue-cardio is missing from index.css').toBeDefined()

    expect(initialValue).toBe(token)
  })
})
