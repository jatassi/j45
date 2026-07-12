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
    expect(running.style.filter).not.toContain('saturate')

    rerender(<PhaseBackdrop phase="work" paused />)
    const paused = screen.getByTestId('player-phase-backdrop')
    expect(paused.dataset.paused).toBe('true')
    expect(paused.style.filter).toContain('saturate')
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
