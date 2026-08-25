// @vitest-environment jsdom
import { RegistryProvider, Result } from '@effect-atom/atom-react'
import {
  compile,
  Flow,
  Participant,
  Pod,
  Round,
  SessionState,
  Station,
  UserId,
  Workout,
  type SessionEnd,
  type SessionId,
  type TimerState,
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
import * as Effect from 'effect/Effect'
import * as Queue from 'effect/Queue'
import * as Runtime from 'effect/Runtime'
import * as Schema from 'effect/Schema'
import * as Stream from 'effect/Stream'

import { SessionScreen } from '@/components/session-screen'
import { ServerRpcClient } from '@/lib/rpc-client'

/**
 * The shared mount for every `SessionScreen` test: the compiled fixture, the
 * snapshot builders, the fake rpc runtime, and the memory router. Two suites
 * use it — the screen's own tests and the plan-change notice tests — so the
 * fixture stays one description of one session.
 *
 * Each suite mocks `@/player/audio` and `sonner` itself: a `vi.mock` is
 * hoisted per test module and cannot live here.
 */

/** Fake rpc runtime — the shared idiom from `library-screen.test.tsx`. */
export function makeFakeRuntime(handlers: Partial<Record<string, (payload: unknown) => unknown>>) {
  const client = (tag: string, payload: unknown) => {
    const handler = handlers[tag]
    if (handler === undefined) {
      throw new Error(`unexpected rpc call: ${tag}`)
    }
    return handler(payload)
  }
  return Runtime.defaultRuntime.pipe(Runtime.provideService(ServerRpcClient, client as never))
}

/**
 * 1 pod ("Pod 1"), 2 stations (Rower w/ detail, Burpee), laps × 2 rounds of
 * 30″/10″. Compiled segments: ready, work Rr1, rest, work Br1, rest, work
 * Rr2, rest, work Br2 — works at indices 1, 3, 5, 7.
 */
export const compiled = compile(
  new Workout({
    name: 'Athletica',
    focus: 'cardio',
    pods: [
      new Pod({
        name: 'Pod 1',
        stations: [
          new Station({ name: 'Rower', detail: '10 cal' }),
          new Station({ name: 'Burpee' }),
        ],
      }),
    ],
    flow: new Flow({
      type: 'laps',
      rounds: [
        new Round({ workSeconds: 30, restSeconds: 10 }),
        new Round({ workSeconds: 30, restSeconds: 10 }),
      ],
    }),
  }),
)

export const host = new Participant({
  userId: Schema.decodeSync(UserId)('u-ann'),
  displayName: 'Ann',
})
export const joiner = new Participant({
  userId: Schema.decodeSync(UserId)('u-ben'),
  displayName: 'Ben',
})

export function makeState(id: SessionId, timer: TimerState, serverNow: number): SessionState {
  return new SessionState({
    id,
    host,
    workoutName: 'Athletica',
    compiled,
    timer,
    serverNow,
    // No plan change has landed: the fresh-session case.
    planRevision: 0,
    planChangedBy: null,
    // A live session: the end carries no reason yet.
    ended: null,
    participants: [host, joiner],
  })
}

/**
 * The same snapshot after `revision` plan changes, the last one by
 * `changedBy`. Every field is listed: `SessionState` is a class, and the
 * repo's lint forbids spreading a class instance.
 */
export function withPlanRevision(
  state: SessionState,
  revision: number,
  changedBy: string,
): SessionState {
  return new SessionState({
    id: state.id,
    host: state.host,
    workoutName: state.workoutName,
    compiled: state.compiled,
    timer: state.timer,
    serverNow: state.serverNow,
    participants: state.participants,
    planRevision: revision,
    planChangedBy: changedBy,
    ended: state.ended,
  })
}

/** The last snapshot a session publishes: the same state, plus why it ended. */
export function withEnded(state: SessionState, ended: SessionEnd): SessionState {
  return new SessionState({
    id: state.id,
    host: state.host,
    workoutName: state.workoutName,
    compiled: state.compiled,
    timer: state.timer,
    serverNow: state.serverNow,
    participants: state.participants,
    planRevision: state.planRevision,
    planChangedBy: state.planChangedBy,
    ended,
  })
}

/**
 * Mounts `SessionScreen` at `/session/<id>` in a throwaway memory router
 * whose `/` renders a marker, so a navigate-home is observable. Seeds the
 * fake rpc runtime the same way the other screen tests do.
 */
export function renderSession(
  id: string,
  handlers: Partial<Record<string, (payload: unknown) => unknown>>,
) {
  const fakeRuntime = makeFakeRuntime(handlers)
  const rootRoute = createRootRoute({ component: Outlet })
  const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/',
    component: () => <div data-testid="home-screen" />,
  })
  const sessionRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/session/$sessionId',
    component: SessionScreen,
  })
  const testRouter = createRouter({
    routeTree: rootRoute.addChildren([indexRoute, sessionRoute]),
    history: createMemoryHistory({ initialEntries: [`/session/${id}`] }),
  })
  render(
    <RegistryProvider initialValues={[[ServerRpcClient.runtime, Result.success(fakeRuntime)]]}>
      <RouterProvider router={testRouter} />
    </RegistryProvider>,
  )
  return testRouter
}

/** A live single-state render — the common case for a static snapshot. */
export function renderLive(id: string, state: SessionState) {
  return renderSession(id, { WatchSession: () => liveStream(state) })
}

/** A stream that emits `state` and then stays open (never `ended`). */
export const liveStream = (state: SessionState) =>
  Stream.make(state).pipe(Stream.concat(Stream.never))

/** Offer one snapshot onto a feed queue inside `act`, flushing React effects. */
export const push = (queue: Queue.Queue<SessionState>, state: SessionState) =>
  act(async () => {
    await Effect.runPromise(Queue.offer(queue, state))
  })
