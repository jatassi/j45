// @vitest-environment jsdom
import { RegistryProvider, Result } from '@effect-atom/atom-react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import * as Effect from 'effect/Effect'
import * as Runtime from 'effect/Runtime'
import { afterEach, describe, expect, it, vi } from 'vitest'

import App from '@/app'
import { RING_CIRCUMFERENCE } from '@/components/player/progress-ring'
import { TimerScreen } from '@/components/timer-screen'
import { ServerRpcClient } from '@/lib/rpc-client'
import * as audio from '@/player/audio'
import { router } from '@/router'

// Glass hooks touch canvas / ResizeObserver during mount; the timer screen only
// needs the immersive kit DOM contracts in these unit tests.
vi.mock('@/glass/use-liquid-glass', () => ({ useLiquidGlass: vi.fn() }))
vi.mock('@/glass/use-scene-surface', () => ({ useSceneSurface: vi.fn() }))

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

/** Read the progress arc's stroke-dashoffset (null when the ring is not mounted). */
function ringDashOffset(): string | null {
  const arc = screen.queryByTestId('player-progress-ring-arc')
  return arc?.getAttribute('stroke-dashoffset') ?? null
}

describe('TimerScreen — idle field kit composition', () => {
  it('composes work / rest / rounds from the ui/ Field kit (Field + kit Input, numeric inputMode) — no raw hand-styled native number rows', () => {
    render(<TimerScreen />)

    const work = screen.getByTestId('work-input')
    const rest = screen.getByTestId('rest-input')
    const rounds = screen.getByTestId('rounds-input')

    // Kit Input marks itself with data-slot="input"; the Field group wraps each row.
    expect(work.dataset.slot).toBe('input')
    expect(rest.dataset.slot).toBe('input')
    expect(rounds.dataset.slot).toBe('input')

    expect(work.closest('[data-slot="field"]')).not.toBeNull()
    expect(rest.closest('[data-slot="field"]')).not.toBeNull()
    expect(rounds.closest('[data-slot="field"]')).not.toBeNull()

    // Numeric mobile keyboard; min floors retained on the editable controls.
    expect(work.inputMode).toBe('numeric')
    expect(rest.inputMode).toBe('numeric')
    expect(rounds.inputMode).toBe('numeric')

    expect(work.getAttribute('value')).toBe('40')
    expect(rest.getAttribute('value')).toBe('20')
    expect(rounds.getAttribute('value')).toBe('9')
    expect(work.getAttribute('min')).toBe('5')
    expect(rest.getAttribute('min')).toBe('0')
    expect(rounds.getAttribute('min')).toBe('1')

    expect(screen.getByTestId('start-button')).toBeTruthy()
    expect(screen.getByTestId('timer-context').textContent).toBe('9 rounds · 40″/20″')

    // Idle has no immersive running chrome.
    expect(screen.queryByTestId('player-phase-backdrop')).toBeNull()
    expect(screen.queryByTestId('player-progress-ring')).toBeNull()
    expect(screen.queryByTestId('player-control-dock')).toBeNull()
  })
})

describe('TimerScreen — inputs and the domain-driven run', () => {
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

describe('TimerScreen — immersive running layout', () => {
  it('renders PhaseBackdrop + ProgressRing around the digits, a round indicator, and ControlDock with Pause/Resume and Reset (no next-up, no participants)', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000_000)

    render(<TimerScreen />)
    setInputs('5', '0', '2')
    fireEvent.click(screen.getByTestId('start-button'))

    // Immersive kit mounts once the run starts.
    const backdrop = screen.getByTestId('player-phase-backdrop')
    expect(backdrop.dataset.phase).toBe('ready')
    expect(backdrop.dataset.paused).toBe('false')
    expect(screen.getByTestId('player-progress-ring')).toBeTruthy()
    expect(screen.getByTestId('player-control-dock')).toBeTruthy()

    // Digits + phase + context live inside the ring; preserved testids.
    expect(screen.getByTestId('timer-phase').textContent).toBe('Get ready')
    expect(screen.getByTestId('timer-count').textContent).toBe('0:05')
    expect(screen.getByTestId('timer-context').textContent).toBe('2 rounds · 5″/0″')
    expect(screen.getByTestId('audio-indicator').dataset.audio).toBeDefined()

    // No next-up line content, no participant chrome.
    const nextUp = screen.getByTestId('player-control-dock').querySelector('[data-slot="next-up"]')
    expect(nextUp).not.toBeNull()
    expect((nextUp?.textContent ?? '').trim()).toBe('')
    expect(screen.queryByText(/participant/i)).toBeNull()

    // Idle form is gone; dock has Pause + Reset.
    expect(screen.queryByTestId('work-input')).toBeNull()
    expect(screen.getByTestId('pause-button')).toBeTruthy()
    expect(screen.getByTestId('reset-button')).toBeTruthy()

    // Into work: phase hue follows the segment; round indicator takes over context.
    await advance(5000)
    expect(screen.getByTestId('player-phase-backdrop').dataset.phase).toBe('work')
    expect(screen.getByTestId('timer-phase').textContent).toBe('Work')
    expect(screen.getByTestId('timer-context').textContent).toBe('Round 1 of 2')

    // Ring fraction tracks remaining/duration (full at segment entry → offset 0).
    expect(ringDashOffset()).toBe('0')

    await advance(2000)
    fireEvent.click(screen.getByTestId('pause-button'))

    // Paused freezes count and ring, and desaturates the backdrop.
    const frozenOffset = ringDashOffset()
    expect(screen.getByTestId('timer-count').textContent).toBe('0:03')
    expect(screen.getByTestId('player-phase-backdrop').dataset.paused).toBe('true')
    await advance(3000)
    expect(screen.getByTestId('timer-count').textContent).toBe('0:03')
    expect(ringDashOffset()).toBe(frozenOffset)

    fireEvent.click(screen.getByTestId('resume-button'))
    expect(screen.getByTestId('player-phase-backdrop').dataset.paused).toBe('false')
    expect(screen.getByTestId('pause-button')).toBeTruthy()

    // Through to Done: orange done phase, 0:00, Nice work; ring empty.
    await advance(3000)
    await advance(5000)
    expect(screen.getByTestId('timer-phase').textContent).toBe('Done')
    expect(screen.getByTestId('timer-count').textContent).toBe('0:00')
    expect(screen.getByTestId('timer-context').textContent).toBe('Nice work')
    expect(screen.getByTestId('player-phase-backdrop').dataset.phase).toBe('done')
    expect(ringDashOffset()).toBe(String(RING_CIRCUMFERENCE))
    // Done: only Reset remains (no Pause/Resume).
    expect(screen.queryByTestId('pause-button')).toBeNull()
    expect(screen.queryByTestId('resume-button')).toBeNull()
    expect(screen.getByTestId('reset-button')).toBeTruthy()
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
  it('is reachable at /timer after authenticating to the library home', async () => {
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

    // Authenticated lands on home; timer is a Home quick action once
    // the nav-shell lands (the old header nav link is gone).
    await screen.findByTestId('home-screen')
    await act(async () => {
      await router.navigate({ to: '/timer' })
    })
    await screen.findByTestId('timer-screen')
  })
})
