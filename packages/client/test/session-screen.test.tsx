// @vitest-environment jsdom
import { RegistryProvider, Result } from '@effect-atom/atom-react'
import {
  compile,
  Flow,
  Participant,
  Pod,
  Round,
  SessionId,
  SessionNotFound,
  SessionState,
  Station,
  TimerDone,
  TimerPaused,
  TimerRunning,
  UserId,
  Workout,
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
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import * as Effect from 'effect/Effect'
import * as Queue from 'effect/Queue'
import * as Runtime from 'effect/Runtime'
import * as Schema from 'effect/Schema'
import * as Stream from 'effect/Stream'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { SessionScreen } from '@/components/session-screen'
import { ServerRpcClient } from '@/lib/rpc-client'
import * as audio from '@/player/audio'

vi.mock('@/player/audio', () => ({
  audioState: vi.fn(() => 'on'),
  unlockAudio: vi.fn(() => 'on'),
  beepWork: vi.fn(),
  beepRest: vi.fn(),
  beepReady: vi.fn(),
  beepDone: vi.fn(),
  beepCountdown: vi.fn(),
}))

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  Reflect.deleteProperty(navigator, 'wakeLock')
})

/** Fake rpc runtime — the shared idiom from `library-screen.test.tsx`. */
function makeFakeRuntime(handlers: Partial<Record<string, (payload: unknown) => unknown>>) {
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
const compiled = compile(
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

const host = new Participant({ userId: Schema.decodeSync(UserId)('u-ann'), displayName: 'Ann' })
const joiner = new Participant({ userId: Schema.decodeSync(UserId)('u-ben'), displayName: 'Ben' })

function makeState(id: SessionId, timer: TimerState, serverNow: number): SessionState {
  return new SessionState({
    id,
    host,
    workoutName: 'Athletica',
    compiled,
    timer,
    serverNow,
    participants: [host, joiner],
  })
}

/**
 * Mounts `SessionScreen` at `/session/<id>` in a throwaway memory router
 * whose `/` renders a marker, so a navigate-home is observable. Seeds the
 * fake rpc runtime the same way the other screen tests do.
 */
function renderSession(
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

/** A stream that emits `state` and then stays open (never `ended`). */
const liveStream = (state: SessionState) => Stream.make(state).pipe(Stream.concat(Stream.never))

describe('SessionScreen — stream retry discrimination', () => {
  it('SessionNotFound stops retrying and navigates home', async () => {
    const id = 'sess-not-found'
    const sessionId = Schema.decodeSync(SessionId)(id)
    const router = renderSession(id, {
      WatchSession: () => Stream.fail(new SessionNotFound({ id: sessionId })),
    })

    await screen.findByTestId('home-screen')
    expect(router.state.location.pathname).toBe('/')
  })

  it('a transport failure shows the reconnecting indicator and retries with backoff', async () => {
    const id = 'sess-transport'
    renderSession(id, {
      WatchSession: () => Stream.fail(new Error('socket dropped')),
    })

    await screen.findByTestId('session-reconnecting')
    expect(screen.queryByTestId('home-screen')).toBeNull()
  })
})

describe('SessionScreen — server-state render', () => {
  it('renders phase, exercise + detail, context line, next-up, progress cells, and participants', async () => {
    const id = 'sess-render'
    const sessionId = Schema.decodeSync(SessionId)(id)
    const now = Date.now()
    const timer = new TimerRunning({ segmentIndex: 1, endsAtMillis: now + 30_000 })
    renderSession(id, { WatchSession: () => liveStream(makeState(sessionId, timer, now)) })

    await screen.findByTestId('session-screen')
    expect(screen.getByTestId('session-phase').textContent).toBe('Work')
    expect(screen.getByTestId('session-exercise-name').textContent).toBe('Rower')
    expect(screen.getByTestId('session-exercise-detail').textContent).toBe('10 cal')
    expect(screen.getByTestId('session-context').textContent).toBe(
      'Pod 1/1 · Lap 1/2 · Station 1/2',
    )
    expect(screen.getByTestId('session-next-up').textContent).toBe('Next: Burpee')
    expect(screen.getByTestId('session-progress-cell-0').dataset.state).toBe('active')
    expect(screen.getByTestId('session-progress-cell-1').dataset.state).toBe('upcoming')
    expect(screen.getByTestId('session-participant-u-ann').textContent).toBe('Ann')
    expect(screen.getByTestId('session-participant-u-ben').textContent).toBe('Ben')
  })

  it('counts down against the server clock offset, never the raw phone clock', async () => {
    const id = 'sess-offset'
    const sessionId = Schema.decodeSync(SessionId)(id)
    // Server is 4000s ahead of this phone. The raw phone delta would read
    // 67:20; only applying (clientNow − serverNow) yields the true 0:40.
    const serverNow = Date.now() + 4_000_000
    const timer = new TimerRunning({ segmentIndex: 1, endsAtMillis: serverNow + 40_000 })
    renderSession(id, { WatchSession: () => liveStream(makeState(sessionId, timer, serverNow)) })

    await screen.findByTestId('session-count')
    expect(screen.getByTestId('session-count').textContent).toBe('0:40')
  })
})

describe('SessionScreen — controls', () => {
  it('Pause sends SendSessionCommand with the pause command', async () => {
    const id = 'sess-pause'
    const sessionId = Schema.decodeSync(SessionId)(id)
    const commands: unknown[] = []
    const timer = new TimerRunning({ segmentIndex: 1, endsAtMillis: Date.now() + 30_000 })
    renderSession(id, {
      WatchSession: () => liveStream(makeState(sessionId, timer, Date.now())),
      SendSessionCommand: (payload) => {
        commands.push(payload)
        return Effect.succeed(undefined)
      },
    })

    await screen.findByTestId('session-pause')
    fireEvent.click(screen.getByTestId('session-pause'))

    await waitFor(() => {
      expect(commands).toContainEqual({ id: sessionId, command: 'pause' })
    })
  })

  it('the done state shows Finish, which leaves the session', async () => {
    const id = 'sess-done'
    const sessionId = Schema.decodeSync(SessionId)(id)
    const leaves: unknown[] = []
    renderSession(id, {
      WatchSession: () => liveStream(makeState(sessionId, new TimerDone({}), Date.now())),
      LeaveSession: (payload) => {
        leaves.push(payload)
        return Effect.succeed(undefined)
      },
    })

    await screen.findByTestId('session-finish')
    fireEvent.click(screen.getByTestId('session-finish'))

    await waitFor(() => {
      expect(leaves).toContainEqual({ id: sessionId })
    })
  })

  it('the interim Leave control leaves the session mid-workout', async () => {
    const id = 'sess-leave'
    const sessionId = Schema.decodeSync(SessionId)(id)
    const leaves: unknown[] = []
    const timer = new TimerRunning({ segmentIndex: 1, endsAtMillis: Date.now() + 30_000 })
    renderSession(id, {
      WatchSession: () => liveStream(makeState(sessionId, timer, Date.now())),
      LeaveSession: (payload) => {
        leaves.push(payload)
        return Effect.succeed(undefined)
      },
    })

    await screen.findByTestId('session-leave')
    fireEvent.click(screen.getByTestId('session-leave'))

    await waitFor(() => {
      expect(leaves).toContainEqual({ id: sessionId })
    })
  })
})

describe('SessionScreen — cues, audio, and wake lock', () => {
  it('beeps the work tone on the transition into a work segment and surfaces data-audio', async () => {
    const id = 'sess-beep'
    const sessionId = Schema.decodeSync(SessionId)(id)
    const queue = Effect.runSync(Queue.unbounded<SessionState>())
    renderSession(id, { WatchSession: () => Stream.fromQueue(queue) })

    // Enter the get-ready segment first, then transition into work.
    await act(async () => {
      await Effect.runPromise(
        Queue.offer(
          queue,
          makeState(
            sessionId,
            new TimerRunning({ segmentIndex: 0, endsAtMillis: Date.now() + 5000 }),
            Date.now(),
          ),
        ),
      )
    })
    await screen.findByTestId('session-screen')
    expect(audio.beepWork).not.toHaveBeenCalled()

    await act(async () => {
      await Effect.runPromise(
        Queue.offer(
          queue,
          makeState(
            sessionId,
            new TimerRunning({ segmentIndex: 1, endsAtMillis: Date.now() + 30_000 }),
            Date.now(),
          ),
        ),
      )
    })

    await waitFor(() => {
      expect(audio.beepWork).toHaveBeenCalled()
    })
    expect(screen.getByTestId('session-audio-indicator').dataset.audio).toBe('on')

    fireEvent.click(screen.getByTestId('session-audio-indicator'))
    expect(audio.unlockAudio).toHaveBeenCalled()
  })

  it('holds a wake lock while running and releases it when the session pauses', async () => {
    const id = 'sess-wake'
    const sessionId = Schema.decodeSync(SessionId)(id)
    const release = vi.fn<() => Promise<void>>(() => Promise.resolve())
    const sentinel = { release, addEventListener: vi.fn<() => void>() }
    const request = vi.fn<() => Promise<typeof sentinel>>(() => Promise.resolve(sentinel))
    Object.defineProperty(navigator, 'wakeLock', { value: { request }, configurable: true })

    const queue = Effect.runSync(Queue.unbounded<SessionState>())
    renderSession(id, { WatchSession: () => Stream.fromQueue(queue) })

    await act(async () => {
      await Effect.runPromise(
        Queue.offer(
          queue,
          makeState(
            sessionId,
            new TimerRunning({ segmentIndex: 1, endsAtMillis: Date.now() + 30_000 }),
            Date.now(),
          ),
        ),
      )
    })
    await waitFor(() => {
      expect(request).toHaveBeenCalledWith('screen')
    })

    await act(async () => {
      await Effect.runPromise(
        Queue.offer(
          queue,
          makeState(
            sessionId,
            new TimerPaused({ segmentIndex: 1, remainingMillis: 20_000 }),
            Date.now(),
          ),
        ),
      )
    })
    await waitFor(() => {
      expect(release).toHaveBeenCalled()
    })
  })
})
