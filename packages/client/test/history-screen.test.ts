// @vitest-environment jsdom
import * as React from 'react'

import { RegistryProvider, Result } from '@effect-atom/atom-react'
import {
  CompletionId,
  Flow,
  Participant,
  Pod,
  Round,
  SessionCompletion,
  SessionId,
  Station,
  User,
  UserId,
  Workout,
} from '@j45/domain'
import {
  createMemoryHistory,
  createRootRoute,
  createRootRouteWithContext,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router'
import { cleanup, render, screen } from '@testing-library/react'
import * as DateTime from 'effect/DateTime'
import * as Effect from 'effect/Effect'
import * as Runtime from 'effect/Runtime'
import * as Schema from 'effect/Schema'
import { afterEach, describe, expect, it } from 'vitest'

import { HistoryScreen } from '@/components/history-screen'
import { LibraryScreen } from '@/components/library-screen'
import { ServerRpcClient } from '@/lib/rpc-client'
import type { RouterContext } from '@/router'

afterEach(() => {
  cleanup()
})

/**
 * Builds a `Runtime` that provides `ServerRpcClient` with `handlers` in
 * place of the real (websocket-backed) rpc client — the same fake-runtime
 * idiom `library-screen.test.tsx` uses, seeding `ServerRpcClient.runtime`
 * itself via `RegistryProvider`'s `initialValues` below.
 */
function makeFakeRuntime(
  handlers: Partial<Record<string, (payload: unknown) => Effect.Effect<unknown, unknown>>>,
) {
  const client = (tag: string, payload: unknown) => {
    const handler = handlers[tag]
    if (handler === undefined) {
      throw new Error(`unexpected rpc call: ${tag}`)
    }
    return handler(payload)
  }
  return Runtime.defaultRuntime.pipe(Runtime.provideService(ServerRpcClient, client as never))
}

const caller = Schema.decodeUnknownSync(User)({
  id: 'user-alice',
  username: 'alice',
  displayName: 'Alice',
  role: 'member',
})

const aliceId = Schema.decodeSync(UserId)('user-alice')
const bobId = Schema.decodeSync(UserId)('user-bob')

const alice = new Participant({ userId: aliceId, displayName: 'Alice' })
const bob = new Participant({ userId: bobId, displayName: 'Bob' })
const carol = new Participant({
  userId: Schema.decodeSync(UserId)('user-carol'),
  displayName: 'Carol',
})

const makeWorkout = (name: string) =>
  new Workout({
    name,
    focus: 'cardio',
    pods: [new Pod({ name: 'Pod 1', stations: [new Station({ name: 'Burpee' })] })],
    flow: new Flow({
      type: 'laps',
      rounds: [new Round({ workSeconds: 40, restSeconds: 20 })],
    }),
  })

/** Newer completion: Alice (caller) hosted Athletica with Bob. */
const newerCompletion = new SessionCompletion({
  id: Schema.decodeSync(CompletionId)('completion-newer'),
  sessionId: Schema.decodeSync(SessionId)('session-newer'),
  workoutName: 'Athletica',
  workout: makeWorkout('Athletica'),
  host: alice,
  participants: [alice, bob],
  startedAt: DateTime.unsafeMake('2026-03-01T10:00:00.000Z'),
  endedAt: DateTime.unsafeMake('2026-03-01T10:30:00.000Z'),
})

/** Older completion: Bob hosted Iron Circuit with Alice and Carol. */
const olderCompletion = new SessionCompletion({
  id: Schema.decodeSync(CompletionId)('completion-older'),
  sessionId: Schema.decodeSync(SessionId)('session-older'),
  workoutName: 'Iron Circuit',
  workout: makeWorkout('Iron Circuit'),
  host: bob,
  participants: [bob, alice, carol],
  startedAt: DateTime.unsafeMake('2026-02-01T09:00:00.000Z'),
  endedAt: DateTime.unsafeMake('2026-02-01T09:45:00.000Z'),
})

function formatEndedAt(endedAt: DateTime.Utc): string {
  return DateTime.toDate(endedAt).toLocaleString()
}

/**
 * Mounts `HistoryScreen` at `/history` with a `RouterContext`-supplying root
 * so the screen receives the caller `User` the same way `router.tsx` wires it.
 * JSX is forbidden in this `.ts` file (Vite/esbuild picks the parser by
 * extension), so every element is `React.createElement`.
 */
function renderHistoryScreen(
  handlers: Partial<Record<string, (payload: unknown) => Effect.Effect<unknown, unknown>>>,
  user: User = caller,
) {
  const fakeRuntime = makeFakeRuntime(handlers)
  const rootRoute = createRootRouteWithContext<RouterContext>()({
    component: Outlet,
  })
  const historyRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/history',
    component: () => {
      // Same `as RouterContext` recovery as `accountRoute` in `router.tsx`.
      const { user: routeUser } = historyRoute.useRouteContext() as RouterContext
      return React.createElement(HistoryScreen, { user: routeUser })
    },
  })
  const testRouter = createRouter({
    routeTree: rootRoute.addChildren([historyRoute]),
    history: createMemoryHistory({ initialEntries: ['/history'] }),
    context: {
      user,
      onLoggedOut: () => undefined,
    },
  })

  render(
    React.createElement(
      RegistryProvider,
      { initialValues: [[ServerRpcClient.runtime, Result.success(fakeRuntime)]] },
      React.createElement(RouterProvider, { router: testRouter }),
    ),
  )
}

