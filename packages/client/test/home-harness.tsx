// @vitest-environment jsdom
import { RegistryProvider, Result } from '@effect-atom/atom-react'
import {
  CompletionId,
  Flow,
  LibraryWorkout,
  Participant,
  Pod,
  Round,
  SessionCompletion,
  SessionId,
  SessionSummary,
  Station,
  UserId,
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
import { render } from '@testing-library/react'
import * as DateTime from 'effect/DateTime'
import * as Effect from 'effect/Effect'
import * as Runtime from 'effect/Runtime'
import * as Schema from 'effect/Schema'

import { HomeScreen } from '@/components/home-screen'
import { ServerRpcClient } from '@/lib/rpc-client'

/**
 * The shared mount and fixtures for the `HomeScreen` suites — the same
 * harness-module idiom as `session-harness.tsx`. `home-screen.test.tsx` covers
 * the screen's composition; `home-identity.test.tsx` covers how it resolves
 * completion records to library workouts.
 */

/** The rpc handler map a `HomeScreen` mount runs against. */
export type Handlers = Partial<
  Record<string, (payload: unknown) => Effect.Effect<unknown, unknown>>
>

/**
 * Builds a `Runtime` that provides `ServerRpcClient` with `handlers` in
 * place of the real (websocket-backed) rpc client — the same fake-runtime
 * idiom `library-screen.test.tsx` / `home-hero.test.tsx` use, seeding
 * `ServerRpcClient.runtime` itself via `RegistryProvider`'s `initialValues`.
 */
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

export const seededAt = DateTime.unsafeMake('2026-01-01T00:00:00.000Z')

export const makeWorkout = (
  name: string,
  focus: 'cardio' | 'strength' | 'hybrid' = 'cardio',
): Workout =>
  new Workout({
    name,
    focus,
    pods: [new Pod({ name: 'Pod 1', stations: [new Station({ name: 'Burpee' })] })],
    flow: new Flow({
      type: 'laps',
      rounds: [new Round({ workSeconds: 40, restSeconds: 20 })],
    }),
  })

export const makeLibraryWorkout = (
  id: string,
  name: string,
  focus: 'cardio' | 'strength' | 'hybrid' = 'cardio',
): LibraryWorkout =>
  new LibraryWorkout({
    id: Schema.decodeSync(WorkoutId)(id),
    workout: makeWorkout(name, focus),
    createdAt: seededAt,
    updatedAt: seededAt,
  })

const alice = new Participant({
  userId: Schema.decodeSync(UserId)('user-alice'),
  displayName: 'Alice',
})

/**
 * A completion record. `sourceWorkoutId` is the identity Home joins on;
 * omitting it models a record written before completions carried one.
 * `workoutName` is free to disagree with the library — that is the point of
 * the join.
 */
export const makeCompletion = (
  id: string,
  workoutName: string,
  sourceWorkoutId?: string,
): SessionCompletion =>
  new SessionCompletion({
    id: Schema.decodeSync(CompletionId)(id),
    sessionId: Schema.decodeSync(SessionId)(`session-for-${id}`),
    workoutName,
    workout: makeWorkout(workoutName),
    host: alice,
    participants: [alice],
    startedAt: seededAt,
    endedAt: seededAt,
    ...(sourceWorkoutId === undefined
      ? {}
      : { sourceWorkoutId: Schema.decodeSync(WorkoutId)(sourceWorkoutId) }),
  })

/** Stand-in destination for `/session/<id>` navigation. */
function SessionDestination() {
  const { sessionId } = useParams({ strict: false }) as { sessionId: string }
  return <div data-testid={`session-screen-${sessionId}`} />
}

/** Stand-in destination for `/workouts/<id>` detail navigation. */
function WorkoutDetailDestination() {
  const { workoutId } = useParams({ strict: false }) as { workoutId: string }
  return <div data-testid={`workout-detail-${workoutId}`} />
}

/**
 * Mounts `HomeScreen` as the `/` route of a throwaway router so its `Link`s
 * and navigates have router context.
 */
export function renderHomeScreen(handlers: Handlers) {
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
  const generateRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/generate',
    component: () => <div data-testid="generate-destination" />,
  })
  const newWorkoutRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/workouts/new',
    component: () => <div data-testid="new-workout-destination" />,
  })
  const workoutDetailRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/workouts/$workoutId',
    component: WorkoutDetailDestination,
  })
  const sessionRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/session/$sessionId',
    component: SessionDestination,
  })
  const testRouter = createRouter({
    routeTree: rootRoute.addChildren([
      indexRoute,
      timerRoute,
      generateRoute,
      newWorkoutRoute,
      workoutDetailRoute,
      sessionRoute,
    ]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })

  render(
    <RegistryProvider initialValues={[[ServerRpcClient.runtime, Result.success(fakeRuntime)]]}>
      <RouterProvider router={testRouter} />
    </RegistryProvider>,
  )
}

export const ironCircuit = makeLibraryWorkout('workout-iron', 'Iron Circuit', 'strength')
export const athletica = makeLibraryWorkout('workout-athletica', 'Athletica', 'cardio')

export const liveSession = new SessionSummary({
  id: Schema.decodeSync(SessionId)('session-live-1'),
  workoutId: ironCircuit.id,
  hostDisplayName: 'Jordan',
  workoutName: 'Iron Circuit',
  startedAt: DateTime.unsafeMake('2026-03-01T09:48:00.000Z'),
  participantCount: 4,
})

export const startedSummary = new SessionSummary({
  id: Schema.decodeSync(SessionId)('session-started-1'),
  workoutId: ironCircuit.id,
  hostDisplayName: 'You',
  workoutName: ironCircuit.workout.name,
  startedAt: seededAt,
  participantCount: 1,
})

/** Default successful handlers for the three home queries. */
export function defaultHandlers(overrides: Handlers = {}): Handlers {
  return {
    ListActiveSessions: () => Effect.succeed([]),
    ListHistory: () => Effect.succeed([makeCompletion('c-1', 'Iron Circuit', ironCircuit.id)]),
    ListWorkouts: () => Effect.succeed([ironCircuit, athletica]),
    ...overrides,
  }
}

/** The `data-testid`s of a recent list's rows, in rendered order. */
export const rowOrder = (list: HTMLElement): readonly (string | undefined)[] =>
  [...list.querySelectorAll('[data-testid^="recent-row-"]')].map(
    (row) => (row as HTMLElement).dataset.testid,
  )
