// @vitest-environment jsdom
import { RegistryProvider, Result } from '@effect-atom/atom-react'
import { SessionId, SessionSummary } from '@j45/domain'
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
  useParams,
} from '@tanstack/react-router'
import { cleanup, render, screen } from '@testing-library/react'
import * as Effect from 'effect/Effect'
import * as Runtime from 'effect/Runtime'
import * as Schema from 'effect/Schema'
import type * as Stream from 'effect/Stream'
import { afterEach, describe, expect, it } from 'vitest'

import { HomeScreen } from '@/components/home-screen'
import { TabBar } from '@/components/shell/tab-bar'
import { ServerRpcClient } from '@/lib/rpc-client'

import {
  ironCircuit,
  liveSession,
  makeCompletion,
  athletica as secondWorkout,
} from './home-harness'
import { makeLobby } from './lobby-feed'

afterEach(() => {
  cleanup()
})

/**
 * Home and the tab bar together, as the tab layout mounts them: one lobby
 * subscription feeds both. This suite exists for the two claims no
 * single-component test can make — that the count agrees with the list home
 * shows at the same moment, and that the indicator joins the subscription
 * home already holds instead of opening a second one that could disagree
 * with it.
 */

/** A second live row, so a published change moves both the count and the list. */
const secondSession = new SessionSummary({
  id: Schema.decodeSync(SessionId)('session-live-2'),
  workoutId: liveSession.workoutId,
  hostDisplayName: 'Sam',
  workoutName: liveSession.workoutName,
  startedAt: liveSession.startedAt,
  participantCount: 3,
})

/** Stand-in destination so a session link has somewhere to go. */
function SessionDestination() {
  const { sessionId } = useParams({ strict: false }) as { sessionId: string }
  return <div data-testid={`session-screen-${sessionId}`} />
}

/**
 * Mounts home under the tab bar over one registry, and counts every
 * `WatchActiveSessions` subscription the two of them open between them.
 */
function renderHomeUnderTabBar(lobby: () => Stream.Stream<readonly SessionSummary[], unknown>): {
  readonly subscriptions: () => number
} {
  let subscriptions = 0
  const handlers: Partial<
    Record<string, () => Effect.Effect<unknown, unknown> | Stream.Stream<unknown, unknown>>
  > = {
    WatchActiveSessions: () => {
      subscriptions += 1
      return lobby()
    },
    ListHistory: () => Effect.succeed([makeCompletion('c-1', 'Iron Circuit', ironCircuit.id)]),
    ListWorkouts: () => Effect.succeed([ironCircuit, secondWorkout]),
  }
  const client = (tag: string) => {
    const handler = handlers[tag]
    if (handler === undefined) {
      throw new Error(`unexpected rpc call: ${tag}`)
    }
    return handler()
  }
  const fakeRuntime = Runtime.defaultRuntime.pipe(
    Runtime.provideService(ServerRpcClient, client as never),
  )

  const rootRoute = createRootRoute({ component: Outlet })
  const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/',
    component: () => (
      <>
        <HomeScreen />
        <TabBar />
      </>
    ),
  })
  const libraryRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/library',
    component: TabBar,
  })
  const generateRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/generate',
    component: () => <div data-testid="generate-destination" />,
  })
  const timerRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/timer',
    component: () => <div data-testid="timer-destination" />,
  })
  const newWorkoutRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/workouts/new',
    component: () => <div data-testid="new-workout-destination" />,
  })
  const workoutDetailRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/workouts/$workoutId',
    component: () => <div data-testid="workout-detail-destination" />,
  })
  const sessionRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/session/$sessionId',
    component: SessionDestination,
  })
  const testRouter = createRouter({
    routeTree: rootRoute.addChildren([
      indexRoute,
      libraryRoute,
      generateRoute,
      timerRoute,
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
  return { subscriptions: () => subscriptions }
}

/** How many live-session links home shows right now. */
const homeSessionCards = (): number =>
  document.querySelectorAll('[data-testid^="session-card-"]').length

describe('tab-bar count against the home list', () => {
  it('reads one subscription with home, and its count matches the rows home lists', async () => {
    const lobby = makeLobby([liveSession])
    const { subscriptions } = renderHomeUnderTabBar(lobby.handler)

    const indicator = await screen.findByTestId('tab-live-count')
    expect(indicator.textContent).toBe('1')
    expect(homeSessionCards()).toBe(1)

    await lobby.publish([liveSession, secondSession])
    expect(screen.getByTestId('tab-live-count').textContent).toBe('2')
    expect(homeSessionCards()).toBe(2)

    // One atom, one subscription. A second one could answer differently, and
    // then the count would contradict the list on the same screen.
    expect(subscriptions()).toBe(1)
  })
})
