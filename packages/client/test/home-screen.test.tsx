// @vitest-environment jsdom
import { RegistryProvider, Result } from '@effect-atom/atom-react'
import { SessionId, SessionSummary } from '@j45/domain'
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

import { HomeScreen } from '@/components/home-screen'
import { ServerRpcClient } from '@/lib/rpc-client'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

/**
 * Builds a `Runtime` that provides `ServerRpcClient` with `handlers` in
 * place of the real (websocket-backed) rpc client — the same fake-runtime
 * idiom `library-screen.test.tsx` uses, seeding `ServerRpcClient.runtime`
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

/** Stand-in destination for `/session/<id>` navigation. */
function SessionDestination() {
  const { sessionId } = useParams({ strict: false }) as { sessionId: string }
  return <div data-testid={`session-screen-${sessionId}`} />
}

/**
 * Mounts `HomeScreen` as the `/` route of a throwaway router so its `Link`s
 * (`/timer`, `/workouts/new`, `/session/$sessionId`) have router context.
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
  const newWorkoutRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/workouts/new',
    component: () => <div data-testid="new-workout-destination" />,
  })
  const sessionRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/session/$sessionId',
    component: SessionDestination,
  })
  const testRouter = createRouter({
    routeTree: rootRoute.addChildren([indexRoute, timerRoute, newWorkoutRoute, sessionRoute]),
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

describe('HomeScreen', () => {
  it('renders home-screen with timer and new-workout links', async () => {
    renderHomeScreen({
      ListActiveSessions: () => Effect.succeed([]),
    })

    await screen.findByTestId('home-screen')
    expect(screen.getByTestId('home-timer-link').getAttribute('href')).toBe('/timer')
    expect(screen.getByTestId('home-new-workout-link').getAttribute('href')).toBe('/workouts/new')
  })

  it('renders an Active sessions strip from a non-empty ListActiveSessions result and navigates on card tap', async () => {
    renderHomeScreen({
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
    renderHomeScreen({
      ListActiveSessions: () => Effect.succeed([]),
    })

    await screen.findByTestId('home-screen')
    expect(screen.queryByTestId('active-sessions-strip')).toBeNull()
    expect(screen.queryByText('Active sessions')).toBeNull()
  })

  it('refetches ListActiveSessions every 5 seconds while mounted', async () => {
    vi.useFakeTimers()
    let listCalls = 0

    renderHomeScreen({
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
