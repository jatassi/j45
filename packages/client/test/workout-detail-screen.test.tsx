// @vitest-environment jsdom
import { RegistryProvider, Result } from '@effect-atom/atom-react'
import {
  Flow,
  LibraryWorkout,
  Pod,
  Round,
  Station,
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
} from '@tanstack/react-router'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import * as DateTime from 'effect/DateTime'
import * as Effect from 'effect/Effect'
import * as Runtime from 'effect/Runtime'
import * as Schema from 'effect/Schema'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { LibraryScreen } from '@/components/library-screen'
import { WorkoutDetailScreen } from '@/components/workout-detail-screen'
import { ServerRpcClient } from '@/lib/rpc-client'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

/**
 * Builds a `Runtime` that provides `ServerRpcClient` with `handlers` in
 * place of the real (websocket-backed) rpc client — the same fake-runtime
 * idiom `library-screen.test.tsx`/`account-screen.test.tsx` use, seeding
 * `ServerRpcClient.runtime` itself via `RegistryProvider`'s `initialValues`
 * below.
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

/**
 * 2 pods (2 stations, 1 station — one station carries a `detail`), a
 * uniform 2-round flow (`40″/20″ × 2`): ready(5) + 6 works × 40 + 5 rests ×
 * 20 = 5 + 240 + 100 = 345s → "5:45".
 */
const athletica = new LibraryWorkout({
  id: Schema.decodeSync(WorkoutId)('workout-athletica'),
  workout: new Workout({
    name: 'Athletica',
    focus: 'cardio',
    pods: [
      new Pod({
        name: 'Pod 1',
        stations: [
          new Station({ name: 'Rower' }),
          new Station({ name: 'Burpee', detail: 'or mountain climbers' }),
        ],
      }),
      new Pod({ name: 'Pod 2', stations: [new Station({ name: 'Sled push' })] }),
    ],
    flow: new Flow({
      type: 'laps',
      rounds: [
        new Round({ workSeconds: 40, restSeconds: 20 }),
        new Round({ workSeconds: 40, restSeconds: 20 }),
      ],
    }),
  }),
  createdAt: seededAt,
  updatedAt: seededAt,
})

/** A ladder flow (rounds differ) — exercises `formatFlowSummary`'s non-uniform branch. */
const ladderWorkout = new LibraryWorkout({
  id: Schema.decodeSync(WorkoutId)('workout-ladder'),
  workout: new Workout({
    name: 'Ladder Day',
    focus: 'strength',
    pods: [new Pod({ name: 'Pod 1', stations: [new Station({ name: 'Squat' })] })],
    flow: new Flow({
      type: 'laps',
      rounds: [
        new Round({ workSeconds: 40, restSeconds: 20 }),
        new Round({ workSeconds: 30, restSeconds: 10 }),
      ],
    }),
  }),
  createdAt: seededAt,
  updatedAt: seededAt,
})

type Handlers = Partial<Record<string, (payload: unknown) => Effect.Effect<unknown, unknown>>>

/**
 * Mounts a throwaway `/` + `/workouts/$workoutId` route tree (memory
 * history, no file-based codegen) — the same minimal stand-in for
 * `router.tsx`'s own tree that `library-screen.test.tsx`'s
 * `renderLibraryScreen` uses, extended with the detail route this task adds
 * so a click on a `LibraryScreen` card actually navigates.
 */
function renderApp(handlers: Handlers, initialPath: string) {
  const fakeRuntime = makeFakeRuntime(handlers)
  const rootRoute = createRootRoute({ component: Outlet })
  const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/',
    component: LibraryScreen,
  })
  const workoutDetailRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/workouts/$workoutId',
    component: WorkoutDetailScreen,
  })
  const testRouter = createRouter({
    routeTree: rootRoute.addChildren([indexRoute, workoutDetailRoute]),
    history: createMemoryHistory({ initialEntries: [initialPath] }),
  })

  render(
    <RegistryProvider initialValues={[[ServerRpcClient.runtime, Result.success(fakeRuntime)]]}>
      <RouterProvider router={testRouter} />
    </RegistryProvider>,
  )
}

