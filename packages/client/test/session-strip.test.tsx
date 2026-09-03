// @vitest-environment jsdom
import {
  compile,
  Flow,
  Pod,
  Round,
  SessionId,
  Station,
  TimerDone,
  TimerRunning,
  Workout,
} from '@j45/domain'
import { cleanup, render, screen } from '@testing-library/react'
import * as Schema from 'effect/Schema'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ProgressStrip } from '@/components/player/progress-strip'
import { progressStrip } from '@/lib/session'

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
 * The Progress strip on the live screen: the pods, their works and the marks
 * that stand in for works a pod gave up.
 *
 * Every rule behind the layout, the modes and the states is proved against
 * the pure derivation in `progress-strip.test.ts`. These tests prove only
 * that the screen draws what the derivation returns, and that the strip holds
 * the shape the participant needs: one row, one height, and no tap.
 *
 * The harness fixture is one pod of two stations over two laps: one pod, two
 * runs, four works.
 */

/** The fixture at the first work: lap 1, station 1. */
const atFirstWork = (id: string) => {
  const sessionId = Schema.decodeSync(SessionId)(id)
  const now = Date.now()
  return makeState(
    sessionId,
    new TimerRunning({ segmentIndex: 1, endsAtMillis: now + 30_000 }),
    now,
  )
}

/** The same fixture at the last work: lap 2, station 2. */
const atLastWork = (id: string) => {
  const sessionId = Schema.decodeSync(SessionId)(id)
  const now = Date.now()
  return makeState(
    sessionId,
    new TimerRunning({ segmentIndex: 7, endsAtMillis: now + 30_000 }),
    now,
  )
}

/** Every mark on the strip: a dot, a cell or a pill. */
const marks = () =>
  screen.getByTestId('session-progress').querySelectorAll<HTMLElement>('[data-state]')

describe('SessionScreen — the Progress strip', () => {
  it('draws the session as pods and their works, and no context line', async () => {
    renderLive('sess-strip', atFirstWork('sess-strip'))

    await screen.findByTestId('session-screen')
    // The pod/lap/station line is gone; the strip says the same in marks.
    expect(screen.queryByTestId('session-context')).toBeNull()

    // The fixture is small, so every pod keeps its dots: the open layout.
    expect(screen.getByTestId('session-progress').dataset.layout).toBe('open')

    // One pod, so one pod and no second one.
    const pod = screen.getByTestId('session-strip-pod-0')
    expect(screen.queryByTestId('session-strip-pod-1')).toBeNull()
    expect(pod.dataset.state).toBe('active')
    expect(pod.dataset.mode).toBe('dots')

    // Four works: two stations over two laps, the first one running now.
    expect(screen.getByTestId('session-strip-work-0-0').dataset.state).toBe('active')
    expect(screen.getByTestId('session-strip-work-0-1').dataset.state).toBe('upcoming')
    expect(screen.getByTestId('session-strip-work-0-3').dataset.state).toBe('upcoming')
    expect(screen.queryByTestId('session-strip-work-0-4')).toBeNull()
    // A pod that keeps its dots draws no cell and no pill.
    expect(screen.queryByTestId('session-strip-cell-0-0')).toBeNull()
  })

  it('pulses the work that is now, and nothing else', async () => {
    renderLive('sess-strip-pulse', atFirstWork('sess-strip-pulse'))

    await screen.findByTestId('session-screen')
    const pulsing = screen
      .getByTestId('session-progress')
      .querySelectorAll<HTMLElement>('.player-dot-pulse')
    // The dot is the leaf, and the leaf is the only mark that moves.
    expect(pulsing).toHaveLength(1)
    expect(pulsing[0]?.dataset.testid).toBe('session-strip-work-0-0')
  })

  it('reads every mark ahead while the session is getting ready', async () => {
    const sessionId = Schema.decodeSync(SessionId)('sess-strip-ready')
    const now = Date.now()
    // Segment 0 is the `ready` segment: no work is in focus.
    const timer = new TimerRunning({ segmentIndex: 0, endsAtMillis: now + 5000 })
    renderLive('sess-strip-ready', makeState(sessionId, timer, now))

    await screen.findByTestId('session-screen')
    const found = marks()
    expect(found.length).toBeGreaterThan(0)
    for (const mark of found) {
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

  it('keeps one height for the session, wherever the current work is', async () => {
    renderLive('sess-strip-height', atFirstWork('sess-strip-height'))
    await screen.findByTestId('session-screen')
    const first = screen.getByTestId('session-strip-pod-0').style.height

    cleanup()

    renderLive('sess-strip-height-last', atLastWork('sess-strip-height-last'))
    await screen.findByTestId('session-screen')
    const last = screen.getByTestId('session-strip-pod-0').style.height

    // The height is the dot cap, the gap and the track, and it never follows
    // the dot size, the mode or the work in focus.
    expect(first).toBe('14px')
    expect(last).toBe(first)
  })

  it('reads every mark done when the session is done', async () => {
    const sessionId = Schema.decodeSync(SessionId)('sess-strip-done')
    renderLive('sess-strip-done', makeState(sessionId, new TimerDone({}), Date.now()))

    await screen.findByTestId('session-screen')
    const found = marks()
    expect(found.length).toBeGreaterThan(0)
    // A done session holds no work in focus, and that alone reads the same as
    // a session that never started. The finish has to say the workout ran.
    for (const mark of found) {
      expect(mark.dataset.state).toBe('done')
    }
    // Nothing pulses at the finish: there is no work to be in.
    expect(
      screen.getByTestId('session-progress').querySelectorAll('.player-dot-pulse'),
    ).toHaveLength(0)
  })

  it('closes the pods it is not in to pills, on a plan too big to open', () => {
    // Four pods of eight stations over three laps: 96 works, far past what the
    // open floor affords, so the derivation falls to focus.
    const plan = compile(
      new Workout({
        name: 'Oversize',
        focus: 'strength',
        pods: Array.from(
          { length: 4 },
          (_, pod) =>
            new Pod({
              name: `Pod ${pod + 1}`,
              stations: Array.from(
                { length: 8 },
                (_, station) => new Station({ name: `S${station + 1}` }),
              ) as [Station, ...Station[]],
            }),
        ) as [Pod, ...Pod[]],
        flow: new Flow({
          type: 'laps',
          rounds: Array.from(
            { length: 3 },
            () => new Round({ workSeconds: 30, restSeconds: 10 }),
          ) as [Round, ...Round[]],
        }),
      }),
    )
    render(<ProgressStrip strip={progressStrip(plan, 0)} />)

    expect(screen.getByTestId('session-progress').dataset.layout).toBe('focus')
    // The pod that holds the current work keeps its own marks; the three it is
    // not in close to pills, so the participant counts pods without counting
    // their works.
    expect(screen.getByTestId('session-strip-pod-0').dataset.mode).not.toBe('pill')
    for (const pod of [1, 2, 3]) {
      const closed = screen.getByTestId(`session-strip-pod-${pod}`)
      expect(closed.dataset.mode).toBe('pill')
      expect(closed.dataset.state).toBe('upcoming')
      // A pill gave its works up: it carries no work mark and no cell.
      expect(screen.queryByTestId(`session-strip-work-${pod}-0`)).toBeNull()
      expect(screen.queryByTestId(`session-strip-cell-${pod}-0`)).toBeNull()
    }
  })
})
