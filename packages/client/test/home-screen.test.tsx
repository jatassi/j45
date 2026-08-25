// @vitest-environment jsdom
import { WorkoutId, WorkoutNotFound } from '@j45/domain'
import { act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import * as Effect from 'effect/Effect'
import * as Schema from 'effect/Schema'
import { toast } from 'sonner'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  defaultHandlers,
  ironCircuit,
  liveSession,
  renderHomeScreen,
  startedSummary,
} from './home-harness'

vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}))

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.mocked(toast.error).mockClear()
})

describe('HomeScreen — hero composition', () => {
  it('computes pickHero for a live session and renders home-hero with join target', async () => {
    renderHomeScreen(
      defaultHandlers({
        ListActiveSessions: () => Effect.succeed([liveSession]),
      }),
    )

    const hero = await screen.findByTestId('home-hero')
    expect(hero.textContent).toContain('Iron Circuit')
    expect(hero.textContent).toContain('LIVE')
    expect(screen.getByTestId(`session-card-${liveSession.id}`).getAttribute('href')).toBe(
      `/session/${liveSession.id}`,
    )
  })

  it('silently downgrades a failed ListActiveSessions poll to the no-live pick (no error fold)', async () => {
    renderHomeScreen(
      defaultHandlers({
        ListActiveSessions: () => Effect.fail(new Error('poll boom')),
      }),
    )

    const hero = await screen.findByTestId('home-hero')
    // start-last from history head "Iron Circuit" — not a failure alert.
    expect(hero.textContent).toContain('Iron Circuit')
    expect(hero.textContent).toContain('Start last')
    expect(screen.queryByTestId('query-boundary-error')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull()
  })

  it('renders home-hero-skeleton and recent skeleton while history/workouts are still loading', async () => {
    renderHomeScreen(
      defaultHandlers({
        ListHistory: () => Effect.never,
        ListWorkouts: () => Effect.never,
      }),
    )

    await screen.findByTestId('home-screen')
    expect(screen.getByTestId('home-hero-skeleton')).toBeTruthy()
    expect(screen.getByTestId('home-recent-skeleton')).toBeTruthy()
    expect(screen.queryByTestId('home-hero')).toBeNull()
    expect(screen.queryByTestId('home-recent-list')).toBeNull()
  })

  it('renders an inline alert with retry when ListWorkouts fails (visible failure path)', async () => {
    let workoutsCalls = 0
    renderHomeScreen(
      defaultHandlers({
        ListWorkouts: () => {
          workoutsCalls++
          return Effect.fail(new Error('workouts boom'))
        },
      }),
    )

    await screen.findByTestId('home-screen')
    const errors = await screen.findAllByTestId('query-boundary-error')
    expect(errors.length).toBeGreaterThanOrEqual(1)
    expect(screen.queryByTestId('home-hero')).toBeNull()

    const before = workoutsCalls
    const [firstRetry] = screen.getAllByRole('button', { name: 'Retry' })
    expect(firstRetry).toBeTruthy()
    fireEvent.click(firstRetry)
    await waitFor(() => {
      expect(workoutsCalls).toBeGreaterThan(before)
    })
  })

  it('renders an inline alert with retry when ListHistory fails', async () => {
    renderHomeScreen(
      defaultHandlers({
        ListHistory: () => Effect.fail(new Error('history boom')),
      }),
    )

    await screen.findByTestId('home-screen')
    const errors = await screen.findAllByTestId('query-boundary-error')
    expect(errors.length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByRole('button', { name: 'Retry' }).length).toBeGreaterThanOrEqual(1)
  })

  it('refetches ListActiveSessions every 5 seconds while mounted', async () => {
    vi.useFakeTimers()
    let listCalls = 0

    renderHomeScreen(
      defaultHandlers({
        ListActiveSessions: () => {
          listCalls++
          return Effect.succeed([liveSession])
        },
      }),
    )

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1)
    })
    expect(listCalls).toBe(1)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000)
    })
    expect(listCalls).toBe(2)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000)
    })
    expect(listCalls).toBe(3)
  })
})

describe('HomeScreen — quick-start tiles', () => {
  it('renders three equal tiles with 44px+ targets linking to timer, generate, and new workout', async () => {
    renderHomeScreen(defaultHandlers())

    await screen.findByTestId('home-screen')

    const timer = screen.getByTestId('home-timer-link')
    const generate = screen.getByTestId('home-generate-link')
    const newWorkout = screen.getByTestId('home-new-workout-link')

    expect(timer.getAttribute('href')).toBe('/timer')
    expect(generate.getAttribute('href')).toBe('/generate')
    expect(newWorkout.getAttribute('href')).toBe('/workouts/new')

    // jsdom does not apply Tailwind — assert the 44px+ class contract on each tile.
    for (const tile of [timer, generate, newWorkout]) {
      expect(tile.className).toMatch(/min-h-(11|\[44px\]|\[84px\])/)
    }
  })
})

describe('HomeScreen — recent list', () => {
  it('renders recentRows as home-recent-list with focus-hued icon, name, and works · MM:SS', async () => {
    renderHomeScreen(defaultHandlers())

    const list = await screen.findByTestId('home-recent-list')
    const row = screen.getByTestId(`recent-row-${ironCircuit.id}`)
    expect(list.contains(row)).toBe(true)
    expect(row.textContent).toContain('Iron Circuit')
    expect(row.textContent).toMatch(/\d+ works · \d+:\d{2}/)
    expect(row.getAttribute('href')).toBe(`/workouts/${ironCircuit.id}`)
  })

  it('navigates to the workout detail route when a recent row is tapped', async () => {
    renderHomeScreen(defaultHandlers())

    const row = await screen.findByTestId(`recent-row-${ironCircuit.id}`)
    fireEvent.click(row)
    await screen.findByTestId(`workout-detail-${ironCircuit.id}`)
  })

  it('recent-start drives StartSession then navigates to /session/<id>', async () => {
    let startPayload: unknown
    renderHomeScreen(
      defaultHandlers({
        StartSession: (payload) => {
          startPayload = payload
          return Effect.succeed(startedSummary)
        },
      }),
    )

    const start = await screen.findByTestId(`recent-start-${ironCircuit.id}`)
    fireEvent.click(start)

    await screen.findByTestId(`session-screen-${startedSummary.id}`)
    expect(startPayload).toEqual({ workoutId: ironCircuit.id })
    // Row navigation must not also fire from the start affordance.
    expect(screen.queryByTestId(`workout-detail-${ironCircuit.id}`)).toBeNull()
  })

  it('failed StartSession from recent-start toasts via sonner and stays interactive', async () => {
    const missingId = Schema.decodeSync(WorkoutId)('workout-missing')
    renderHomeScreen(
      defaultHandlers({
        StartSession: () => Effect.fail(new WorkoutNotFound({ id: missingId })),
      }),
    )

    const start = await screen.findByTestId(`recent-start-${ironCircuit.id}`)
    fireEvent.click(start)

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalled()
    })

    expect((start as HTMLButtonElement).disabled).toBe(false)
    expect(screen.queryByTestId(`session-screen-${startedSummary.id}`)).toBeNull()

    fireEvent.click(start)
    await waitFor(() => {
      expect(vi.mocked(toast.error).mock.calls.length).toBeGreaterThanOrEqual(2)
    })
  })
})
