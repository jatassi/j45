// @vitest-environment jsdom
import { RegistryProvider } from '@effect-atom/atom-react'
import { SessionId, SessionSummary, WorkoutId } from '@j45/domain'
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
  useParams,
} from '@tanstack/react-router'
import { act, cleanup, render, screen } from '@testing-library/react'
import * as DateTime from 'effect/DateTime'
import * as Schema from 'effect/Schema'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { HomeHero } from '@/components/home-hero'
import type { HeroPick } from '@/lib/home'

/**
 * The live hero's `"N min in"` line, which counts on a source of its own so
 * that it stays right however rarely Session data arrives. `home-hero.test.tsx`
 * covers the rest of the fold; this suite drives the clock.
 */

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

/** A live-Session row that started at `startedAt`. Nothing else varies here. */
const makeSession = (id: string, startedAt: string): SessionSummary =>
  new SessionSummary({
    id: Schema.decodeSync(SessionId)(id),
    workoutId: Schema.decodeSync(WorkoutId)('workout-iron'),
    hostDisplayName: 'Jordan',
    workoutName: 'Iron Circuit',
    startedAt: DateTime.unsafeMake(startedAt),
    participantCount: 4,
  })

/** A live pick with no resolved workout — the hue is not what this suite reads. */
const livePick = (id: string, startedAt: string): HeroPick => ({
  _tag: 'live',
  session: makeSession(id, startedAt),
  extras: [],
})

/** The pick with no elapsed line at all, used to calibrate the timer count. */
const idlePick: HeroPick = { _tag: 'browse', workout: undefined }

/**
 * Mounts `HomeHero` under a throwaway memory router so its `Link`s
 * (`/session/$sessionId`, `/library`) have router context — the same mount
 * idiom as `home-hero.test.tsx`, trimmed to what these picks reach.
 */
function renderHero(pick: HeroPick) {
  const rootRoute = createRootRoute({ component: Outlet })
  const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/',
    component: () => <HomeHero pick={pick} />,
  })
  const libraryRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/library',
    component: () => <div data-testid="library-destination" />,
  })
  const sessionRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/session/$sessionId',
    component: function SessionDestination() {
      const { sessionId } = useParams({ strict: false }) as { sessionId: string }
      return <div data-testid={`session-screen-${sessionId}`} />
    },
  })
  const testRouter = createRouter({
    routeTree: rootRoute.addChildren([indexRoute, libraryRoute, sessionRoute]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })

  render(
    <RegistryProvider>
      <RouterProvider router={testRouter} />
    </RegistryProvider>,
  )
}

/** The rendered elapsed line, once the hero is on screen. */
async function elapsedLine(): Promise<string> {
  const line = await screen.findByTestId('hero-elapsed')
  return line.textContent
}

/** Runs the fake clock forward by `millis`, flushing the renders it causes. */
async function advance(millis: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(millis)
  })
}

/** Freezes the fake clock at 10:00 on the fixtures' day. */
function freezeAtTen(): void {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  vi.setSystemTime(new Date('2026-03-01T10:00:00.000Z'))
}

describe('HomeHero live elapsed line', () => {
  it('keeps counting with no new session data arriving', async () => {
    freezeAtTen()
    renderHero(livePick('session-ticking', '2026-03-01T09:58:00.000Z'))

    expect(await elapsedLine()).toContain('2 min in')

    await advance(60_000)
    expect(await elapsedLine()).toContain('3 min in')

    await advance(60_000)
    expect(await elapsedLine()).toContain('4 min in')
  })

  it('reads the right minute the moment it appears', async () => {
    freezeAtTen()
    renderHero(livePick('session-seeded', '2026-03-01T09:53:00.000Z'))

    // No timer advanced: the line is right on first paint rather than sitting
    // at zero until the first boundary corrects it.
    expect(await elapsedLine()).toContain('7 min in')
  })

  it('holds the minute between boundaries rather than changing every frame', async () => {
    freezeAtTen()
    renderHero(livePick('session-steady', '2026-03-01T09:58:00.000Z'))

    await advance(59_000)
    expect(await elapsedLine()).toContain('2 min in')

    await advance(1000)
    expect(await elapsedLine()).toContain('3 min in')
  })

  it('reads zero minutes for a session that has only just started', async () => {
    freezeAtTen()
    renderHero(livePick('session-fresh', '2026-03-01T10:00:00.000Z'))

    expect(await elapsedLine()).toContain('0 min in')

    await advance(59_000)
    expect(await elapsedLine()).toContain('0 min in')
  })

  it('reads zero minutes when the start runs ahead of the phone clock', async () => {
    freezeAtTen()
    renderHero(livePick('session-skewed', '2026-03-01T10:00:30.000Z'))

    expect(await elapsedLine()).toContain('0 min in')

    await advance(60_000)
    expect(await elapsedLine()).toContain('0 min in')

    await advance(60_000)
    expect(await elapsedLine()).toContain('1 min in')
  })

  it('stops ticking once the hero is no longer displayed', async () => {
    freezeAtTen()

    // Calibrate on a hero with no elapsed line: the router mount schedules
    // timers of its own, so only the difference between the two renders is
    // the hero's own ticker.
    const before = vi.getTimerCount()
    renderHero(idlePick)
    await screen.findByTestId('home-hero')
    const idleMounted = vi.getTimerCount() - before
    cleanup()
    const idleResidue = vi.getTimerCount() - before
    const afterIdle = vi.getTimerCount()

    renderHero(livePick('session-unmounted', '2026-03-01T09:58:00.000Z'))
    expect(await elapsedLine()).toContain('2 min in')

    // Exactly one timer more than the idle hero while displayed...
    expect(vi.getTimerCount() - afterIdle).toBe(idleMounted + 1)

    cleanup()

    // ...and, once it is gone, no more left behind than the idle hero left.
    expect(vi.getTimerCount() - afterIdle).toBe(idleResidue)
  })
})
