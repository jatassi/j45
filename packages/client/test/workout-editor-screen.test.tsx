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
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import * as DateTime from 'effect/DateTime'
import * as Effect from 'effect/Effect'
import * as Runtime from 'effect/Runtime'
import * as Schema from 'effect/Schema'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { LibraryScreen } from '@/components/library-screen'
import { WorkoutDetailScreen } from '@/components/workout-detail-screen'
import { EditWorkoutScreen, NewWorkoutScreen } from '@/components/workout-editor-screen'
import { setInitialDraft, takeInitialDraft } from '@/lib/editor-draft'
import { ServerRpcClient } from '@/lib/rpc-client'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  // Drain any leftover one-shot handoff so tests stay isolated.
  takeInitialDraft()
})

type Handlers = Partial<Record<string, (payload: unknown) => Effect.Effect<unknown, unknown>>>

/** Fake rpc runtime — the same idiom `workout-detail-screen.test.tsx` uses. */
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

/** Athletica: 3 pods × 3 stations, uniform laps 40″/20″ × 3 — domain golden 27 works · 26:45. */
const athleticaWorkout = new Workout({
  name: 'Athletica',
  focus: 'cardio',
  pods: [
    new Pod({
      name: 'Pod 1',
      stations: [
        new Station({ name: 'Rower' }),
        new Station({ name: 'Squat press' }),
        new Station({ name: 'Burpee' }),
      ],
    }),
    new Pod({
      name: 'Pod 2',
      stations: [
        new Station({ name: 'Bike' }),
        new Station({ name: 'Swing' }),
        new Station({ name: 'Climbers' }),
      ],
    }),
    new Pod({
      name: 'Pod 3',
      stations: [
        new Station({ name: 'Snatch' }),
        new Station({ name: 'Step-ups' }),
        new Station({ name: 'Slam ball' }),
      ],
    }),
  ],
  flow: new Flow({
    type: 'laps',
    rounds: [
      new Round({ workSeconds: 40, restSeconds: 20 }),
      new Round({ workSeconds: 40, restSeconds: 20 }),
      new Round({ workSeconds: 40, restSeconds: 20 }),
    ],
  }),
})

const athletica = new LibraryWorkout({
  id: Schema.decodeSync(WorkoutId)('workout-athletica'),
  workout: athleticaWorkout,
  createdAt: seededAt,
  updatedAt: seededAt,
})

const libraryWorkoutOf = (id: string, workout: Workout) =>
  new LibraryWorkout({
    id: Schema.decodeSync(WorkoutId)(id),
    workout,
    createdAt: seededAt,
    updatedAt: seededAt,
  })

/** A full route tree (library, detail, new, edit) over memory history. */
function renderApp(handlers: Handlers, initialPath: string) {
  const fakeRuntime = makeFakeRuntime(handlers)
  const rootRoute = createRootRoute({ component: Outlet })
  const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/',
    component: LibraryScreen,
  })
  const newRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/workouts/new',
    component: NewWorkoutScreen,
  })
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
    routeTree: rootRoute.addChildren([indexRoute, newRoute, detailRoute, editRoute]),
    history: createMemoryHistory({ initialEntries: [initialPath] }),
  })
  render(
    <RegistryProvider initialValues={[[ServerRpcClient.runtime, Result.success(fakeRuntime)]]}>
      <RouterProvider router={testRouter} />
    </RegistryProvider>,
  )
}

