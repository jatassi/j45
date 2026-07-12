// @vitest-environment jsdom
import { RegistryProvider, Result } from '@effect-atom/atom-react'
import {
  CompletionId,
  Flow,
  LibraryWorkout,
  Participant,
  Pod,
  Round,
  SessionCompletion,
  SessionId,
  SessionSummary,
  Station,
  UserId,
  Workout,
  WorkoutId,
  WorkoutNotFound,
} from '@j45/domain'
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
  useParams,
} from '@tanstack/react-router'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import * as DateTime from 'effect/DateTime'
import * as Effect from 'effect/Effect'
import * as Runtime from 'effect/Runtime'
import * as Schema from 'effect/Schema'
import { toast } from 'sonner'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { HomeScreen } from '@/components/home-screen'
import { ServerRpcClient } from '@/lib/rpc-client'

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

/**
 * Builds a `Runtime` that provides `ServerRpcClient` with `handlers` in
 * place of the real (websocket-backed) rpc client — the same fake-runtime
 * idiom `library-screen.test.tsx` / `home-hero.test.tsx` use, seeding
 * `ServerRpcClient.runtime` itself via `RegistryProvider`'s `initialValues`.
 */
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

const seededAt = DateTime.unsafeMake('2026-01-01T00:00:00.000Z')

const makeWorkout = (name: string, focus: 'cardio' | 'strength' | 'hybrid' = 'cardio'): Workout =>
  new Workout({
    name,
    focus,
    pods: [new Pod({ name: 'Pod 1', stations: [new Station({ name: 'Burpee' })] })],
    flow: new Flow({
      type: 'laps',
      rounds: [new Round({ workSeconds: 40, restSeconds: 20 })],
    }),
  })

const makeLibraryWorkout = (
  id: string,
  name: string,
  focus: 'cardio' | 'strength' | 'hybrid' = 'cardio',
): LibraryWorkout =>
  new LibraryWorkout({
    id: Schema.decodeSync(WorkoutId)(id),
    workout: makeWorkout(name, focus),
    createdAt: seededAt,
    updatedAt: seededAt,
  })

const alice = new Participant({
  userId: Schema.decodeSync(UserId)('user-alice'),
  displayName: 'Alice',
})

const makeCompletion = (id: string, workoutName: string): SessionCompletion =>
  new SessionCompletion({
    id: Schema.decodeSync(CompletionId)(id),
    sessionId: Schema.decodeSync(SessionId)(`session-for-${id}`),
    workoutName,
    workout: makeWorkout(workoutName),
    host: alice,
    participants: [alice],
    startedAt: seededAt,
    endedAt: seededAt,
  })

/** Stand-in destination for `/session/<id>` navigation. */
function SessionDestination() {
  const { sessionId } = useParams({ strict: false }) as { sessionId: string }
  return <div data-testid={`session-screen-${sessionId}`} />
}

/** Stand-in destination for `/workouts/<id>` detail navigation. */
function WorkoutDetailDestination() {
  const { workoutId } = useParams({ strict: false }) as { workoutId: string }
  return <div data-testid={`workout-detail-${workoutId}`} />
}

/**
 * Mounts `HomeScreen` as the `/` route of a throwaway router so its `Link`s
 * and navigates have router context.
 */
function renderHomeScreen(
  handlers: Partial<Record<string, (payload: unknown) => Effect.Effect<unknown, unknown>>>,
) {
  const fakeRuntime = makeFakeRuntime(handlers)
  const rootRoute = createRootRoute({ component: Outlet })
  const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/',
    component: HomeScreen,
  })
  const timerRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/timer',
    component: () => <div data-testid="timer-destination" />,
  })
  const generateRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/generate',
    component: () => <div data-testid="generate-destination" />,
  })
  const newWorkoutRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/workouts/new',
    component: () => <div data-testid="new-workout-destination" />,
  })
  const workoutDetailRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/workouts/$workoutId',
    component: WorkoutDetailDestination,
  })
  const sessionRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/session/$sessionId',
    component: SessionDestination,
  })
  const testRouter = createRouter({
    routeTree: rootRoute.addChildren([
      indexRoute,
      timerRoute,
      generateRoute,
      newWorkoutRoute,
      workoutDetailRoute,
      sessionRoute,
    ]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })

  render(
    <RegistryProvider initialValues={[[ServerRpcClient.runtime, Result.success(fakeRuntime)]]}>
      <RouterProvider router={testRouter} />
    </RegistryProvider>,
  )
}

const ironCircuit = makeLibraryWorkout('workout-iron', 'Iron Circuit', 'strength')
const athletica = makeLibraryWorkout('workout-athletica', 'Athletica', 'cardio')

const liveSession = new SessionSummary({
  id: Schema.decodeSync(SessionId)('session-live-1'),
  hostDisplayName: 'Jordan',
  workoutName: 'Iron Circuit',
  startedAt: DateTime.unsafeMake('2026-03-01T09:48:00.000Z'),
  participantCount: 4,
})

const startedSummary = new SessionSummary({
  id: Schema.decodeSync(SessionId)('session-started-1'),
  hostDisplayName: 'You',
  workoutName: ironCircuit.workout.name,
  startedAt: seededAt,
  participantCount: 1,
})

/** Default successful handlers for the three home queries. */
function defaultHandlers(
  overrides: Partial<Record<string, (payload: unknown) => Effect.Effect<unknown, unknown>>> = {},
): Partial<Record<string, (payload: unknown) => Effect.Effect<unknown, unknown>>> {
  return {
    ListActiveSessions: () => Effect.succeed([]),
    ListHistory: () => Effect.succeed([makeCompletion('c-1', 'Iron Circuit')]),
    ListWorkouts: () => Effect.succeed([ironCircuit, athletica]),
    ...overrides,
  }
}

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