/**
 * Mounts `LibraryScreen` as `/` so its nav `Link`s have router context —
 * same throwaway-router pattern as `library-screen.test.tsx`.
 */
function renderLibraryScreen(
  handlers: Partial<Record<string, (payload: unknown) => Effect.Effect<unknown, unknown>>>,
) {
  const fakeRuntime = makeFakeRuntime(handlers)
  const rootRoute = createRootRoute({ component: Outlet })
  const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/',
    component: LibraryScreen,
  })
  const testRouter = createRouter({
    routeTree: rootRoute.addChildren([indexRoute]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })

  render(
    React.createElement(
      RegistryProvider,
      { initialValues: [[ServerRpcClient.runtime, Result.success(fakeRuntime)]] },
      React.createElement(RouterProvider, { router: testRouter }),
    ),
  )
}

describe('HistoryScreen', () => {
  it("lists the caller's completions newest-first with name, date, host (you vs name), and participants", async () => {
    // Server already returns newest-first — seed in that order and assert render order.
    renderHistoryScreen({
      ListHistory: () => Effect.succeed([newerCompletion, olderCompletion]),
    })

    await screen.findByTestId(`history-row-${newerCompletion.id}`)

    const rows = screen.getAllByTestId(/^history-row-/)
    expect(rows).toHaveLength(2)
    expect(rows[0]).toBe(screen.getByTestId(`history-row-${newerCompletion.id}`))
    expect(rows[1]).toBe(screen.getByTestId(`history-row-${olderCompletion.id}`))

    expect(screen.getByTestId(`history-name-${newerCompletion.id}`).textContent).toBe('Athletica')
    expect(screen.getByTestId(`history-date-${newerCompletion.id}`).textContent).toBe(
      formatEndedAt(newerCompletion.endedAt),
    )
    expect(screen.getByTestId(`history-host-${newerCompletion.id}`).textContent).toBe('Host: you')
    expect(screen.getByTestId(`history-participants-${newerCompletion.id}`).textContent).toContain(
      'Alice',
    )
    expect(screen.getByTestId(`history-participants-${newerCompletion.id}`).textContent).toContain(
      'Bob',
    )

    expect(screen.getByTestId(`history-name-${olderCompletion.id}`).textContent).toBe(
      'Iron Circuit',
    )
    expect(screen.getByTestId(`history-date-${olderCompletion.id}`).textContent).toBe(
      formatEndedAt(olderCompletion.endedAt),
    )
    expect(screen.getByTestId(`history-host-${olderCompletion.id}`).textContent).toBe('Host: Bob')
    expect(screen.getByTestId(`history-participants-${olderCompletion.id}`).textContent).toContain(
      'Bob',
    )
    expect(screen.getByTestId(`history-participants-${olderCompletion.id}`).textContent).toContain(
      'Alice',
    )
    expect(screen.getByTestId(`history-participants-${olderCompletion.id}`).textContent).toContain(
      'Carol',
    )
  })
})

describe('LibraryScreen history nav', () => {
  it('links to /history from the home nav', async () => {
    renderLibraryScreen({
      ListWorkouts: () => Effect.succeed([]),
      ListActiveSessions: () => Effect.succeed([]),
    })

    const historyLink = await screen.findByTestId('history-nav-link')
    expect(historyLink.getAttribute('href')).toBe('/history')
  })
})
