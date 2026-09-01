// @vitest-environment jsdom
import { SessionId, TimerRunning } from '@j45/domain'
import { cleanup, screen } from '@testing-library/react'
import * as Schema from 'effect/Schema'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { makeState, renderLive } from './session-harness'

vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }),
}))

vi.mock('@/player/audio', () => ({
  audioState: vi.fn(() => 'on'),
  unlockAudio: vi.fn(() => 'on'),
  beepWork: vi.fn(),
  beepRest: vi.fn(),
  beepReady: vi.fn(),
  beepDone: vi.fn(),
  beepCountdown: vi.fn(),
}))

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

/**
 * The Progress strip on the live screen: the bars, their cells and the round
 * dots, and the context line it replaces.
 *
 * Every rule behind the states is proved against the pure derivation in
 * `progress-strip.test.ts`. These tests prove only that the screen renders
 * what the derivation returns, and that the strip holds the shape the
 * participant needs: one height, a fixed dot row, and no tap.
 *
 * The harness fixture is one pod of two stations over two laps, so the strip
 * is one pod bar of two cells above two round dots.
 */

/** The fixture at the first work: round 1, station 1. */
const atFirstWork = (id: string) => {
  const sessionId = Schema.decodeSync(SessionId)(id)
  const now = Date.now()
  return makeState(
    sessionId,
    new TimerRunning({ segmentIndex: 1, endsAtMillis: now + 30_000 }),
    now,
  )
}

describe('SessionScreen — the Progress strip', () => {
  it('renders the bars, their cells and the round dots, and no context line', async () => {
    renderLive('sess-strip', atFirstWork('sess-strip'))

    await screen.findByTestId('session-screen')
    // The pod/lap/station line is gone; the strip says the same in marks.
    expect(screen.queryByTestId('session-context')).toBeNull()
    expect(screen.getByTestId('session-strip-bar-0').dataset.state).toBe('active')
    expect(screen.getByTestId('session-strip-cell-0-0').dataset.state).toBe('active')
    expect(screen.getByTestId('session-strip-cell-0-1').dataset.state).toBe('upcoming')
    expect(screen.getByTestId('session-strip-dot-0').dataset.state).toBe('active')
    expect(screen.getByTestId('session-strip-dot-1').dataset.state).toBe('upcoming')
    // One pod, so one bar and no second one.
    expect(screen.queryByTestId('session-strip-bar-1')).toBeNull()
  })

  it('reads every mark ahead while the session is getting ready', async () => {
    const sessionId = Schema.decodeSync(SessionId)('sess-strip-ready')
    const now = Date.now()
    // Segment 0 is the `ready` segment: no work is in focus.
    const timer = new TimerRunning({ segmentIndex: 0, endsAtMillis: now + 5000 })
    renderLive('sess-strip-ready', makeState(sessionId, timer, now))

    await screen.findByTestId('session-screen')
    const marks = screen
      .getByTestId('session-progress')
      .querySelectorAll<HTMLElement>('[data-state]')
    expect(marks.length).toBeGreaterThan(0)
    for (const mark of marks) {
      expect(mark.dataset.state).toBe('upcoming')
    }
  })

  it('ignores taps on the strip', async () => {
    renderLive('sess-strip-inert', atFirstWork('sess-strip-inert'))

    await screen.findByTestId('session-screen')
    // Nothing on the strip can take a tap: no control, no link, no focus stop.
    const strip = screen.getByTestId('session-progress')
    expect(strip.querySelectorAll('button, a, input, [role="button"], [tabindex]')).toHaveLength(0)
  })

  it('keeps the dot row out of the bars, so it never moves under the active bar', async () => {
    renderLive('sess-strip-rows', atFirstWork('sess-strip-rows'))

    await screen.findByTestId('session-screen')
    const bars = screen.getByTestId('session-strip-bars')
    const dots = screen.getByTestId('session-strip-dots')
    // The dots are the bars' sibling, never a bar's child, so no bar's width
    // or state can shift them.
    expect(bars.contains(dots)).toBe(false)
    expect(dots.parentElement).toBe(bars.parentElement)
    expect(screen.getByTestId('session-strip-dot-0').parentElement).toBe(dots)
  })
})
