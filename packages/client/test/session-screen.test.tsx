// @vitest-environment jsdom
import { SessionId, SessionNotFound, TimerDone, TimerPaused, TimerRunning } from '@j45/domain'
import type { SessionState, TimerState } from '@j45/domain'
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import * as Effect from 'effect/Effect'
import * as Queue from 'effect/Queue'
import * as Schema from 'effect/Schema'
import * as Stream from 'effect/Stream'
import { afterEach, describe, expect, it, vi } from 'vitest'

import * as audio from '@/player/audio'

import {
  liveStream,
  makeState,
  push,
  renderLive,
  renderSession,
  withEnded,
} from './session-harness'

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
  Reflect.deleteProperty(navigator, 'wakeLock')
})

describe('SessionScreen — stream retry discrimination', () => {
  it('SessionNotFound stops retrying and navigates home', async () => {
    const id = 'sess-not-found'
    const sessionId = Schema.decodeSync(SessionId)(id)
    const router = renderSession(id, {
      WatchSession: () => Stream.fail(new SessionNotFound({ id: sessionId, endedAs: null })),
    })

    await screen.findByTestId('home-screen')
    expect(router.state.location.pathname).toBe('/')
  })

  it('a transport failure shows the reconnecting indicator and retries with backoff', async () => {
    const id = 'sess-transport'
    renderSession(id, {
      WatchSession: () => Stream.fail(new Error('socket dropped')),
    })

    await screen.findByTestId('session-reconnecting')
    expect(screen.queryByTestId('home-screen')).toBeNull()
  })
})

describe('SessionScreen — where an ended session sends its people', () => {
  /** A snapshot mid-work, so the session is plainly live before it ends. */
  const runningNow = (id: string) => {
    const sessionId = Schema.decodeSync(SessionId)(id)
    const now = Date.now()
    return makeState(
      sessionId,
      new TimerRunning({ segmentIndex: 1, endsAtMillis: now + 30_000 }),
      now,
    )
  }

  it('a deleted plan sends them home with the notice that says so', async () => {
    const id = 'sess-deleted'
    const queue = Effect.runSync(Queue.unbounded<SessionState>())
    const router = renderSession(id, { WatchSession: () => Stream.fromQueue(queue) })

    await push(queue, runningNow(id))
    await screen.findByTestId('session-screen')

    // The last snapshot the server publishes for a deleted plan.
    await push(queue, withEnded(runningNow(id), 'plan-deleted'))

    await screen.findByTestId('home-screen')
    expect(router.state.location.pathname).toBe('/')
    expect(router.state.location.search).toEqual({ notice: 'plan-deleted' })
  })

  it('any other ending sends them home with the ordinary notice', async () => {
    const id = 'sess-closed'
    const queue = Effect.runSync(Queue.unbounded<SessionState>())
    const router = renderSession(id, { WatchSession: () => Stream.fromQueue(queue) })

    await push(queue, runningNow(id))
    await screen.findByTestId('session-screen')

    await push(queue, withEnded(runningNow(id), 'closed'))

    await screen.findByTestId('home-screen')
    expect(router.state.location.search).toEqual({ notice: 'session-ended' })
  })

  it('a session that is simply gone reads as an ordinary ending', async () => {
    const id = 'sess-vanished'
    const sessionId = Schema.decodeSync(SessionId)(id)
    const router = renderSession(id, {
      WatchSession: () => Stream.fail(new SessionNotFound({ id: sessionId, endedAs: null })),
    })

    await screen.findByTestId('home-screen')
    expect(router.state.location.search).toEqual({ notice: 'session-ended' })
  })

  it('a reconnect that finds a deleted plan still gets the notice that says so', async () => {
    // The participant was disconnected when the host deleted the workout, so
    // they never received the session's last snapshot. The retried watch
    // finds nothing — and the server still says why.
    const id = 'sess-deleted-while-away'
    const sessionId = Schema.decodeSync(SessionId)(id)
    const router = renderSession(id, {
      WatchSession: () =>
        Stream.fail(new SessionNotFound({ id: sessionId, endedAs: 'plan-deleted' })),
    })

    await screen.findByTestId('home-screen')
    expect(router.state.location.search).toEqual({ notice: 'plan-deleted' })
  })

  it('a reconnect that finds an ordinary close reads as one', async () => {
    const id = 'sess-closed-while-away'
    const sessionId = Schema.decodeSync(SessionId)(id)
    const router = renderSession(id, {
      WatchSession: () => Stream.fail(new SessionNotFound({ id: sessionId, endedAs: 'closed' })),
    })

    await screen.findByTestId('home-screen')
    expect(router.state.location.search).toEqual({ notice: 'session-ended' })
  })
})

