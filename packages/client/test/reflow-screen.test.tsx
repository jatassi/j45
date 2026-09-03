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
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import * as DateTime from 'effect/DateTime'
import * as Effect from 'effect/Effect'
import * as Runtime from 'effect/Runtime'
import * as Schema from 'effect/Schema'
import type * as Stream from 'effect/Stream'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { WorkoutDetailScreen } from '@/components/workout-detail-screen'
import { ReflowWorkoutScreen } from '@/components/workout-editor-screen'
import { ServerRpcClient } from '@/lib/rpc-client'

import { emptyLobby } from './lobby-feed'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

type Handlers = Partial<
  Record<
    string,
    (payload: unknown) => Effect.Effect<unknown, unknown> | Stream.Stream<unknown, unknown>
  >
>

/** Fake rpc runtime — same idiom as `workout-editor-screen.test.tsx`. */
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

const sampleSession = new SessionSummary({
  id: Schema.decodeSync(SessionId)('session-reflow-1'),
  workoutId: Schema.decodeSync(WorkoutId)('workout-athletica'),
  hostDisplayName: 'Alex',
  workoutName: 'Athletica',
  startedAt: seededAt,
  participantCount: 1,
})

/** Stand-in destination for `/session/<id>` navigation. */
function SessionDestination() {
  const { sessionId } = useParams({ strict: false }) as { sessionId: string }
  return <div data-testid={`session-screen-${sessionId}`} />
}

/** Route tree: reflow + detail + session over memory history. */
function renderApp(handlers: Handlers, initialPath: string) {
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
    history: createMemoryHistory({ initialEntries: [initialPath] }),
  })
  render(
    <RegistryProvider initialValues={[[ServerRpcClient.runtime, Result.success(fakeRuntime)]]}>
      <RouterProvider router={testRouter} />
    </RegistryProvider>,
  )
}

const pressed = (testId: string) => screen.getByTestId(testId).getAttribute('aria-pressed')

