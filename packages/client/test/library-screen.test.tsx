// @vitest-environment jsdom
import { RegistryProvider, Result } from '@effect-atom/atom-react'
import {
  Flow,
  LibraryWorkout,
  Pod,
  Round,
  SessionId,
  SessionSummary,
  Station,
  Workout,
  WorkoutId,
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
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import * as DateTime from 'effect/DateTime'
import * as Effect from 'effect/Effect'
import * as Runtime from 'effect/Runtime'
import * as Schema from 'effect/Schema'
import { afterEach, describe, expect, it, vi } from 'vitest'

import App from '@/app'
import { LibraryScreen } from '@/components/library-screen'
import { ServerRpcClient } from '@/lib/rpc-client'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

/**
 * Builds a `Runtime` that provides `ServerRpcClient` with `handlers` in
 * place of the real (websocket-backed) rpc client — the same fake-runtime
 * idiom `account-screen.test.tsx` uses, seeding `ServerRpcClient.runtime`
 * itself via `RegistryProvider`'s `initialValues` below.
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

/** 1 pod, 2 stations, laps × 1 round of 30″ work / 0″ rest: ready(5) + 30 + 30 = 65s → "1:05". */
const athletica = new LibraryWorkout({
  id: Schema.decodeSync(WorkoutId)('workout-athletica'),
  workout: new Workout({
    name: 'Athletica',
    focus: 'cardio',
    pods: [
      new Pod({
        name: 'Pod 1',
        stations: [new Station({ name: 'Rower' }), new Station({ name: 'Burpee' })],
      }),
    ],
    flow: new Flow({ type: 'laps', rounds: [new Round({ workSeconds: 30, restSeconds: 0 })] }),
  }),
  createdAt: seededAt,
  updatedAt: seededAt,
})

/** 1 pod, 3 stations, laps × 1 round of 45″ work / 15″ rest: ready(5) + 45+15+45+15+45 = 170s → "2:50". */
const ironCircuit = new LibraryWorkout({
  id: Schema.decodeSync(WorkoutId)('workout-iron-circuit'),
  workout: new Workout({
    name: 'Iron Circuit',
    focus: 'strength',
    pods: [
      new Pod({
        name: 'Pod 1',
        stations: [
          new Station({ name: 'Deadlift' }),
          new Station({ name: 'Bench press' }),
          new Station({ name: 'Row' }),
        ],
      }),
    ],
    flow: new Flow({ type: 'laps', rounds: [new Round({ workSeconds: 45, restSeconds: 15 })] }),
  }),
  createdAt: seededAt,
  updatedAt: seededAt,
})

/** Stand-in destination for `/session/<id>` navigation — the real session screen is a parallel task. */
function SessionDestination() {
  const { sessionId } = useParams({ strict: false }) as { sessionId: string }
  return <div data-testid={`session-screen-${sessionId}`} />
}

/**
 * Mounts `LibraryScreen` as the `/` route of a throwaway router (memory
 * history, no file-based codegen — a minimal stand-in for `router.tsx`'s own
 * tree) so its `Link`s have the router context they need to render, without
 * pulling in the whole app or `AuthGate`. Includes a session destination so
 * active-session card taps can navigate.
 */
function renderLibraryScreen(
  handlers: Partial<Record<string, (payload: unknown) => Effect.Effect<unknown, unknown>>>,
) {
  const fakeRuntime = makeFakeRuntime(handlers)
  const rootRoute = createRootRoute({ component: Outlet })
  const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/',
    component: LibraryScreen,
  })
  const sessionRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/session/$sessionId',
    component: SessionDestination,
  })
  const testRouter = createRouter({
    routeTree: rootRoute.addChildren([indexRoute, sessionRoute]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })

  render(
    <RegistryProvider initialValues={[[ServerRpcClient.runtime, Result.success(fakeRuntime)]]}>
      <RouterProvider router={testRouter} />
    </RegistryProvider>,
  )
}