describe('SessionScreen — server-state render', () => {
  it('renders phase, exercise, station detail, next-up, and participants', async () => {
    const id = 'sess-render'
    const sessionId = Schema.decodeSync(SessionId)(id)
    const now = Date.now()
    const timer = new TimerRunning({ segmentIndex: 1, endsAtMillis: now + 30_000 })
    renderLive(id, makeState(sessionId, timer, now))

    await screen.findByTestId('session-screen')
    expect(screen.getByTestId('session-phase').textContent).toBe('Work')
    expect(screen.getByTestId('session-exercise-name').textContent).toBe('Rower')
    expect(screen.getByTestId('session-exercise-detail').textContent).toBe('10 cal')
    expect(screen.getByTestId('session-next-up').textContent).toContain('Burpee')
    expect(screen.getByTestId('session-participant-u-ann').textContent).toContain('Ann')
    expect(screen.getByTestId('session-participant-u-ben').textContent).toContain('Ben')
  })

  it('carries data-phase on the session root matching the current segment/timer state', async () => {
    const id = 'sess-phase'
    const sessionId = Schema.decodeSync(SessionId)(id)
    const now = Date.now()
    const cases: readonly (readonly [TimerState, string])[] = [
      [new TimerRunning({ segmentIndex: 0, endsAtMillis: now + 5000 }), 'ready'],
      [new TimerRunning({ segmentIndex: 1, endsAtMillis: now + 30_000 }), 'work'],
      [new TimerRunning({ segmentIndex: 2, endsAtMillis: now + 10_000 }), 'rest'],
      [new TimerDone({}), 'done'],
    ]
    for (const [timer, phase] of cases) {
      renderLive(`${id}-${phase}`, makeState(sessionId, timer, now))
      await screen.findByTestId('session-screen')
      expect(screen.getByTestId('session-screen').dataset.phase).toBe(phase)
      cleanup()
    }
  })

  it('a paused timer reads Paused in session-phase while keeping the segment data-phase', async () => {
    const id = 'sess-paused'
    const sessionId = Schema.decodeSync(SessionId)(id)
    const timer = new TimerPaused({ segmentIndex: 1, remainingMillis: 18_000 })
    renderLive(id, makeState(sessionId, timer, Date.now()))

    await screen.findByTestId('session-screen')
    expect(screen.getByTestId('session-phase').textContent).toBe('Paused')
    expect(screen.getByTestId('session-screen').dataset.phase).toBe('work')
    // The count freezes on the paused remainder (18s → 0:18), never ticking.
    expect(screen.getByTestId('session-count').textContent).toBe('0:18')
    // The ring's glass proxy repaints this element, so it has to be the one
    // marked: unmarked, the refraction falls back to the whole ring box and
    // shows the count at a size the participant never sees.
    expect(Object.hasOwn(screen.getByTestId('session-count').dataset, 'ringDigits')).toBe(true)
  })

  it('omits the station-detail line when the exercise has no detail', async () => {
    const id = 'sess-no-detail'
    const sessionId = Schema.decodeSync(SessionId)(id)
    // Segment 3 is work Br1 — Burpee, which carries no `detail`.
    const timer = new TimerRunning({ segmentIndex: 3, endsAtMillis: Date.now() + 30_000 })
    renderLive(id, makeState(sessionId, timer, Date.now()))

    await screen.findByTestId('session-screen')
    expect(screen.getByTestId('session-exercise-name').textContent).toBe('Burpee')
    expect(screen.queryByTestId('session-exercise-detail')).toBeNull()
  })

  it('counts down against the server clock offset, never the raw phone clock', async () => {
    const id = 'sess-offset'
    const sessionId = Schema.decodeSync(SessionId)(id)
    // Server is 4000s ahead of this phone. The raw phone delta would read
    // 67:20; only applying (clientNow − serverNow) yields the true 0:40.
    const serverNow = Date.now() + 4_000_000
    const timer = new TimerRunning({ segmentIndex: 1, endsAtMillis: serverNow + 40_000 })
    renderLive(id, makeState(sessionId, timer, serverNow))

    await screen.findByTestId('session-count')
    expect(screen.getByTestId('session-count').textContent).toBe('0:40')
  })
})

