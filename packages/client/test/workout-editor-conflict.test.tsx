// @vitest-environment jsdom
import { RegistryProvider, Result } from '@effect-atom/atom-react'
import {
  Flow,
  LibraryWorkout,
  Pod,
  Round,
  Station,
  Workout,
  WorkoutConflict,
  WorkoutId,
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
import { toast } from 'sonner'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { WorkoutDetailScreen } from '@/components/workout-detail-screen'
import { EditWorkoutScreen } from '@/components/workout-editor-screen'
import { ServerRpcClient } from '@/lib/rpc-client'

vi.mock('sonner', () => ({
  toast: { error: vi.fn() },
}))

afterEach(() => {
  cleanup()
  vi.mocked(toast.error).mockClear()
})

type Handlers = Partial<Record<string, (payload: unknown) => Effect.Effect<unknown, unknown>>>

/** Fake rpc runtime — the same idiom `workout-editor-screen.test.tsx` uses. */
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
const editedElsewhereAt = DateTime.unsafeMake('2026-02-02T00:00:00.000Z')

const singlePod = new Workout({
  name: 'Athletica',
  focus: 'cardio',
  pods: [
    new Pod({
      name: 'Pod 1',
      stations: [new Station({ name: 'Rower' }), new Station({ name: 'Burpee' })],
    }),
  ],
  flow: new Flow({ type: 'laps', rounds: [new Round({ workSeconds: 40, restSeconds: 20 })] }),
})

const workoutId = Schema.decodeSync(WorkoutId)('workout-athletica')

const versionOf = (workout: Workout, updatedAt: DateTime.Utc) =>
  new LibraryWorkout({ id: workoutId, workout, createdAt: seededAt, updatedAt })

/** Edit + detail over memory history, opened on the edit route. */
function renderEditor(handlers: Handlers) {
  const fakeRuntime = makeFakeRuntime(handlers)
  const rootRoute = createRootRoute({ component: Outlet })
  const detailRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/workouts/$workoutId',
    component: WorkoutDetailScreen,
  })
  const editRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/workouts/$workoutId/edit',
    component: EditWorkoutScreen,
  })
  const testRouter = createRouter({
    routeTree: rootRoute.addChildren([detailRoute, editRoute]),
    history: createMemoryHistory({ initialEntries: [`/workouts/${workoutId}/edit`] }),
  })
  render(
    <RegistryProvider initialValues={[[ServerRpcClient.runtime, Result.success(fakeRuntime)]]}>
      <RouterProvider router={testRouter} />
    </RegistryProvider>,
  )
}

describe('EditWorkoutScreen under a concurrent save', () => {
  it('a save built on a stale read fails loudly with its own message, re-fetches the workout, and a deliberate retry lands on the fresh version', async () => {
    let current = versionOf(singlePod, seededAt)
    let getCalls = 0
    const attempts: DateTime.Utc[] = []

    renderEditor({
      GetWorkout: () => {
        getCalls++
        return Effect.succeed(current)
      },
      ListWorkouts: () => Effect.succeed([current]),
      UpdateWorkout: (payload) => {
        const p = payload as { id: WorkoutId; workout: Workout; updatedAt: DateTime.Utc }
        attempts.push(p.updatedAt)
        if (DateTime.toEpochMillis(p.updatedAt) !== DateTime.toEpochMillis(current.updatedAt)) {
          return Effect.fail(new WorkoutConflict({ id: p.id }))
        }
        current = versionOf(p.workout, editedElsewhereAt)
        return Effect.succeed(current)
      },
    })

    await screen.findByTestId('workout-editor-screen')
    const callsAtLoad = getCalls

    // Another device saves while this editor sits open on the version it read.
    current = versionOf(singlePod, editedElsewhereAt)

    fireEvent.change(screen.getAllByTestId('station-name-input')[0], {
      target: { value: 'Ski erg' },
    })
    fireEvent.click(screen.getByTestId('editor-save'))

    // Loud, and distinct from the generic save failure.
    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('Saved somewhere else', {
        description:
          'This workout changed on another device. Your edits are still here — save again to apply them on top.',
      })
    })
    // Still in the editor with the edit intact — nothing clobbered, nothing lost.
    expect(screen.getByTestId('workout-editor-screen')).toBeTruthy()
    expect(screen.getAllByTestId<HTMLInputElement>('station-name-input')[0].value).toBe('Ski erg')
    // And it re-fetched, so the editor now holds the winner's version.
    await waitFor(() => {
      expect(getCalls).toBeGreaterThan(callsAtLoad)
    })

    // A deliberate second save carries that fresh version, and lands.
    fireEvent.click(screen.getByTestId('editor-save'))
    await screen.findByTestId('workout-detail-screen')
    expect(attempts).toHaveLength(2)
    expect(DateTime.toEpochMillis(attempts[0])).toBe(DateTime.toEpochMillis(seededAt))
    expect(DateTime.toEpochMillis(attempts[1])).toBe(DateTime.toEpochMillis(editedElsewhereAt))
    expect(current.workout.pods[0].stations[0].name).toBe('Ski erg')
  })
})
