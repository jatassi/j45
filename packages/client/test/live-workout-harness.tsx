import * as React from 'react'

import { RegistryProvider, Result, useAtomRefresh } from '@effect-atom/atom-react'
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
} from '@tanstack/react-router'
import { act, render } from '@testing-library/react'
import * as DateTime from 'effect/DateTime'
import type * as Effect from 'effect/Effect'
import * as Runtime from 'effect/Runtime'
import * as Schema from 'effect/Schema'

import { LibraryScreen } from '@/components/library-screen'
import { WorkoutDetailScreen } from '@/components/workout-detail-screen'
import { EditWorkoutScreen, ReflowWorkoutScreen } from '@/components/workout-editor-screen'
import { listActiveSessionsAtom } from '@/lib/live-workout'
import { ServerRpcClient } from '@/lib/rpc-client'

/**
 * The shared fixture for the two live-workout prompt suites (save and
 * delete). It is the same fake-runtime idiom `workout-detail-screen.test.tsx`
 * and `workout-editor-screen.test.tsx` use, lifted into one module so both
 * suites drive the library → detail → editor route tree without either file
 * growing a second copy of it.
 */

export type Handlers = Partial<
  Record<string, (payload: unknown) => Effect.Effect<unknown, unknown>>
>

const seededAt = DateTime.unsafeMake('2026-01-01T00:00:00.000Z')

export const athleticaId = Schema.decodeSync(WorkoutId)('workout-athletica')
export const otherWorkoutId = Schema.decodeSync(WorkoutId)('workout-ladder')

/** Athletica: one pod of three stations, uniform laps — enough body to edit. */
export const athletica = new LibraryWorkout({
  id: athleticaId,
  workout: new Workout({
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
    ],
    flow: new Flow({ type: 'laps', rounds: [new Round({ workSeconds: 40, restSeconds: 20 })] }),
  }),
  createdAt: seededAt,
  updatedAt: seededAt,
})

/** One lobby row, as `ListActiveSessions` returns it. */
export const liveSessionOf = (id: string, workoutId: WorkoutId) =>
  new SessionSummary({
    id: Schema.decodeSync(SessionId)(id),
    workoutId,
    hostDisplayName: 'Alex',
    workoutName: 'Athletica',
    startedAt: seededAt,
    participantCount: 2,
  })

/** The workout body a save carries back, so `UpdateWorkout` can answer with it. */
export const libraryWorkoutOf = (workout: Workout) =>
  new LibraryWorkout({ id: athleticaId, workout, createdAt: seededAt, updatedAt: seededAt })

let refreshSessions: (() => void) | undefined

/**
 * Reads the lobby again, the way home's 5s poll does. A test calls it to
 * change the lobby under a screen that is already open — a session that
 * starts, or one that ends. Render with `pollsSessions` first.
 */
export const refreshActiveSessions = () => {
  if (refreshSessions === undefined) {
    throw new Error('refreshActiveSessions needs renderApp with pollsSessions')
  }
  act(refreshSessions)
}

/**
 * Holds the lobby atom open for the whole render, so a test can refresh it.
 * It is opt-in: it gives the atom a longer life than any screen has in the
 * app, and no test must get that for free.
 */
function ActiveSessionsProbe() {
  const refresh = useAtomRefresh(listActiveSessionsAtom)
  React.useEffect(() => {
    refreshSessions = refresh
    return () => {
      refreshSessions = undefined
    }
  }, [refresh])
  return null
}

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

/** What a render can turn on beyond the routes themselves. */
export type RenderOptions = {
  /** Keep the lobby atom open, so `refreshActiveSessions` can read it again. */
  readonly pollsSessions?: boolean
}

/** Mounts library, detail, editor and launch-mode routes over memory history. */
export function renderApp(handlers: Handlers, initialPath: string, options: RenderOptions = {}) {
  const fakeRuntime = makeFakeRuntime(handlers)
  const rootRoute = createRootRoute({ component: Outlet })
  const libraryRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/library',
    component: LibraryScreen,
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
  const reflowRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/workouts/$workoutId/reflow',
    component: ReflowWorkoutScreen,
  })
  const testRouter = createRouter({
    routeTree: rootRoute.addChildren([libraryRoute, detailRoute, editRoute, reflowRoute]),
    history: createMemoryHistory({ initialEntries: [initialPath] }),
  })

  render(
    <RegistryProvider initialValues={[[ServerRpcClient.runtime, Result.success(fakeRuntime)]]}>
      {options.pollsSessions === true ? <ActiveSessionsProbe /> : undefined}
      <RouterProvider router={testRouter} />
    </RegistryProvider>,
  )
}