describe('SessionScreen — controls', () => {
  it('Pause sends SendSessionCommand with the pause command', async () => {
    const id = 'sess-pause'
    const sessionId = Schema.decodeSync(SessionId)(id)
    const commands: unknown[] = []
    const timer = new TimerRunning({ segmentIndex: 1, endsAtMillis: Date.now() + 30_000 })
    renderSession(id, {
      WatchSession: () => liveStream(makeState(sessionId, timer, Date.now())),
      SendSessionCommand: (payload) => {
        commands.push(payload)
        return Effect.succeed(undefined)
      },
    })

    await screen.findByTestId('session-pause')
    fireEvent.click(screen.getByTestId('session-pause'))

    await waitFor(() => {
      expect(commands).toContainEqual({ id: sessionId, command: 'pause' })
    })
  })

  it('the done state shows Finish, which leaves the session with no confirm dialog', async () => {
    const id = 'sess-done'
    const sessionId = Schema.decodeSync(SessionId)(id)
    const leaves: unknown[] = []
    renderSession(id, {
      WatchSession: () => liveStream(makeState(sessionId, new TimerDone({}), Date.now())),
      LeaveSession: (payload) => {
        leaves.push(payload)
        return Effect.succeed(undefined)
      },
    })

    await screen.findByTestId('session-finish')
    fireEvent.click(screen.getByTestId('session-finish'))

    // No dialog stands between Finish and the leave — it fires directly.
    expect(screen.queryByTestId('session-leave-confirm')).toBeNull()
    await waitFor(() => {
      expect(leaves).toContainEqual({ id: sessionId })
    })
  })

  it('the Leave control opens a confirm dialog and only its confirm leaves the session', async () => {
    const id = 'sess-leave'
    const sessionId = Schema.decodeSync(SessionId)(id)
    const leaves: unknown[] = []
    const timer = new TimerRunning({ segmentIndex: 1, endsAtMillis: Date.now() + 30_000 })
    renderSession(id, {
      WatchSession: () => liveStream(makeState(sessionId, timer, Date.now())),
      LeaveSession: (payload) => {
        leaves.push(payload)
        return Effect.succeed(undefined)
      },
    })

    await screen.findByTestId('session-leave')
    // The bare Leave tap opens the dialog but must not leave on its own.
    expect(screen.queryByTestId('session-leave-confirm')).toBeNull()
    fireEvent.click(screen.getByTestId('session-leave'))

    const confirm = await screen.findByTestId('session-leave-confirm')
    expect(leaves).toHaveLength(0)

    fireEvent.click(confirm)
    await waitFor(() => {
      expect(leaves).toContainEqual({ id: sessionId })
    })
  })
})

describe('SessionScreen — cues, audio, and wake lock', () => {
  it('beeps the work tone on the transition into a work segment and surfaces data-audio', async () => {
    const id = 'sess-beep'
    const sessionId = Schema.decodeSync(SessionId)(id)
    const queue = Effect.runSync(Queue.unbounded<SessionState>())
    renderSession(id, { WatchSession: () => Stream.fromQueue(queue) })

    // Enter the get-ready segment first, then transition into work.
    await push(
      queue,
      makeState(
        sessionId,
        new TimerRunning({ segmentIndex: 0, endsAtMillis: Date.now() + 5000 }),
        Date.now(),
      ),
    )
    await screen.findByTestId('session-screen')
    expect(audio.beepWork).not.toHaveBeenCalled()

    await push(
      queue,
      makeState(
        sessionId,
        new TimerRunning({ segmentIndex: 1, endsAtMillis: Date.now() + 30_000 }),
        Date.now(),
      ),
    )

    await waitFor(() => {
      expect(audio.beepWork).toHaveBeenCalled()
    })
    expect(screen.getByTestId('session-audio-indicator').dataset.audio).toBe('on')

    fireEvent.click(screen.getByTestId('session-audio-indicator'))
    expect(audio.unlockAudio).toHaveBeenCalled()
  })

  it('holds a wake lock while running and releases it when the session pauses', async () => {
    const id = 'sess-wake'
    const sessionId = Schema.decodeSync(SessionId)(id)
    const release = vi.fn<() => Promise<void>>(() => Promise.resolve())
    const sentinel = { release, addEventListener: vi.fn<() => void>() }
    const request = vi.fn<() => Promise<typeof sentinel>>(() => Promise.resolve(sentinel))
    Object.defineProperty(navigator, 'wakeLock', { value: { request }, configurable: true })

    const queue = Effect.runSync(Queue.unbounded<SessionState>())
    renderSession(id, { WatchSession: () => Stream.fromQueue(queue) })

    await push(
      queue,
      makeState(
        sessionId,
        new TimerRunning({ segmentIndex: 1, endsAtMillis: Date.now() + 30_000 }),
        Date.now(),
      ),
    )
    await waitFor(() => {
      expect(request).toHaveBeenCalledWith('screen')
    })

    await push(
      queue,
      makeState(
        sessionId,
        new TimerPaused({ segmentIndex: 1, remainingMillis: 20_000 }),
        Date.now(),
      ),
    )
    await waitFor(() => {
      expect(release).toHaveBeenCalled()
    })
  })
})
