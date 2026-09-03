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
import { toast } from 'sonner'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { LibraryScreen } from '@/components/library-screen'
import { WorkoutDetailScreen } from '@/components/workout-detail-screen'
import { EditWorkoutScreen, NewWorkoutScreen } from '@/components/workout-editor-screen'
import { setInitialDraft, takeInitialDraft } from '@/lib/editor-draft'
import { ServerRpcClient } from '@/lib/rpc-client'

vi.mock('sonner', () => ({
  toast: { error: vi.fn() },
}))

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.mocked(toast.error).mockClear()
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

/** Athletica: 3 pods × 3 stations, uniform laps 40″/20″ × 3 — domain golden 27 works · 27:10. */
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

const pressed = (testId: string) => screen.getByTestId(testId).getAttribute('aria-pressed')

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
  it('builds a workout through the kit controls (name, focus toggle-group, a station added via the drawer, sets flow with 3 uniform rounds) and CreateWorkout receives the exact body, then opens its detail via the header Save', async () => {
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
    fireEvent.click(screen.getByTestId('editor-focus-strength'))
    fireEvent.change(screen.getByTestId('editor-note'), { target: { value: 'go hard' } })
    fireEvent.change(screen.getByTestId('pod-name-input'), { target: { value: 'Circuit' } })

    // First station, then add a second via the actions drawer and move it above the first.
    fireEvent.change(screen.getByTestId('station-name-input'), { target: { value: 'Rower' } })
    fireEvent.click(screen.getByTestId('editor-station-actions'))
    await screen.findByTestId('editor-station-drawer')
    fireEvent.click(screen.getByTestId('editor-add-station'))
    const names = screen.getAllByTestId('station-name-input')
    fireEvent.change(names[1], { target: { value: 'Burpee' } })
    fireEvent.click(screen.getAllByTestId('station-up')[1])

    // Flow: sets via toggle-group, 3 uniform rounds of 30″/10″.
    fireEvent.click(screen.getByTestId('editor-flow-sets'))
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

  it('sticky chip reads exactly "27 works · 27:10" for the untouched Athletica draft; clearing a station name shows a per-field error at that station and disables Save with no page-level banner', async () => {
    renderApp({ GetWorkout: () => Effect.succeed(athletica) }, `/workouts/${athletica.id}/edit`)

    await screen.findByTestId('workout-editor-screen')
    expect(screen.getByTestId('editor-summary').textContent).toBe('27 works · 27:10')
    expect(screen.getByTestId<HTMLButtonElement>('editor-save').disabled).toBe(false)

    fireEvent.change(screen.getAllByTestId('station-name-input')[0], { target: { value: '' } })

    const stationError = await screen.findByTestId('station-name-error')
    expect(stationError.textContent).not.toBe('')
    // The error pins to the first station's field, not a shared page banner.
    expect(screen.getAllByTestId('station-name-error')).toHaveLength(1)
    expect(screen.queryByTestId('editor-summary')).toBeNull()
    expect(screen.getByTestId<HTMLButtonElement>('editor-save').disabled).toBe(true)
  })

  it('edit: switches laps→sets via the toggle-group, renames a station and reorders it, and UpdateWorkout receives the changed body while the list + GetWorkout atoms refresh', async () => {
    let current = athletica
    let updatePayload: { id: WorkoutId; workout: Workout; updatedAt: DateTime.Utc } | undefined
    let savedVersionMillis = 0
    let getCalls = 0
    renderApp(
      {
        GetWorkout: () => {
          getCalls++
          return Effect.succeed(current)
        },
        ListWorkouts: () => Effect.succeed([current]),
        UpdateWorkout: (payload) => {
          updatePayload = payload as { id: WorkoutId; workout: Workout; updatedAt: DateTime.Utc }
          savedVersionMillis = DateTime.toEpochMillis(updatePayload.updatedAt)
          current = libraryWorkoutOf(current.id, updatePayload.workout)
          return Effect.succeed(current)
        },
      },
      `/workouts/${athletica.id}/edit`,
    )

    await screen.findByTestId('workout-editor-screen')
    const callsAtLoad = getCalls

    fireEvent.click(screen.getByTestId('editor-flow-sets'))
    fireEvent.change(screen.getAllByTestId('station-name-input')[0], {
      target: { value: 'Ski erg' },
    })
    fireEvent.click(screen.getAllByTestId('station-down')[0])

    fireEvent.click(screen.getByTestId('editor-save'))

    await screen.findByTestId('workout-detail-screen')
    expect(updatePayload?.id).toBe(athletica.id)
    // The version the editor read travels with the save — the server's
    // optimistic-concurrency precondition.
    expect(savedVersionMillis).toBe(DateTime.toEpochMillis(athletica.updatedAt))
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

  it('moves a station across pods through the actions drawer (no inline select)', async () => {
    let updatePayload: { id: WorkoutId; workout: Workout } | undefined
    renderApp(
      {
        GetWorkout: () => Effect.succeed(athletica),
        ListWorkouts: () => Effect.succeed([athletica]),
        UpdateWorkout: (payload) => {
          updatePayload = payload as { id: WorkoutId; workout: Workout }
          return Effect.succeed(libraryWorkoutOf(athletica.id, updatePayload.workout))
        },
      },
      `/workouts/${athletica.id}/edit`,
    )

    await screen.findByTestId('workout-editor-screen')
    // No native select anywhere in the rebuilt editor.
    expect(document.querySelector('select')).toBeNull()

    // Open the first station's actions and move it to Pod 2 (index 1).
    fireEvent.click(screen.getAllByTestId('editor-station-actions')[0])
    await screen.findByTestId('editor-station-drawer')
    fireEvent.click(screen.getByTestId('editor-move-to-pod-1'))

    fireEvent.click(screen.getByTestId('editor-save'))

    await screen.findByTestId('workout-detail-screen')
    expect(updatePayload?.workout.pods[0].stations.map((s) => s.name)).toEqual([
      'Squat press',
      'Burpee',
    ])
    expect(updatePayload?.workout.pods[1].stations.map((s) => s.name)).toEqual([
      'Bike',
      'Swing',
      'Climbers',
      'Rower',
    ])
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

  it('a pristine draft backs out with no confirm; an edited draft raises the discard dialog and discarding leaves without persisting', async () => {
    renderApp({ ListWorkouts: () => Effect.succeed([]) }, '/workouts/new')
    await screen.findByTestId('workout-editor-screen')

    // Pristine: the back chevron leaves straight away, no dialog.
    fireEvent.click(screen.getByTestId('back-button'))
    expect(screen.queryByTestId('editor-discard-dialog')).toBeNull()
    await screen.findByTestId('library-screen')

    cleanup()

    // Dirty: editing then backing out raises the alert-dialog confirm.
    renderApp({ ListWorkouts: () => Effect.succeed([]) }, '/workouts/new')
    await screen.findByTestId('workout-editor-screen')
    fireEvent.change(screen.getByTestId('editor-name'), { target: { value: 'WIP' } })
    fireEvent.click(screen.getByTestId('back-button'))
    await screen.findByTestId('editor-discard-dialog')

    // Discarding returns to the library without any CreateWorkout call (the
    // fake runtime throws on unexpected rpcs, so reaching library proves it).
    fireEvent.click(screen.getByTestId('editor-discard-confirm'))
    await screen.findByTestId('library-screen')
  })

  it('surfaces a sonner toast when CreateWorkout rejects and stays on the editor', async () => {
    renderApp(
      {
        CreateWorkout: () => Effect.fail(new Error('save failed')),
      },
      '/workouts/new',
    )
    await screen.findByTestId('workout-editor-screen')

    fireEvent.change(screen.getByTestId('editor-name'), { target: { value: 'Grinder' } })
    fireEvent.change(screen.getByTestId('station-name-input'), { target: { value: 'Rower' } })
    fireEvent.change(screen.getByTestId('editor-uniform-work'), { target: { value: '30' } })
    fireEvent.change(screen.getByTestId('editor-uniform-rest'), { target: { value: '10' } })

    fireEvent.click(screen.getByTestId('editor-save'))

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('Command failed', {
        description: 'Could not save the workout.',
      })
    })
    expect(screen.getByTestId('workout-editor-screen')).toBeTruthy()
  })

  it('with a pending draft, NewWorkoutScreen seeds name, pods, stations, and flow controls, and consuming it is one-shot — a remount yields the blank editor', async () => {
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
    expect(pressed('editor-flow-laps')).toBe('true')
    expect(screen.getByTestId<HTMLInputElement>('editor-round-count').value).toBe('3')
    expect(screen.getByTestId<HTMLInputElement>('editor-uniform-work').value).toBe('40')
    expect(screen.getByTestId<HTMLInputElement>('editor-uniform-rest').value).toBe('20')
    expect(screen.getByTestId('editor-summary').textContent).toBe('27 works · 27:10')

    cleanup()

    // No pending draft → blank editor exactly as before.
    renderApp({ ListWorkouts: () => Effect.succeed([]) }, '/workouts/new')
    await screen.findByTestId('workout-editor-screen')
    expect(screen.getByTestId<HTMLInputElement>('editor-name').value).toBe('')
    expect(screen.getAllByTestId('pod-name-input')).toHaveLength(1)
    expect(screen.getByTestId<HTMLInputElement>('pod-name-input').value).toBe('Pod 1')
    expect(screen.getAllByTestId('station-name-input')).toHaveLength(1)
    expect(screen.getByTestId<HTMLInputElement>('station-name-input').value).toBe('')
    expect(pressed('editor-flow-laps')).toBe('true')
    expect(screen.getByTestId<HTMLInputElement>('editor-round-count').value).toBe('1')
  })
})
