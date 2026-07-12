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
  WorkoutNotFound,
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
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import * as DateTime from 'effect/DateTime'
import * as Effect from 'effect/Effect'
import * as Runtime from 'effect/Runtime'
import * as Schema from 'effect/Schema'
import { toast } from 'sonner'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { HomeHero } from '@/components/home-hero'
import type { HeroPick } from '@/lib/home'
import { ServerRpcClient } from '@/lib/rpc-client'

vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}))

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.mocked(toast.error).mockClear()
})

/**
 * Builds a `Runtime` that provides `ServerRpcClient` with `handlers` in
 * place of the real (websocket-backed) rpc client — the same fake-runtime
 * idiom `home-screen.test.tsx` / `library-screen.test.tsx` use, seeding
 * `ServerRpcClient.runtime` itself via `RegistryProvider`'s `initialValues`
 * below.
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

const seededAt = DateTime.unsafeMake('2026-01-01T00:00:00.000Z')

const makeWorkout = (name: string, focus: 'cardio' | 'strength' | 'hybrid' = 'cardio'): Workout =>
  new Workout({
    name,
    focus,
    pods: [new Pod({ name: 'Pod 1', stations: [new Station({ name: 'Burpee' })] })],
    flow: new Flow({
      type: 'laps',
      rounds: [new Round({ workSeconds: 40, restSeconds: 20 })],
    }),
  })

const makeLibraryWorkout = (
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

const makeSession = (args: {
  id: string
  workoutName: string
  startedAt: DateTime.Utc
  hostDisplayName?: string
  participantCount?: number
}): SessionSummary =>
  new SessionSummary({
    id: Schema.decodeSync(SessionId)(args.id),
    hostDisplayName: args.hostDisplayName ?? 'Jordan',
    workoutName: args.workoutName,
    startedAt: args.startedAt,
    participantCount: args.participantCount ?? 4,
  })

/** Stand-in destination for `/session/<id>` navigation. */
function SessionDestination() {
  const { sessionId } = useParams({ strict: false }) as { sessionId: string }
  return <div data-testid={`session-screen-${sessionId}`} />
}

/**
 * Mounts `HomeHero` under a throwaway memory router so its `Link`s /
 * navigates (`/session/$sessionId`, `/library`) have router context, and
 * seeds a fake `ServerRpcClient` runtime for `startWorkoutAtom`.
 */
function renderHomeHero(
  pick: HeroPick | undefined,
  handlers: Partial<Record<string, (payload: unknown) => Effect.Effect<unknown, unknown>>> = {},
) {
  const fakeRuntime = makeFakeRuntime(handlers)
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
    component: SessionDestination,
  })
  const testRouter = createRouter({
    routeTree: rootRoute.addChildren([indexRoute, libraryRoute, sessionRoute]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })

  render(
    <RegistryProvider initialValues={[[ServerRpcClient.runtime, Result.success(fakeRuntime)]]}>
      <RouterProvider router={testRouter} />
    </RegistryProvider>,
  )
}

const ironCircuit = makeLibraryWorkout('workout-iron', 'Iron Circuit', 'strength')
const athletica = makeLibraryWorkout('workout-athletica', 'Athletica', 'cardio')

const liveSession = makeSession({
  id: 'session-live-1',
  workoutName: 'Iron Circuit',
  startedAt: DateTime.unsafeMake('2026-03-01T09:48:00.000Z'),
})
const extraSession = makeSession({
  id: 'session-extra-1',
  workoutName: 'Athletica',
  startedAt: DateTime.unsafeMake('2026-03-01T09:30:00.000Z'),
  hostDisplayName: 'Sam',
  participantCount: 2,
})

const startedSummary = new SessionSummary({
  id: Schema.decodeSync(SessionId)('session-started-1'),
  hostDisplayName: 'You',
  workoutName: ironCircuit.workout.name,
  startedAt: seededAt,
  participantCount: 1,
})

