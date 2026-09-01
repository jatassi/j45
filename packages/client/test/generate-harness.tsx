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
  type GenerationConstraints,
} from '@j45/domain'
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router'
import { render, screen } from '@testing-library/react'
import * as DateTime from 'effect/DateTime'
import * as Effect from 'effect/Effect'
import * as Runtime from 'effect/Runtime'
import * as Schema from 'effect/Schema'

import { GenerateScreen } from '@/components/generate-screen'
import { LibraryScreen } from '@/components/library-screen'
import { WorkoutDetailScreen } from '@/components/workout-detail-screen'
import { NewWorkoutScreen } from '@/components/workout-editor-screen'
import { ServerRpcClient } from '@/lib/rpc-client'

/**
 * The scaffolding that the generate-screen suites share: a fake rpc runtime
 * that captures the payload, the golden workout fixture, the route tree, and
 * the helpers that read a chip state, a field value and a disabled state.
 *
 * The scaffolding lived in `generate-screen.test.tsx` until the file reached
 * the line limit. It moves here as it stands, beside `home-harness.tsx` and
 * `session-harness.tsx`, so that the cases of each ticket have room.
 */

export type Handlers = Partial<
  Record<string, (payload: unknown) => Effect.Effect<unknown, unknown>>
>

/** Fake rpc runtime — the same idiom `workout-editor-screen.test.tsx` uses. */
export function makeFakeRuntime(handlers: Handlers) {
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

/** Athletica: 3 pods × 3 stations, uniform laps 40″/20″ × 3 — domain golden 27 works · 26:45. */
export const athleticaWorkout = new Workout({
  name: 'Iron Falcon',
  focus: 'hybrid',
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

export const libraryWorkoutOf = (id: string, workout: Workout) =>
  new LibraryWorkout({
    id: Schema.decodeSync(WorkoutId)(id),
    workout,
    createdAt: seededAt,
    updatedAt: seededAt,
  })

/** Full route tree covering library home, generate, new editor, and detail. */
export function renderApp(handlers: Handlers, initialPath: string) {
  const fakeRuntime = makeFakeRuntime(handlers)
  const rootRoute = createRootRoute({ component: Outlet })
  const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/',
    component: LibraryScreen,
  })
  const generateRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/generate',
    component: GenerateScreen,
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
  const testRouter = createRouter({
    routeTree: rootRoute.addChildren([indexRoute, generateRoute, newRoute, detailRoute]),
    history: createMemoryHistory({ initialEntries: [initialPath] }),
  })
  render(
    <RegistryProvider initialValues={[[ServerRpcClient.runtime, Result.success(fakeRuntime)]]}>
      <RouterProvider router={testRouter} />
    </RegistryProvider>,
  )
}

/**
 * Renders `/generate` over a fake runtime that records every generate payload,
 * and gives back the list it records into.
 *
 * Several cases read the payload that leaves the screen, and every one of them
 * wants the same fake handler. The handler answers with the golden workout, so
 * a case that presses Generate reaches a preview and can press Regenerate.
 */
export function renderCapturingPayloads(): GenerationConstraints[] {
  const sent: GenerationConstraints[] = []
  renderApp(
    {
      GenerateWorkout: (payload) => {
        sent.push(payload as GenerationConstraints)
        return Effect.succeed(athleticaWorkout)
      },
    },
    '/generate',
  )
  return sent
}

/** The state contract of a chip, for the tests and for assistive technology. */
export const pressed = (testId: string): string | null =>
  screen.getByTestId(testId).getAttribute('aria-pressed')

export const fieldValue = (testId: string): string => {
  const el = screen.getByTestId(testId)
  return el instanceof HTMLInputElement ? el.value : ''
}

export const isDisabled = (testId: string): boolean => {
  const el = screen.getByTestId(testId)
  return el instanceof HTMLButtonElement && el.disabled
}