describe('WorkoutDetailScreen', () => {
  it("is reached by clicking a LibraryScreen card's typed Link to /workouts/$workoutId", async () => {
    renderApp(
      {
        ListWorkouts: () => Effect.succeed([athletica]),
        GetWorkout: () => Effect.succeed(athletica),
      },
      '/',
    )

    await screen.findByTestId(`workout-card-${athletica.id}`)
    fireEvent.click(screen.getByTestId(`workout-card-${athletica.id}`))

    await screen.findByTestId('workout-detail-screen')
    expect(screen.getByTestId('workout-title').textContent).toBe('Athletica')
  })

  it('renders the uniform flow summary, every pod/station (name + muted detail), and the total duration from a fake GetWorkout', async () => {
    renderApp(
      {
        GetWorkout: () => Effect.succeed(athletica),
        ListWorkouts: () => Effect.succeed([athletica]),
      },
      `/workouts/${athletica.id}`,
    )

    await screen.findByTestId('workout-detail-screen')
    expect(screen.getByTestId('workout-flow-summary').textContent).toBe('40″/20″ × 2')
    expect(screen.getByTestId('workout-duration').textContent).toBe('5:45')

    expect(screen.getAllByTestId('pod').map((pod) => pod.textContent)).toHaveLength(2)
    expect(screen.getAllByTestId('pod-name').map((pod) => pod.textContent)).toEqual([
      'Pod 1',
      'Pod 2',
    ])
    expect(screen.getAllByTestId('station-name').map((station) => station.textContent)).toEqual([
      'Rower',
      'Burpee',
      'Sled push',
    ])
    expect(screen.getAllByTestId('station-detail')).toHaveLength(1)
    expect(screen.getByTestId('station-detail').textContent).toBe('or mountain climbers')
  })

  it('lists the ladder round-by-round when the rounds differ', async () => {
    renderApp({ GetWorkout: () => Effect.succeed(ladderWorkout) }, `/workouts/${ladderWorkout.id}`)

    await screen.findByTestId('workout-detail-screen')
    expect(screen.getByTestId('workout-flow-summary').textContent).toBe('40″/20″, 30″/10″')
  })

  it('renders a human-readable state for a WorkoutNotFound GetWorkout failure, never a blank screen', async () => {
    const missingId = Schema.decodeSync(WorkoutId)('workout-missing')
    renderApp(
      { GetWorkout: () => Effect.fail(new WorkoutNotFound({ id: missingId })) },
      `/workouts/${missingId}`,
    )

    await screen.findByTestId('workout-not-found')
  })

  it('renames through RenameWorkout, updating the title and refreshing the module-scoped list atom', async () => {
    let current = athletica
    let listCalls = 0

    renderApp(
      {
        GetWorkout: () => Effect.succeed(current),
        ListWorkouts: () => {
          listCalls++
          return Effect.succeed([current])
        },
        RenameWorkout: (payload) => {
          const { name } = payload as { name: string }
          current = new LibraryWorkout({
            id: current.id,
            createdAt: current.createdAt,
            updatedAt: current.updatedAt,
            workout: new Workout({
              name,
              focus: current.workout.focus,
              note: current.workout.note,
              pods: current.workout.pods,
              flow: current.workout.flow,
            }),
          })
          return Effect.succeed(current)
        },
      },
      `/workouts/${athletica.id}`,
    )

    await screen.findByTestId('workout-title')
    await waitFor(() => {
      expect(listCalls).toBe(1)
    })

    fireEvent.click(screen.getByTestId('rename-button'))
    const input = await screen.findByTestId('rename-input')
    fireEvent.change(input, { target: { value: 'Athletica II' } })
    fireEvent.click(screen.getByTestId('rename-confirm'))

    await waitFor(() => {
      expect(screen.getByTestId('workout-title').textContent).toBe('Athletica II')
    })
    expect(listCalls).toBe(2)
    expect(screen.queryByTestId('rename-dialog')).toBeNull()
  })

  it('duplicates through DuplicateWorkout, refreshing the list atom and navigating home', async () => {
    let duplicatePayload: unknown

    renderApp(
      {
        GetWorkout: () => Effect.succeed(athletica),
        ListWorkouts: () => Effect.succeed([athletica]),
        DuplicateWorkout: (payload) => {
          duplicatePayload = payload
          return Effect.succeed(
            new LibraryWorkout({
              id: Schema.decodeSync(WorkoutId)('workout-athletica-copy'),
              workout: athletica.workout,
              createdAt: athletica.createdAt,
              updatedAt: athletica.updatedAt,
            }),
          )
        },
      },
      `/workouts/${athletica.id}`,
    )

    await screen.findByTestId('duplicate-button')
    fireEvent.click(screen.getByTestId('duplicate-button'))

    await screen.findByTestId('library-screen')
    expect(duplicatePayload).toEqual({ id: athletica.id })
  })

  it('deletes through DeleteWorkout behind a confirm dialog, refreshing the list atom and navigating home', async () => {
    let deletePayload: unknown

    renderApp(
      {
        GetWorkout: () => Effect.succeed(athletica),
        ListWorkouts: () => Effect.succeed([athletica]),
        DeleteWorkout: (payload) => {
          deletePayload = payload
          return Effect.succeed(undefined)
        },
      },
      `/workouts/${athletica.id}`,
    )

    await screen.findByTestId('delete-button')
    fireEvent.click(screen.getByTestId('delete-button'))
    // Deleting is gated behind the confirm dialog — a single click never fires it.
    expect(deletePayload).toBeUndefined()
    fireEvent.click(await screen.findByTestId('delete-confirm'))

    await screen.findByTestId('library-screen')
    expect(deletePayload).toEqual({ id: athletica.id })
  })
})