const activeSession = new SessionSummary({
  id: Schema.decodeSync(SessionId)('session-lobby-1'),
  hostDisplayName: 'Jordan',
  workoutName: 'Iron Circuit',
  startedAt: seededAt,
  participantCount: 4,
})

describe('LibraryScreen', () => {
  it("lists the caller's workouts (name, focus, station count, MM:SS duration) from ListWorkouts", async () => {
    renderLibraryScreen({
      ListWorkouts: () => Effect.succeed([athletica, ironCircuit]),
      ListActiveSessions: () => Effect.succeed([]),
    })

    await screen.findByTestId(`workout-card-${athletica.id}`)

    expect(screen.getByTestId(`workout-name-${athletica.id}`).textContent).toBe('Athletica')
    expect(screen.getByTestId(`workout-focus-${athletica.id}`).textContent).toBe('cardio')
    expect(screen.getByTestId(`workout-stations-${athletica.id}`).textContent).toBe('2 stations')
    expect(screen.getByTestId(`workout-duration-${athletica.id}`).textContent).toBe('1:05')

    expect(screen.getByTestId(`workout-name-${ironCircuit.id}`).textContent).toBe('Iron Circuit')
    expect(screen.getByTestId(`workout-focus-${ironCircuit.id}`).textContent).toBe('strength')
    expect(screen.getByTestId(`workout-stations-${ironCircuit.id}`).textContent).toBe('3 stations')
    expect(screen.getByTestId(`workout-duration-${ironCircuit.id}`).textContent).toBe('2:50')

    const accountLink = screen.getByTestId('account-nav-link')
    expect(accountLink.getAttribute('href')).toBe('/account')
  })

  it('renders an Active sessions strip from a non-empty ListActiveSessions result and navigates on card tap', async () => {
    renderLibraryScreen({
      ListWorkouts: () => Effect.succeed([]),
      ListActiveSessions: () => Effect.succeed([activeSession]),
    })

    const strip = await screen.findByTestId('active-sessions-strip')
    expect(strip.textContent).toContain('Jordan')
    expect(strip.textContent).toContain('Iron Circuit')
    expect(strip.textContent).toContain('4')

    fireEvent.click(screen.getByTestId(`session-card-${activeSession.id}`))
    await screen.findByTestId(`session-screen-${activeSession.id}`)
  })

  it('omits the Active sessions strip entirely when ListActiveSessions is empty', async () => {
    renderLibraryScreen({
      ListWorkouts: () => Effect.succeed([athletica]),
      ListActiveSessions: () => Effect.succeed([]),
    })

    await screen.findByTestId(`workout-card-${athletica.id}`)
    expect(screen.queryByTestId('active-sessions-strip')).toBeNull()
    expect(screen.queryByText('Active sessions')).toBeNull()
  })

  it('refetches ListActiveSessions every 5 seconds while mounted', async () => {
    vi.useFakeTimers()
    let listCalls = 0

    renderLibraryScreen({
      ListWorkouts: () => Effect.succeed([]),
      ListActiveSessions: () => {
        listCalls++
        return Effect.succeed([activeSession])
      },
    })

    // Flush the initial query (effect-atom schedules via microtasks / 0-delay timers).
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1)
    })
    expect(listCalls).toBe(1)
    expect(screen.getByTestId('active-sessions-strip')).toBeTruthy()

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

describe('App', () => {
  it('renders GlassDemo for /glass without ever probing a session (no router, no AuthGate)', () => {
    vi.stubGlobal('location', { pathname: '/glass' })
    vi.stubGlobal(
      'fetch',
      vi.fn(() => {
        throw new Error('unexpected fetch — /glass must not reach AuthGate')
      }),
    )

    render(<App />)

    expect(screen.getByTestId('glass-surface-small')).toBeTruthy()
    expect(fetch).not.toHaveBeenCalled()
  })
})