describe('WorkoutEditorScreen', () => {
  it('builds a workout through the editor controls (meta, pods, stations, move, flow, uniform rounds) and CreateWorkout receives the exact body, then opens its detail', async () => {
    let created: Workout | undefined
    renderApp(
      {
        CreateWorkout: (payload) => {
          created = (payload as { workout: Workout }).workout
          return Effect.succeed(libraryWorkoutOf('workout-new', created))
        },
        GetWorkout: () =>
          Effect.succeed(libraryWorkoutOf('workout-new', created ?? athleticaWorkout)),
      },
      '/workouts/new',
    )

    await screen.findByTestId('workout-editor-screen')

    fireEvent.change(screen.getByTestId('editor-name'), { target: { value: 'Grinder' } })
    fireEvent.change(screen.getByTestId('editor-focus'), { target: { value: 'strength' } })
    fireEvent.change(screen.getByTestId('editor-note'), { target: { value: 'go hard' } })
    fireEvent.change(screen.getByTestId('pod-name-input'), { target: { value: 'Circuit' } })

    // First station, then add a second and move it above the first.
    fireEvent.change(screen.getByTestId('station-name-input'), { target: { value: 'Rower' } })
    fireEvent.click(screen.getByTestId('add-station'))
    const names = screen.getAllByTestId('station-name-input')
    fireEvent.change(names[1], { target: { value: 'Burpee' } })
    fireEvent.click(screen.getAllByTestId('station-up')[1])

    // Flow: sets, 3 uniform rounds of 30″/10″.
    fireEvent.change(screen.getByTestId('editor-flow-type'), { target: { value: 'sets' } })
    fireEvent.change(screen.getByTestId('editor-round-count'), { target: { value: '3' } })
    fireEvent.change(screen.getByTestId('editor-uniform-work'), { target: { value: '30' } })
    fireEvent.change(screen.getByTestId('editor-uniform-rest'), { target: { value: '10' } })

    fireEvent.click(screen.getByTestId('editor-save'))

    await screen.findByTestId('workout-detail-screen')
    expect(created).toBeDefined()
    expect(created?.name).toBe('Grinder')
    expect(created?.focus).toBe('strength')
    expect(created?.note).toBe('go hard')
    expect(created?.pods).toHaveLength(1)
    expect(created?.pods[0].name).toBe('Circuit')
    expect(created?.pods[0].stations.map((s) => s.name)).toEqual(['Burpee', 'Rower'])
    expect(created?.flow.type).toBe('sets')
    expect(created?.flow.rounds).toHaveLength(3)
    expect(created?.flow.rounds.every((r) => r.workSeconds === 30 && r.restSeconds === 10)).toBe(
      true,
    )
  })

  it('summary chip reads exactly "27 works · 26:45" for the untouched Athletica draft; clearing a station name disables Save and shows an error', async () => {
    renderApp({ GetWorkout: () => Effect.succeed(athletica) }, `/workouts/${athletica.id}/edit`)

    await screen.findByTestId('workout-editor-screen')
    expect(screen.getByTestId('editor-summary').textContent).toBe('27 works · 26:45')
    expect(screen.getByTestId<HTMLButtonElement>('editor-save').disabled).toBe(false)

    fireEvent.change(screen.getAllByTestId('station-name-input')[0], { target: { value: '' } })

    await screen.findByTestId('editor-error')
    expect(screen.queryByTestId('editor-summary')).toBeNull()
    expect(screen.getByTestId<HTMLButtonElement>('editor-save').disabled).toBe(true)
  })

  it('edit: switches laps→sets, renames a station and reorders it, and UpdateWorkout receives the changed body while the list + GetWorkout atoms refresh', async () => {
    let current = athletica
    let updatePayload: { id: WorkoutId; workout: Workout } | undefined
    let getCalls = 0
    renderApp(
      {
        GetWorkout: () => {
          getCalls++
          return Effect.succeed(current)
        },
        ListWorkouts: () => Effect.succeed([current]),
        UpdateWorkout: (payload) => {
          updatePayload = payload as { id: WorkoutId; workout: Workout }
          current = libraryWorkoutOf(current.id, updatePayload.workout)
          return Effect.succeed(current)
        },
      },
      `/workouts/${athletica.id}/edit`,
    )

    await screen.findByTestId('workout-editor-screen')
    const callsAtLoad = getCalls

    fireEvent.change(screen.getByTestId('editor-flow-type'), { target: { value: 'sets' } })
    fireEvent.change(screen.getAllByTestId('station-name-input')[0], {
      target: { value: 'Ski erg' },
    })
    fireEvent.click(screen.getAllByTestId('station-down')[0])

    fireEvent.click(screen.getByTestId('editor-save'))

    await screen.findByTestId('workout-detail-screen')
    expect(updatePayload?.id).toBe(athletica.id)
    expect(updatePayload?.workout.flow.type).toBe('sets')
    expect(updatePayload?.workout.pods[0].stations.map((s) => s.name)).toEqual([
      'Squat press',
      'Ski erg',
      'Burpee',
    ])
    // The detail refetches: GetWorkout ran again after the update (refreshWorkout()).
    await waitFor(() => {
      expect(getCalls).toBeGreaterThan(callsAtLoad)
    })
  })

  it("the library's New workout button opens the blank editor; the detail's Edit action opens the editor loaded from GetWorkout", async () => {
    renderApp({ ListWorkouts: () => Effect.succeed([]) }, '/')
    await screen.findByTestId('new-workout-button')
    fireEvent.click(screen.getByTestId('new-workout-button'))
    await screen.findByTestId('workout-editor-screen')
    expect(screen.getByTestId<HTMLInputElement>('editor-name').value).toBe('')

    cleanup()

    renderApp(
      {
        GetWorkout: () => Effect.succeed(athletica),
        ListWorkouts: () => Effect.succeed([athletica]),
      },
      `/workouts/${athletica.id}`,
    )
    await screen.findByTestId('edit-button')
    fireEvent.click(screen.getByTestId('edit-button'))
    await screen.findByTestId('workout-editor-screen')
    expect(screen.getByTestId<HTMLInputElement>('editor-name').value).toBe('Athletica')
  })

  it('Cancel navigates away without calling any mutation', async () => {
    renderApp({ ListWorkouts: () => Effect.succeed([]) }, '/workouts/new')
    await screen.findByTestId('workout-editor-screen')

    fireEvent.click(screen.getByTestId('editor-cancel'))

    await screen.findByTestId('library-screen')
    // The fake runtime throws on any unexpected rpc; reaching the library with
    // only ListWorkouts registered proves no CreateWorkout fired.
  })

  it('with a pending draft, NewWorkoutScreen seeds name, pods, stations, and flow; without one, the blank editor renders', async () => {
    setInitialDraft(athleticaWorkout)
    renderApp({ ListWorkouts: () => Effect.succeed([]) }, '/workouts/new')

    await screen.findByTestId('workout-editor-screen')
    expect(screen.getByTestId<HTMLInputElement>('editor-name').value).toBe('Athletica')
    expect(
      screen.getAllByTestId('pod-name-input').map((el) => (el as HTMLInputElement).value),
    ).toEqual(['Pod 1', 'Pod 2', 'Pod 3'])
    expect(
      screen.getAllByTestId('station-name-input').map((el) => (el as HTMLInputElement).value),
    ).toEqual([
      'Rower',
      'Squat press',
      'Burpee',
      'Bike',
      'Swing',
      'Climbers',
      'Snatch',
      'Step-ups',
      'Slam ball',
    ])
    expect(screen.getByTestId<HTMLSelectElement>('editor-flow-type').value).toBe('laps')
    expect(screen.getByTestId<HTMLInputElement>('editor-round-count').value).toBe('3')
    expect(screen.getByTestId<HTMLInputElement>('editor-uniform-work').value).toBe('40')
    expect(screen.getByTestId<HTMLInputElement>('editor-uniform-rest').value).toBe('20')
    expect(screen.getByTestId('editor-summary').textContent).toBe('27 works · 26:45')

    cleanup()

    // No pending draft → blank editor exactly as before.
    renderApp({ ListWorkouts: () => Effect.succeed([]) }, '/workouts/new')
    await screen.findByTestId('workout-editor-screen')
    expect(screen.getByTestId<HTMLInputElement>('editor-name').value).toBe('')
    expect(screen.getAllByTestId('pod-name-input')).toHaveLength(1)
    expect(screen.getByTestId<HTMLInputElement>('pod-name-input').value).toBe('Pod 1')
    expect(screen.getAllByTestId('station-name-input')).toHaveLength(1)
    expect(screen.getByTestId<HTMLInputElement>('station-name-input').value).toBe('')
    expect(screen.getByTestId<HTMLSelectElement>('editor-flow-type').value).toBe('laps')
    expect(screen.getByTestId<HTMLInputElement>('editor-round-count').value).toBe('1')
  })

  it('takeInitialDraft is one-shot — a remount after consumption yields the blank editor', async () => {
    setInitialDraft(athleticaWorkout)
    renderApp({ ListWorkouts: () => Effect.succeed([]) }, '/workouts/new')

    await screen.findByTestId('workout-editor-screen')
    expect(screen.getByTestId<HTMLInputElement>('editor-name').value).toBe('Athletica')

    cleanup()

    // Draft was consumed on first mount; remount must not re-seed.
    renderApp({ ListWorkouts: () => Effect.succeed([]) }, '/workouts/new')
    await screen.findByTestId('workout-editor-screen')
    expect(screen.getByTestId<HTMLInputElement>('editor-name').value).toBe('')
    expect(screen.getAllByTestId('station-name-input')).toHaveLength(1)
    expect(screen.getByTestId<HTMLInputElement>('station-name-input').value).toBe('')
  })
})
