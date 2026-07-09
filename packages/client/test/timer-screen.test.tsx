// @vitest-environment jsdom
import { RegistryProvider, Result } from '@effect-atom/atom-react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import * as Effect from 'effect/Effect'
import * as Runtime from 'effect/Runtime'
import { afterEach, describe, expect, it, vi } from 'vitest'

import App from '@/app'
import { TimerScreen } from '@/components/timer-screen'
import { ServerRpcClient } from '@/lib/rpc-client'
import * as audio from '@/player/audio'
import { router } from '@/router'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  Reflect.deleteProperty(navigator, 'wakeLock')
})

/** Fake rpc runtime — the shared idiom from `library-screen.test.tsx`. */
function makeFakeRuntime(
  handlers: Partial<Record<string, (payload: unknown) => Effect.Effect<unknown, unknown>>>,
) {
  const client = (tag: string, payload: unknown) => {
    const handler = handlers[tag]
    if (handler === undefined) {
      throw new Error(`unexpected rpc call: ${tag}`)
    }
    return handler(payload)
  }
  return Runtime.defaultRuntime.pipe(Runtime.provideService(ServerRpcClient, client as never))
}

/** Advance the fake clock by `ms`, flushing rAF callbacks and pending promises. */
async function advance(ms: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}

function setInputs(work: string, rest: string, rounds: string): void {
  fireEvent.change(screen.getByTestId('work-input'), { target: { value: work } })
  fireEvent.change(screen.getByTestId('rest-input'), { target: { value: rest } })
  fireEvent.change(screen.getByTestId('rounds-input'), { target: { value: rounds } })
}

describe('TimerScreen — inputs and the domain-driven run', () => {
  it('renders the three inputs at their legacy defaults (40/20/9) with the right minimums and the Start control', () => {
    render(<TimerScreen />)

    const work = screen.getByTestId('work-input')
    const rest = screen.getByTestId('rest-input')
    const rounds = screen.getByTestId('rounds-input')

    expect(work.getAttribute('value')).toBe('40')
    expect(rest.getAttribute('value')).toBe('20')
    expect(rounds.getAttribute('value')).toBe('9')
    expect(work.getAttribute('min')).toBe('5')
    expect(rest.getAttribute('min')).toBe('0')
    expect(rounds.getAttribute('min')).toBe('1')

    expect(screen.getByTestId('start-button')).toBeTruthy()
    expect(screen.getByTestId('timer-context').textContent).toBe('9 rounds · 40″/20″')
  })

  it('Start compiles the synthetic workout and drives ready → work → work → Done, the round indicator advancing, via a Date.now()-recomputed timeout', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000_000)

    render(<TimerScreen />)
    setInputs('5', '0', '2')
    fireEvent.click(screen.getByTestId('start-button'))

    // ready segment: Get ready, 5s, the settings summary as context.
    expect(screen.getByTestId('timer-phase').textContent).toBe('Get ready')
    expect(screen.getByTestId('timer-count').textContent).toBe('0:05')
    expect(screen.getByTestId('timer-context').textContent).toBe('2 rounds · 5″/0″')

    // ready → first work.
    await advance(5000)
    expect(screen.getByTestId('timer-phase').textContent).toBe('Work')
    expect(screen.getByTestId('timer-context').textContent).toBe('Round 1 of 2')
    expect(screen.getByTestId('timer-count').textContent).toBe('0:05')

    // rest is 0, so work advances straight into the second work.
    await advance(5000)
    expect(screen.getByTestId('timer-phase').textContent).toBe('Work')
    expect(screen.getByTestId('timer-context').textContent).toBe('Round 2 of 2')

    // second work → Done.
    await advance(5000)
    expect(screen.getByTestId('timer-phase').textContent).toBe('Done')
    expect(screen.getByTestId('timer-count').textContent).toBe('0:00')
    expect(screen.getByTestId('timer-context').textContent).toBe('Nice work')
  })

  it('Pause freezes the displayed count, Resume continues the run, and Reset returns to the idle input state', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000_000)

    render(<TimerScreen />)
    setInputs('5', '0', '2')
    fireEvent.click(screen.getByTestId('start-button'))

    // Into the first work segment, then 2s in.
    await advance(5000)
    await advance(2000)

    fireEvent.click(screen.getByTestId('pause-button'))
    // Frozen at the domain-exact remaining (5000 − 2000 = 3000ms → "0:03").
    expect(screen.getByTestId('timer-count').textContent).toBe('0:03')

    // Time passing while paused never moves the count.
    await advance(4000)
    expect(screen.getByTestId('timer-count').textContent).toBe('0:03')

    fireEvent.click(screen.getByTestId('resume-button'))
    expect(screen.getByTestId('timer-phase').textContent).toBe('Work')
    expect(screen.queryByTestId('work-input')).toBeNull()

    fireEvent.click(screen.getByTestId('reset-button'))
    // Idle again: the inputs (with retained values) and Start are back.
    expect(screen.getByTestId('work-input').getAttribute('value')).toBe('5')
    expect(screen.getByTestId('start-button')).toBeTruthy()
    expect(screen.queryByTestId('pause-button')).toBeNull()
    expect(screen.getByTestId('timer-context').textContent).toBe('2 rounds · 5″/0″')
  })
})

describe('TimerScreen — audio and wake-lock wiring', () => {
  it('the Start tap calls unlockAudio() synchronously and surfaces the audio state via data-audio', () => {
    const unlock = vi.spyOn(audio, 'unlockAudio')

    render(<TimerScreen />)
    fireEvent.click(screen.getByTestId('start-button'))

    expect(unlock).toHaveBeenCalledTimes(1)
    expect(screen.getByTestId('audio-indicator').dataset.audio).toBe(audio.audioState())
  })

  it('acquires a wake lock while running and releases it on pause (useWakeLock(running))', async () => {
    const release = vi.fn<() => Promise<void>>(() => Promise.resolve())
    const sentinel = { release, addEventListener: vi.fn<() => void>() }
    const request = vi.fn<() => Promise<typeof sentinel>>(() => Promise.resolve(sentinel))
    Object.defineProperty(navigator, 'wakeLock', {
      value: { request },
      configurable: true,
    })

    render(<TimerScreen />)
    fireEvent.click(screen.getByTestId('start-button'))

    await waitFor(() => {
      expect(request).toHaveBeenCalledWith('screen')
    })

    fireEvent.click(screen.getByTestId('pause-button'))
    await waitFor(() => {
      expect(release).toHaveBeenCalled()
    })
  })
})

describe('TimerScreen — routing and navigation', () => {
  it('is reachable at /timer via a nav link on the authenticated library home', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((path: string) => {
        if (path === '/auth/me') {
          return Promise.resolve(
            Response.json(
              { user: { id: 'u1', username: 'jill', displayName: 'Jill Owner', role: 'owner' } },
              { status: 200 },
            ),
          )
        }
        throw new Error(`unexpected fetch to ${path}`)
      }),
    )
    const fakeRuntime = makeFakeRuntime({ ListWorkouts: () => Effect.succeed([]) })

    render(
      <RegistryProvider initialValues={[[ServerRpcClient.runtime, Result.success(fakeRuntime)]]}>
        <App />
      </RegistryProvider>,
    )

    await screen.findByTestId('library-screen')
    const link = screen.getByTestId('timer-nav-link')
    expect(link.getAttribute('href')).toBe('/timer')

    await act(async () => {
      await router.navigate({ to: '/timer' })
    })
    await screen.findByTestId('timer-screen')
  })
})