describe('HomeHero', () => {
  it('live pick: sport-tinted card, LIVE, host, meta, join target, and extras', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    vi.setSystemTime(new Date('2026-03-01T10:00:00.000Z'))

    const pick: HeroPick = {
      _tag: 'live',
      session: liveSession,
      extras: [extraSession],
      workout: ironCircuit,
    }
    renderHomeHero(pick)

    const hero = await screen.findByTestId('home-hero')
    expect(hero.className).toMatch(/hue-strength/)
    expect(hero.textContent).toContain('LIVE')
    expect(hero.textContent).toContain('Iron Circuit')
    expect(hero.textContent).toContain('Jordan is hosting')
    expect(hero.textContent).toMatch(/12 min/)
    expect(hero.textContent).toContain('4')

    const join = screen.getByTestId(`session-card-${liveSession.id}`)
    expect(join.textContent).toMatch(/Join now/i)
    expect(join.getAttribute('href')).toBe(`/session/${liveSession.id}`)

    const extra = screen.getByTestId(`session-card-${extraSession.id}`)
    expect(extra.textContent).toContain('Sam')
    expect(extra.textContent).toContain('Athletica')
    expect(extra.getAttribute('href')).toBe(`/session/${extraSession.id}`)
  })

  it('live pick falls back to hybrid hue when no resolved workout', async () => {
    const pick: HeroPick = {
      _tag: 'live',
      session: liveSession,
      extras: [],
    }
    renderHomeHero(pick)

    const hero = await screen.findByTestId('home-hero')
    expect(hero.className).toMatch(/hue-hybrid/)
    expect(hero.textContent).toContain('Iron Circuit')
  })

  it('start-last pick: hero-start drives StartSession then navigates to /session/<id>', async () => {
    let startPayload: unknown
    const pick: HeroPick = { _tag: 'start-last', workout: ironCircuit }

    renderHomeHero(pick, {
      StartSession: (payload) => {
        startPayload = payload
        return Effect.succeed(startedSummary)
      },
    })

    const hero = await screen.findByTestId('home-hero')
    expect(hero.textContent).toContain('Iron Circuit')
    fireEvent.click(screen.getByTestId('hero-start'))

    await screen.findByTestId(`session-screen-${startedSummary.id}`)
    expect(startPayload).toEqual({ workoutId: ironCircuit.id })
  })

  it('browse pick: promotes library head with start wiring and browse link', async () => {
    let startPayload: unknown
    const pick: HeroPick = { _tag: 'browse', workout: athletica }

    renderHomeHero(pick, {
      StartSession: (payload) => {
        startPayload = payload
        return Effect.succeed(startedSummary)
      },
    })

    const hero = await screen.findByTestId('home-hero')
    expect(hero.textContent).toContain('Athletica')
    expect(screen.getByTestId('hero-browse-link').getAttribute('href')).toBe('/library')

    fireEvent.click(screen.getByTestId('hero-start'))
    await screen.findByTestId(`session-screen-${startedSummary.id}`)
    expect(startPayload).toEqual({ workoutId: athletica.id })
  })

  it('browse pick with empty library renders a usable empty fold under home-hero', async () => {
    const pick: HeroPick = { _tag: 'browse', workout: undefined }
    renderHomeHero(pick)

    await screen.findByTestId('home-hero')
    expect(screen.queryByTestId('hero-start')).toBeNull()
    expect(screen.getByTestId('hero-browse-link').getAttribute('href')).toBe('/library')
  })

  it('loading pick renders the home-hero-skeleton', async () => {
    renderHomeHero(undefined)

    await screen.findByTestId('home-hero-skeleton')
    expect(screen.queryByTestId('home-hero')).toBeNull()
  })

  it('failed StartSession fires a sonner toast and leaves the fold interactive', async () => {
    const pick: HeroPick = { _tag: 'start-last', workout: ironCircuit }
    const missingId = Schema.decodeSync(WorkoutId)('workout-missing')

    renderHomeHero(pick, {
      StartSession: () => Effect.fail(new WorkoutNotFound({ id: missingId })),
    })

    const start = await screen.findByTestId('hero-start')
    fireEvent.click(start)

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalled()
    })

    // Dashboard stays interactive — button not stuck disabled, no throw.
    expect((start as HTMLButtonElement).disabled).toBe(false)
    expect(screen.getByTestId('home-hero')).toBeTruthy()
    expect(screen.queryByTestId(`session-screen-${startedSummary.id}`)).toBeNull()

    // Second click still works (not stuck).
    fireEvent.click(start)
    await waitFor(() => {
      expect(vi.mocked(toast.error).mock.calls.length).toBeGreaterThanOrEqual(2)
    })
  })
})
