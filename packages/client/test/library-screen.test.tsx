// @vitest-environment jsdom
import { RegistryProvider, Result } from '@effect-atom/atom-react'
import { Flow, LibraryWorkout, Pod, Round, Station, Workout, WorkoutId } from '@j45/domain'
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
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

/**
 * Mounts `LibraryScreen` as the `/library` route of a throwaway router
 * (memory history, no file-based codegen — a minimal stand-in for
 * `router.tsx`'s own tree) so its `Link`s have the router context they need
 * to render, without pulling in the whole app or `AuthGate`.
 */
function renderLibraryScreen(
  handlers: Partial<Record<string, (payload: unknown) => Effect.Effect<unknown, unknown>>>,
  initialPath = '/library',
) {
  const fakeRuntime = makeFakeRuntime(handlers)
  const rootRoute = createRootRoute({ component: Outlet })
  const libraryRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/library',
    component: LibraryScreen,
  })
  const exercisesRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/library/exercises',
    component: () => <div data-testid="exercises-destination" />,
  })
  const testRouter = createRouter({
    routeTree: rootRoute.addChildren([libraryRoute, exercisesRoute]),
    history: createMemoryHistory({ initialEntries: [initialPath] }),
  })

  render(
    <RegistryProvider initialValues={[[ServerRpcClient.runtime, Result.success(fakeRuntime)]]}>
      <RouterProvider router={testRouter} />
    </RegistryProvider>,
  )
}

describe('LibraryScreen', () => {
  it("lists the caller's workouts (name, focus label, works·duration summary) from ListWorkouts", async () => {
    renderLibraryScreen({
      ListWorkouts: () => Effect.succeed([athletica, ironCircuit]),
    })

    await screen.findByTestId(`workout-card-${athletica.id}`)

    expect(screen.getByTestId(`workout-name-${athletica.id}`).textContent).toBe('Athletica')
    // FocusBadge must show the human label, never the raw literal.
    expect(screen.getByTestId(`workout-focus-${athletica.id}`).textContent).toBe('Cardio')
    expect(screen.getByTestId(`workout-summary-${athletica.id}`).textContent).toBe('2 works · 1:05')

    expect(screen.getByTestId(`workout-name-${ironCircuit.id}`).textContent).toBe('Iron Circuit')
    expect(screen.getByTestId(`workout-focus-${ironCircuit.id}`).textContent).toBe('Strength')
    expect(screen.getByTestId(`workout-summary-${ironCircuit.id}`).textContent).toBe(
      '3 works · 2:50',
    )

    // Old split testids are gone.
    expect(screen.queryByTestId(`workout-stations-${athletica.id}`)).toBeNull()
    expect(screen.queryByTestId(`workout-duration-${athletica.id}`)).toBeNull()

    // Whole card is the Link to the detail route.
    expect(screen.getByTestId(`workout-card-${athletica.id}`).getAttribute('href')).toBe(
      `/workouts/${athletica.id}`,
    )

    expect(screen.getByTestId('new-workout-button').getAttribute('href')).toBe('/workouts/new')
  })

  it('renders LibrarySegments from ui/toggle-group with Workouts active on /library', async () => {
    renderLibraryScreen({
      ListWorkouts: () => Effect.succeed([]),
    })

    await screen.findByTestId('library-screen')
    const segments = screen.getByTestId('library-segments')
    expect(segments).toBeTruthy()
    // Composed from ui/toggle-group, not hand-rolled nav pills.
    expect(segments.dataset.slot).toBe('toggle-group')
    expect(screen.getByTestId('library-segment-workouts').getAttribute('href')).toBe('/library')
    expect(screen.getByTestId('library-segment-exercises').getAttribute('href')).toBe(
      '/library/exercises',
    )
    expect(screen.getByTestId('library-segment-workouts').dataset.active).toBe('true')
    expect(screen.getByTestId('library-segment-exercises').dataset.active).toBe('false')
  })

  it('routes to /library/exercises when the Exercises segment is activated', async () => {
    renderLibraryScreen({
      ListWorkouts: () => Effect.succeed([]),
    })

    await screen.findByTestId('library-screen')
    fireEvent.click(screen.getByTestId('library-segment-exercises'))
    await screen.findByTestId('exercises-destination')
  })

  it('shows skeleton rows while listWorkoutsAtom is loading', async () => {
    renderLibraryScreen({
      ListWorkouts: () => Effect.never,
    })

    await screen.findByTestId('library-screen')
    expect(screen.getByTestId('query-boundary-loading')).toBeTruthy()
    // Not the old bare loading string.
    expect(screen.queryByText('Loading your workouts…')).toBeNull()
    // Empty / failure surfaces stay hidden.
    expect(screen.queryByTestId('query-boundary-empty')).toBeNull()
    expect(screen.queryByTestId('query-boundary-error')).toBeNull()
  })

  it('shows ui/empty with a New workout CTA when ListWorkouts is empty', async () => {
    renderLibraryScreen({
      ListWorkouts: () => Effect.succeed([]),
    })

    await screen.findByTestId('query-boundary-empty')
    // Empty CTA navigates to the new-workout editor.
    const emptyCta = screen.getByTestId('new-workout-empty-cta')
    expect(emptyCta.getAttribute('href')).toBe('/workouts/new')
    // Header New workout button remains always-visible outside the branch.
    expect(screen.getByTestId('new-workout-button').getAttribute('href')).toBe('/workouts/new')
    // Visually distinct from loading / failure.
    expect(screen.queryByTestId('query-boundary-loading')).toBeNull()
    expect(screen.queryByTestId('query-boundary-error')).toBeNull()
  })

  it('shows ui/alert with retry when ListWorkouts fails', async () => {
    renderLibraryScreen({
      ListWorkouts: () => Effect.fail('list-failed' as never),
    })

    await screen.findByTestId('query-boundary-error')
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy()
    // Visually distinct from loading / empty.
    expect(screen.queryByTestId('query-boundary-loading')).toBeNull()
    expect(screen.queryByTestId('query-boundary-empty')).toBeNull()
  })

  it('contains no native select or bare input elements', async () => {
    renderLibraryScreen({
      ListWorkouts: () => Effect.succeed([athletica]),
    })

    await screen.findByTestId(`workout-card-${athletica.id}`)
    const root = screen.getByTestId('library-screen')
    expect(root.querySelector('select')).toBeNull()
    expect(root.querySelector('input')).toBeNull()
  })

  it('does not render the old header nav, ActiveSessionsStrip, or the old h1 header', async () => {
    renderLibraryScreen({
      ListWorkouts: () => Effect.succeed([athletica]),
    })

    await screen.findByTestId(`workout-card-${athletica.id}`)
    expect(screen.queryByTestId('active-sessions-strip')).toBeNull()
    expect(screen.queryByTestId('account-nav-link')).toBeNull()
    expect(screen.queryByTestId('timer-nav-link')).toBeNull()
    expect(screen.queryByTestId('generate-nav-link')).toBeNull()
    expect(screen.queryByTestId('history-nav-link')).toBeNull()
    expect(screen.queryByText('Your library')).toBeNull()
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
