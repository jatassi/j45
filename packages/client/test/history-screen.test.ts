// @vitest-environment jsdom
import * as React from 'react'

import { RegistryProvider, Result } from '@effect-atom/atom-react'
import {
  CompletionId,
  CompletionProgress,
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
  createRootRouteWithContext,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import * as DateTime from 'effect/DateTime'
import * as Effect from 'effect/Effect'
import * as Runtime from 'effect/Runtime'
import * as Schema from 'effect/Schema'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { HistoryScreen } from '@/components/history-screen'
import { ServerRpcClient } from '@/lib/rpc-client'
import type { RouterContext } from '@/router'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
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

const makeWorkout = (name: string, pods?: readonly [Pod, ...Pod[]]) =>
  new Workout({
    name,
    focus: 'cardio',
    pods: pods ?? [new Pod({ name: 'Pod 1', stations: [new Station({ name: 'Burpee' })] })],
    flow: new Flow({
      type: 'laps',
      rounds: [new Round({ workSeconds: 40, restSeconds: 20 })],
    }),
  })

/** Fixed "now" for relative-date assertions — 2026-03-10T12:00Z. */
const NOW = DateTime.unsafeMake('2026-03-10T12:00:00.000Z')

/** Newer completion: Alice (caller) hosted Athletica with Bob — 3 days before NOW. */
const newerCompletion = new SessionCompletion({
  id: Schema.decodeSync(CompletionId)('completion-newer'),
  sessionId: Schema.decodeSync(SessionId)('session-newer'),
  workoutName: 'Athletica',
  workout: makeWorkout('Athletica', [
    new Pod({
      name: 'Pod Alpha',
      stations: [new Station({ name: 'Rower' }), new Station({ name: 'Burpee' })],
    }),
  ]),
  host: alice,
  participants: [alice, bob],
  startedAt: DateTime.unsafeMake('2026-03-07T10:00:00.000Z'),
  endedAt: DateTime.unsafeMake('2026-03-07T10:30:00.000Z'),
})

/** Older completion: Bob hosted Iron Circuit — more than a week before NOW. */
const olderCompletion = new SessionCompletion({
  id: Schema.decodeSync(CompletionId)('completion-older'),
  sessionId: Schema.decodeSync(SessionId)('session-older'),
  workoutName: 'Iron Circuit',
  workout: makeWorkout('Iron Circuit', [
    new Pod({
      name: 'Strength Pod',
      stations: [new Station({ name: 'Deadlift' }), new Station({ name: 'Bench press' })],
    }),
  ]),
  host: bob,
  participants: [bob, alice, carol],
  startedAt: DateTime.unsafeMake('2026-02-01T09:00:00.000Z'),
  endedAt: DateTime.unsafeMake('2026-02-01T09:45:00.000Z'),
})

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
  const libraryRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/library',
    component: () => React.createElement('div', { 'data-testid': 'library-destination' }),
  })
  const testRouter = createRouter({
    routeTree: rootRoute.addChildren([historyRoute, libraryRoute]),
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

describe('HistoryScreen', () => {
  it("lists the caller's completions newest-first as opaque cards with name, relative/absolute date, host + participant pills", async () => {
    vi.setSystemTime(DateTime.toDate(NOW))

    // Server already returns newest-first — seed in that order and assert render order.
    renderHistoryScreen({
      ListHistory: () => Effect.succeed([newerCompletion, olderCompletion]),
    })

    await screen.findByTestId(`history-row-${newerCompletion.id}`)

    const rows = screen.getAllByTestId(/^history-row-/)
    expect(rows).toHaveLength(2)
    expect(rows[0]).toBe(screen.getByTestId(`history-row-${newerCompletion.id}`))
    expect(rows[1]).toBe(screen.getByTestId(`history-row-${olderCompletion.id}`))

    // Opaque card (kit Card), heavy heading for workout name.
    const newerRow = screen.getByTestId(`history-row-${newerCompletion.id}`)
    expect(newerRow.querySelector('[data-slot="card"]')).not.toBeNull()
    const newerName = screen.getByTestId(`history-name-${newerCompletion.id}`)
    expect(newerName.textContent).toBe('Athletica')
    expect(newerName.className).toMatch(/font-bold/)

    // Relative within last week (3 days before fixed NOW).
    expect(screen.getByTestId(`history-date-${newerCompletion.id}`).textContent).toBe('3 days ago')
    // Absolute after a week.
    expect(screen.getByTestId(`history-date-${olderCompletion.id}`).textContent).toBe(
      DateTime.toDate(olderCompletion.endedAt).toLocaleDateString(),
    )

    // Host + participant pills (kit Badge).
    const hostPill = screen.getByTestId(`history-host-${newerCompletion.id}`)
    expect(hostPill.textContent).toBe('Host: you')
    expect(hostPill.dataset.slot).toBe('badge')

    const participants = screen.getByTestId(`history-participants-${newerCompletion.id}`)
    expect(participants.querySelectorAll('[data-slot="badge"]').length).toBeGreaterThanOrEqual(2)
    expect(participants.textContent).toContain('Alice')
    expect(participants.textContent).toContain('Bob')

    expect(screen.getByTestId(`history-name-${olderCompletion.id}`).textContent).toBe(
      'Iron Circuit',
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

  it('expands a card via accordion to a read-only pod/station summary from the as-run snapshot', async () => {
    vi.setSystemTime(DateTime.toDate(NOW))

    renderHistoryScreen({
      ListHistory: () => Effect.succeed([newerCompletion]),
    })

    const row = await screen.findByTestId(`history-row-${newerCompletion.id}`)

    // Snapshot content is not a library link.
    expect(row.querySelector('a[href*="/workouts/"]')).toBeNull()

    // Expand the accordion item for this completion.
    const trigger = within(row).getByRole('button')
    fireEvent.click(trigger)

    const summary = await screen.findByTestId(`history-snapshot-${newerCompletion.id}`)
    expect(summary.textContent).toContain('Pod Alpha')
    expect(summary.textContent).toContain('Rower')
    expect(summary.textContent).toContain('Burpee')
    // Still not a library navigation target after expand.
    expect(summary.querySelector('a')).toBeNull()
  })

  it('renders Finished when progress is complete, fraction + bar when partial, nothing without progress', async () => {
    vi.setSystemTime(DateTime.toDate(NOW))

    // Done workouts record the last segment index (totalSegments - 1), not a
    // full count — matches `progressOf` on the server.
    const finished = new SessionCompletion({
      id: Schema.decodeSync(CompletionId)('completion-finished'),
      sessionId: Schema.decodeSync(SessionId)('session-finished'),
      workoutName: 'Athletica',
      workout: makeWorkout('Athletica'),
      host: alice,
      participants: [alice, bob],
      startedAt: DateTime.unsafeMake('2026-03-09T10:00:00.000Z'),
      endedAt: DateTime.unsafeMake('2026-03-09T10:30:00.000Z'),
      progress: new CompletionProgress({ segmentsCompleted: 11, totalSegments: 12 }),
    })

    const partial = new SessionCompletion({
      id: Schema.decodeSync(CompletionId)('completion-with-progress'),
      sessionId: Schema.decodeSync(SessionId)('session-with-progress'),
      workoutName: 'Athletica',
      workout: makeWorkout('Athletica'),
      host: alice,
      participants: [alice, bob],
      startedAt: DateTime.unsafeMake('2026-03-08T10:00:00.000Z'),
      endedAt: DateTime.unsafeMake('2026-03-08T10:30:00.000Z'),
      progress: new CompletionProgress({ segmentsCompleted: 3, totalSegments: 12 }),
    })

    const noProgress = newerCompletion

    renderHistoryScreen({
      ListHistory: () => Effect.succeed([finished, partial, noProgress]),
    })

    await screen.findByTestId(`history-row-${finished.id}`)

    // Complete → "Finished", not a bare fraction.
    const finishedProgress = screen.getByTestId(`history-progress-${finished.id}`)
    expect(finishedProgress.textContent).toMatch(/Finished/)
    expect(finishedProgress.textContent).not.toMatch(/^\d+\/\d+$/)

    // Partial → N/M plus a Progress bar (not raw numbers alone).
    const partialProgress = screen.getByTestId(`history-progress-${partial.id}`)
    expect(partialProgress.textContent).toMatch(/3\/12/)
    expect(partialProgress.querySelector('[data-slot="progress"]')).not.toBeNull()

    // No progress field → no indicator.
    expect(screen.queryByTestId(`history-progress-${noProgress.id}`)).toBeNull()
  })

  it('renders progress fraction when completion has progress', async () => {
    vi.setSystemTime(DateTime.toDate(NOW))

    const withProgress = new SessionCompletion({
      id: Schema.decodeSync(CompletionId)('completion-with-progress'),
      sessionId: Schema.decodeSync(SessionId)('session-with-progress'),
      workoutName: 'Athletica',
      workout: makeWorkout('Athletica'),
      host: alice,
      participants: [alice, bob],
      startedAt: DateTime.unsafeMake('2026-03-01T10:00:00.000Z'),
      endedAt: DateTime.unsafeMake('2026-03-01T10:30:00.000Z'),
      progress: new CompletionProgress({ segmentsCompleted: 3, totalSegments: 12 }),
    })

    renderHistoryScreen({
      ListHistory: () => Effect.succeed([withProgress]),
    })

    await screen.findByTestId(`history-row-${withProgress.id}`)
    expect(screen.getByTestId(`history-progress-${withProgress.id}`).textContent).toMatch(/3\/12/)
  })

  it('omits progress element when completion has no progress', async () => {
    vi.setSystemTime(DateTime.toDate(NOW))

    renderHistoryScreen({
      ListHistory: () => Effect.succeed([newerCompletion]),
    })

    await screen.findByTestId(`history-row-${newerCompletion.id}`)
    expect(screen.queryByTestId(`history-progress-${newerCompletion.id}`)).toBeNull()
  })

  it('shows skeleton rows while listHistoryAtom is loading', async () => {
    renderHistoryScreen({
      ListHistory: () => Effect.never,
    })

    await screen.findByTestId('history-screen')
    expect(screen.getByTestId('query-boundary-loading')).toBeTruthy()
    // Not the old bare loading string.
    expect(screen.queryByText('Loading your history…')).toBeNull()
    // Empty / failure surfaces stay hidden.
    expect(screen.queryByTestId('query-boundary-empty')).toBeNull()
    expect(screen.queryByTestId('query-boundary-error')).toBeNull()
  })

  it('shows ui/empty with a Start a workout CTA to /library when ListHistory is empty', async () => {
    renderHistoryScreen({
      ListHistory: () => Effect.succeed([]),
    })

    await screen.findByTestId('query-boundary-empty')
    const emptyCta = screen.getByTestId('start-workout-empty-cta')
    expect(emptyCta.getAttribute('href')).toBe('/library')
    expect(emptyCta.textContent).toMatch(/Start a workout/i)
    // Visually distinct from loading / failure.
    expect(screen.queryByTestId('query-boundary-loading')).toBeNull()
    expect(screen.queryByTestId('query-boundary-error')).toBeNull()
    // Old empty copy is gone.
    expect(screen.queryByTestId('history-empty')).toBeNull()
  })

  it('shows ui/alert with a working retry when ListHistory fails', async () => {
    let calls = 0
    renderHistoryScreen({
      ListHistory: () => {
        calls += 1
        if (calls === 1) {
          return Effect.fail('list-failed' as never)
        }
        return Effect.succeed([newerCompletion])
      },
    })

    await screen.findByTestId('query-boundary-error')
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy()
    // Structurally distinct from skeleton.
    expect(screen.queryByTestId('query-boundary-loading')).toBeNull()
    expect(screen.queryByTestId('query-boundary-empty')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await screen.findByTestId(`history-row-${newerCompletion.id}`)
    expect(screen.queryByTestId('query-boundary-error')).toBeNull()
  })

  it('contains no bare native form elements outside kit components', async () => {
    vi.setSystemTime(DateTime.toDate(NOW))

    renderHistoryScreen({
      ListHistory: () => Effect.succeed([newerCompletion]),
    })

    await screen.findByTestId(`history-row-${newerCompletion.id}`)
    const root = screen.getByTestId('history-screen')
    // No bare form/input/select — interactive controls come from the kit.
    expect(root.querySelector('form')).toBeNull()
    expect(root.querySelector('input')).toBeNull()
    expect(root.querySelector('select')).toBeNull()
    // Accordion trigger is a kit button (data-slot), not a hand-rolled bare control tree.
    expect(root.querySelector('button[data-slot="accordion-trigger"]')).not.toBeNull()
  })
})
