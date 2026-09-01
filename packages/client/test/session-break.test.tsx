// @vitest-environment jsdom
import { SessionId, SessionNotFound, TimerRunning } from '@j45/domain'
import type { SessionState } from '@j45/domain'
import { act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import * as Duration from 'effect/Duration'
import * as Effect from 'effect/Effect'
import * as Schema from 'effect/Schema'
import * as Stream from 'effect/Stream'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { RECONNECT_GRACE } from '@/lib/reconnect'

import { liveStream, makeState, renderSession } from './session-harness'

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

/**
 * A break in the connection to the server, seen the way a participant sees
 * it: the workout stays where it was, a break long enough to matter says so,
 * the timer commands stand down, and the exit still works.
 *
 * The grace is real time under this harness's runtime, and the default query
 * timeout is shorter than it, so every wait that spans it names its own.
 */
const graceMillis = Duration.toMillis(RECONNECT_GRACE)
const pastGrace = { timeout: graceMillis + 2000 }

/** A watch that never connects. */
const dropped = () => Stream.fail(new Error('socket dropped'))

/**
 * Records whether an element is ever put on screen over a window of time,
 * rather than at the one moment a query runs. Something that appeared and
 * then cleared itself would be gone again before any assertion could see it,
 * and "it was never there" is the claim worth proving.
 */
const everAppears = (testId: string): (() => boolean) => {
  let appeared = screen.queryByTestId(testId) !== null
  const holds = (node: Node) =>
    node instanceof HTMLElement &&
    (node.dataset.testid === testId || node.querySelector(`[data-testid="${testId}"]`) !== null)
  const observer = new MutationObserver((records) => {
    for (const record of records) {
      appeared ||= [...record.addedNodes].some(holds)
    }
  })
  observer.observe(document.body, { childList: true, subtree: true })
  return () => {
    observer.disconnect()
    return appeared
  }
}

describe('SessionScreen — a break in the connection', () => {
  /** A snapshot mid-work, so the workout is plainly on screen before the break. */
  const runningNow = (id: string) => {
    const sessionId = Schema.decodeSync(SessionId)(id)
    const now = Date.now()
    return makeState(
      sessionId,
      new TimerRunning({ segmentIndex: 1, endsAtMillis: now + 30_000 }),
      now,
    )
  }

  /** A fake screen wake lock, so a remount is observable as a release. */
  const fakeWakeLock = () => {
    const release = vi.fn<() => Promise<void>>(() => Promise.resolve())
    const sentinel = { release, addEventListener: vi.fn<() => void>() }
    const request = vi.fn<() => Promise<typeof sentinel>>(() => Promise.resolve(sentinel))
    Object.defineProperty(navigator, 'wakeLock', { value: { request }, configurable: true })
    return { request, release }
  }

  /**
   * A watch that delivers `state` once and then drops. Every retry after it
   * drops too, so the break lasts.
   */
  const breaksAfter = (state: SessionState) => {
    let subscriptions = 0
    return () => {
      subscriptions += 1
      return subscriptions === 1 ? Stream.make(state).pipe(Stream.concat(dropped())) : dropped()
    }
  }

  it('keeps the workout on screen, holds the wake lock, and raises the chip', async () => {
    const { request, release } = fakeWakeLock()
    renderSession('sess-break', { WatchSession: breaksAfter(runningNow('sess-break')) })

    await screen.findByTestId('session-screen')
    await waitFor(() => {
      expect(request).toHaveBeenCalledWith('screen')
    })

    await screen.findByTestId('session-reconnecting', {}, pastGrace)

    // The same player element, never remounted: a remount would have
    // released the wake lock and asked for a second one.
    expect(screen.queryByTestId('session-screen')).not.toBeNull()
    expect(release).not.toHaveBeenCalled()
    expect(request).toHaveBeenCalledTimes(1)
    // The screen never claims to be live while it is not.
    expect(screen.getByTestId('session-connection').textContent).toBe('Offline')
    expect(screen.queryByTestId('home-screen')).toBeNull()
  })

  it('a break that heals inside the grace changes nothing on screen', async () => {
    const state = runningNow('sess-blip')
    let subscriptions = 0
    renderSession('sess-blip', {
      WatchSession: () => {
        subscriptions += 1
        return subscriptions === 1
          ? Stream.make(state).pipe(Stream.concat(dropped()))
          : liveStream(state)
      },
    })

    await screen.findByTestId('session-screen')
    const chipAppeared = everAppears('session-reconnecting')
    // The first backoff step lands the retry well inside the grace.
    await waitFor(() => {
      expect(subscriptions).toBe(2)
    })
    // Wait the grace out: a break that healed inside it is never announced.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, graceMillis))
    })

    // Not merely gone by now — never on screen at all.
    expect(chipAppeared()).toBe(false)
    expect(screen.getByTestId('session-connection').textContent).toBe('Live')
    expect(screen.getByTestId('session-pause').hasAttribute('disabled')).toBe(false)
  })

  it('the timer commands stand down while the chip is up, and Leave does not', async () => {
    const id = 'sess-standdown'
    const commands: unknown[] = []
    renderSession(id, {
      WatchSession: breaksAfter(runningNow(id)),
      SendSessionCommand: (payload) => {
        commands.push(payload)
        return Effect.succeed(undefined)
      },
    })

    await screen.findByTestId('session-reconnecting', {}, pastGrace)

    for (const control of ['session-prev', 'session-pause', 'session-skip']) {
      expect(screen.getByTestId(control).hasAttribute('disabled')).toBe(true)
    }
    fireEvent.click(screen.getByTestId('session-pause'))
    expect(commands).toHaveLength(0)

    // The exit is the one control a break does not take away.
    expect(screen.getByTestId('session-leave').hasAttribute('disabled')).toBe(false)
  })

  it('a participant whose LeaveSession fails still goes home', async () => {
    const id = 'sess-leave-offline'
    renderSession(id, {
      WatchSession: () => liveStream(runningNow(id)),
      LeaveSession: () => Effect.fail(new Error('socket dropped')),
    })

    await screen.findByTestId('session-leave')
    fireEvent.click(screen.getByTestId('session-leave'))
    fireEvent.click(await screen.findByTestId('session-leave-confirm'))

    await screen.findByTestId('home-screen')
  })

  it('an ending the retry finds still sends them home, from under the chip', async () => {
    const id = 'sess-gone-while-away'
    const sessionId = Schema.decodeSync(SessionId)(id)
    let subscriptions = 0
    const router = renderSession(id, {
      WatchSession: () => {
        subscriptions += 1
        if (subscriptions === 1) {
          return Stream.make(runningNow(id)).pipe(Stream.concat(dropped()))
        }
        // The break outlasts the grace, so the ending has to travel out from
        // under a chip that is already up — the retry's own path, not the
        // first subscription's.
        return subscriptions === 2
          ? dropped()
          : Stream.fail(new SessionNotFound({ id: sessionId, endedAs: 'plan-deleted' }))
      },
    })

    await screen.findByTestId('session-reconnecting', {}, pastGrace)
    await screen.findByTestId('home-screen', {}, pastGrace)
    expect(router.state.location.search).toEqual({ notice: 'plan-deleted' })
  })
})
