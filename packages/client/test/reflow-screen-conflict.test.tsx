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
  WorkoutConflict,
  WorkoutId,
  type ReflowRequest,
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
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import * as DateTime from 'effect/DateTime'
import * as Effect from 'effect/Effect'
import * as Runtime from 'effect/Runtime'
import * as Schema from 'effect/Schema'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { WorkoutDetailScreen } from '@/components/workout-detail-screen'
import { ReflowWorkoutScreen } from '@/components/workout-editor-screen'
import { ServerRpcClient } from '@/lib/rpc-client'

vi.mock('sonner', () => ({
  toast: { error: vi.fn() },
}))

afterEach(() => {
  cleanup()
})

type Handlers = Partial<Record<string, (payload: unknown) => Effect.Effect<unknown, unknown>>>

/** Fake rpc runtime — same idiom as `reflow-screen.test.tsx`. */
function makeFakeRuntime(handlers: Handlers) {
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
const rewrittenAt = DateTime.unsafeMake('2026-02-02T00:00:00.000Z')
const workoutId = Schema.decodeSync(WorkoutId)('workout-athletica')

const podOf = (name: string, stations: readonly string[]) =>
  new Pod({
    name,
    stations: stations.map((station) => new Station({ name: station })) as unknown as [
      Station,
      ...Station[],
    ],
  })

const flow = new Flow({ type: 'laps', rounds: [new Round({ workSeconds: 40, restSeconds: 20 })] })

const ORIGINAL_STATIONS = ['Rower', 'Squat press', 'Burpee', 'Bike']
const REWRITTEN_STATIONS = ['Sled push', 'Kettlebell swing', 'Wall ball', 'Assault bike']

/**
 * Two versions of one plan with the *same* station count, so every index in a
 * spec built against the first still resolves against the second — which is
 * exactly what makes a stale reflow launch silent rather than loud.
 */
const versionOf = (stations: readonly string[], updatedAt: DateTime.Utc) =>
  new LibraryWorkout({
    id: workoutId,
    workout: new Workout({
      name: 'Athletica',
      focus: 'cardio',
      pods: [podOf('Pod 1', stations.slice(0, 2)), podOf('Pod 2', stations.slice(2))],
      flow,
    }),
    createdAt: seededAt,
    updatedAt,
  })

function SessionDestination() {
  const { sessionId } = useParams({ strict: false }) as { sessionId: string }
  return <div data-testid={`session-screen-${sessionId}`} />
}

const sampleSession = new SessionSummary({
  id: Schema.decodeSync(SessionId)('session-reflow-1'),
  hostDisplayName: 'Alex',
  workoutName: 'Athletica',
  startedAt: seededAt,
  participantCount: 1,
})

function renderReflow(handlers: Handlers) {
  const fakeRuntime = makeFakeRuntime(handlers)
  const rootRoute = createRootRoute({ component: Outlet })
  const detailRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/workouts/$workoutId',
    component: WorkoutDetailScreen,
  })
  const reflowRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/workouts/$workoutId/reflow',
    component: ReflowWorkoutScreen,
  })
  const sessionRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/session/$sessionId',
    component: SessionDestination,
  })
  const testRouter = createRouter({
    routeTree: rootRoute.addChildren([detailRoute, reflowRoute, sessionRoute]),
    history: createMemoryHistory({ initialEntries: [`/workouts/${workoutId}/reflow`] }),
  })
  render(
    <RegistryProvider initialValues={[[ServerRpcClient.runtime, Result.success(fakeRuntime)]]}>
      <RouterProvider router={testRouter} />
    </RegistryProvider>,
  )
}

const stationNames = () =>
  screen.getAllByTestId('reflow-station-name').map((element) => element.textContent)

describe('ReflowWorkoutScreen when the source plan changes underneath', () => {
  it('re-seeds the draft from the version it re-fetched, so the stations on screen are never a spec resolved against a different plan', async () => {
    let current = versionOf(ORIGINAL_STATIONS, seededAt)
    let startPayload: { workoutId: WorkoutId; reflow: ReflowRequest } | undefined
    let startSourceMillis = 0

    renderReflow({
      GetWorkout: () => Effect.succeed(current),
      ListWorkouts: () => Effect.succeed([current]),
      ListActiveSessions: () => Effect.succeed([]),
      UpdateWorkout: (payload) => {
        const p = payload as { id: WorkoutId; updatedAt: DateTime.Utc }
        // Another device already saved: this write is built on a stale read.
        return Effect.fail(new WorkoutConflict({ id: p.id }))
      },
      StartSession: (payload) => {
        startPayload = payload as { workoutId: WorkoutId; reflow: ReflowRequest }
        startSourceMillis = DateTime.toEpochMillis(startPayload.reflow.sourceUpdatedAt)
        return Effect.succeed(sampleSession)
      },
    })

    await screen.findByTestId('reflow-editor-screen')
    expect(stationNames()).toEqual(ORIGINAL_STATIONS)

    // The other device's save is what this screen will re-fetch.
    current = versionOf(REWRITTEN_STATIONS, rewrittenAt)

    fireEvent.click(screen.getByTestId('reflow-save'))

    // The refresh must rebuild the draft, not leave the old spec pointed at a
    // new plan — the station names on screen are what will actually run.
    await waitFor(() => {
      expect(stationNames()).toEqual(REWRITTEN_STATIONS)
    })

    fireEvent.click(screen.getByTestId('reflow-start'))
    await screen.findByTestId(`session-screen-${sampleSession.id}`)

    // The version the launch carries is the one the on-screen draft was built
    // from — never the stale one, and never a fresh token on a stale spec.
    expect(startSourceMillis).toBe(DateTime.toEpochMillis(rewrittenAt))
    expect(startPayload?.reflow.spec.pods.flatMap((pod) => pod.stations)).toEqual([0, 1, 2, 3])
  })
})