describe('ReflowWorkoutScreen', () => {
  it('renders reflow-editor-screen, PushHeader titled "Launch setup", back-button; start/save disabled while invalid, enabled when valid', async () => {
    renderApp({ GetWorkout: () => Effect.succeed(athletica) }, `/workouts/${athletica.id}/reflow`)

    await screen.findByTestId('reflow-editor-screen')
    expect(screen.getByRole('heading', { name: 'Launch setup' })).toBeTruthy()
    expect(screen.getByTestId('back-button')).toBeTruthy()

    const start = screen.getByTestId<HTMLButtonElement>('reflow-start')
    const save = screen.getByTestId<HTMLButtonElement>('reflow-save')
    expect(start.disabled).toBe(false)
    expect(save.disabled).toBe(false)

    // Empty every station out of Pod 1 via the actions drawer → draft is Left.
    for (let i = 0; i < 3; i++) {
      fireEvent.click(screen.getAllByTestId('reflow-station-actions')[0])
      await screen.findByTestId('reflow-station-drawer')
      fireEvent.click(screen.getByTestId('reflow-remove-station'))
    }

    expect(screen.getByTestId<HTMLButtonElement>('reflow-start').disabled).toBe(true)
    expect(screen.getByTestId<HTMLButtonElement>('reflow-save').disabled).toBe(true)
  })

  it('station names are read-only text; cross-pod move is drawer-only (no select); pod/flow controls still mutate the draft', async () => {
    let updatePayload: { id: WorkoutId; workout: Workout; updatedAt: DateTime.Utc } | undefined
    renderApp(
      {
        GetWorkout: () => Effect.succeed(athletica),
        ListWorkouts: () => Effect.succeed([athletica]),
        UpdateWorkout: (payload) => {
          updatePayload = payload as { id: WorkoutId; workout: Workout; updatedAt: DateTime.Utc }
          return Effect.succeed(libraryWorkoutOf(athletica.id, updatePayload.workout))
        },
      },
      `/workouts/${athletica.id}/reflow`,
    )

    await screen.findByTestId('reflow-editor-screen')

    // Station names: plain text only — never editable inputs, never add-station.
    const names = screen.getAllByTestId('reflow-station-name').map((el) => el.textContent)
    expect(names).toEqual([
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
    expect(screen.queryByTestId('station-name-input')).toBeNull()
    expect(screen.queryByTestId('reflow-add-station')).toBeNull()
    expect(screen.queryByTestId('editor-add-station')).toBeNull()
    // No native select anywhere (old inline move-to-pod is gone).
    expect(document.querySelector('select')).toBeNull()

    // Cross-pod move via the station actions drawer.
    fireEvent.click(screen.getAllByTestId('reflow-station-actions')[0])
    await screen.findByTestId('reflow-station-drawer')
    // Drawer must not offer add-station.
    expect(
      within(screen.getByTestId('reflow-station-drawer')).queryByTestId('reflow-add-station'),
    ).toBeNull()
    fireEvent.click(screen.getByTestId('reflow-move-to-pod-1'))

    // Pod rename + add stay active.
    fireEvent.change(screen.getAllByTestId('reflow-pod-name-input')[0], {
      target: { value: 'Alpha' },
    })
    fireEvent.click(screen.getByTestId('reflow-add-pod'))
    expect(screen.getAllByTestId('reflow-pod-editor')).toHaveLength(4)
    // New empty pod would invalidate — remove it again so save can succeed.
    const emptyPod = screen
      .getAllByTestId('reflow-pod-editor')
      .find((pod) => within(pod).queryAllByTestId('reflow-station-name').length === 0)
    expect(emptyPod).toBeDefined()
    if (emptyPod !== undefined) {
      fireEvent.click(within(emptyPod).getByTestId('reflow-remove-pod'))
    }

    // Flow: laps→sets via toggle-group, round count stepper, uniform stays on.
    expect(pressed('reflow-flow-laps')).toBe('true')
    fireEvent.click(screen.getByTestId('reflow-flow-sets'))
    expect(pressed('reflow-flow-sets')).toBe('true')
    fireEvent.change(screen.getByTestId('reflow-round-count'), { target: { value: '2' } })
    expect(screen.getByTestId<HTMLInputElement>('reflow-round-count').value).toBe('2')
    // Uniform is a kit checkbox (not a bare <input type="checkbox">).
    expect(screen.getByTestId('reflow-uniform')).toBeTruthy()

    fireEvent.click(screen.getByTestId('reflow-save'))
    await screen.findByTestId('workout-detail-screen')

    // Rower moved from Pod 1 → Pod 2 (append); Pod 1 renamed Alpha; flow sets × 2.
    expect(updatePayload?.workout.pods[0].name).toBe('Alpha')
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
    expect(updatePayload?.workout.flow.type).toBe('sets')
    expect(updatePayload?.workout.flow.rounds).toHaveLength(2)
  })

  it('chip reads reflowSummary format and updates after edit; Start and Save invoke the expected RPCs and navigate', async () => {
    let startPayload: { workoutId: WorkoutId; reflow: ReflowRequest } | undefined
    let updatePayload: { id: WorkoutId; workout: Workout; updatedAt: DateTime.Utc } | undefined
    // Read off the payloads inside the handlers: the assertions below then
    // need no optional chaining, which this file's complexity budget notices.
    let startSourceMillis = 0
    let updateVersionMillis = 0
    let current = athletica

    // --- Start path ---
    renderApp(
      {
        GetWorkout: () => Effect.succeed(athletica),
        ListWorkouts: () => Effect.succeed([athletica]),
        WatchActiveSessions: emptyLobby,
        StartSession: (payload) => {
          startPayload = payload as { workoutId: WorkoutId; reflow: ReflowRequest }
          startSourceMillis = DateTime.toEpochMillis(startPayload.reflow.sourceUpdatedAt)
          return Effect.succeed(sampleSession)
        },
      },
      `/workouts/${athletica.id}/reflow`,
    )

    await screen.findByTestId('reflow-editor-screen')
    expect(screen.getByTestId('reflow-summary').textContent).toBe('27 works · 27:10')

    // Edit work seconds → chip recomputes (uniform 30″/20″ × 3).
    fireEvent.change(screen.getByTestId('reflow-uniform-work'), { target: { value: '30' } })
    await waitFor(() => {
      expect(screen.getByTestId('reflow-summary').textContent).not.toBe('27 works · 27:10')
    })
    const afterEdit = screen.getByTestId('reflow-summary').textContent
    expect(afterEdit).toMatch(/^\d+ works · \d+:\d{2}$/)

    fireEvent.click(screen.getByTestId('reflow-start'))
    await screen.findByTestId(`session-screen-${sampleSession.id}`)
    expect(startPayload?.workoutId).toBe(athletica.id)
    expect(startPayload?.reflow.spec.flowType).toBe('laps')
    expect(startPayload?.reflow.spec.rounds).toBeDefined()
    expect(startPayload?.reflow.spec.rounds?.[0].workSeconds).toBe(30)
    expect(startPayload?.reflow.spec.pods).toHaveLength(3)
    // The spec's indices only mean anything against the version it was built
    // from, so the launch carries that version with it.
    expect(startSourceMillis).toBe(DateTime.toEpochMillis(athletica.updatedAt))

    cleanup()

    // --- Save to plan path ---
    renderApp(
      {
        GetWorkout: () => Effect.succeed(current),
        ListWorkouts: () => Effect.succeed([current]),
        UpdateWorkout: (payload) => {
          updatePayload = payload as { id: WorkoutId; workout: Workout; updatedAt: DateTime.Utc }
          updateVersionMillis = DateTime.toEpochMillis(updatePayload.updatedAt)
          current = libraryWorkoutOf(current.id, updatePayload.workout)
          return Effect.succeed(current)
        },
      },
      `/workouts/${athletica.id}/reflow`,
    )

    await screen.findByTestId('reflow-editor-screen')
    fireEvent.click(screen.getByTestId('reflow-flow-sets'))
    fireEvent.click(screen.getByTestId('reflow-save'))
    await screen.findByTestId('workout-detail-screen')
    expect(updatePayload?.id).toBe(athletica.id)
    expect(updatePayload?.workout.flow.type).toBe('sets')
    expect(updatePayload?.workout.name).toBe('Athletica')
    expect(updateVersionMillis).toBe(DateTime.toEpochMillis(athletica.updatedAt))
  })
})
