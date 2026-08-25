// @vitest-environment jsdom
import { RegistryProvider, Result } from '@effect-atom/atom-react'
import { SessionId, SessionSummary, WorkoutId } from '@j45/domain'
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router'
import { cleanup, render, screen } from '@testing-library/react'
import * as DateTime from 'effect/DateTime'
import * as Runtime from 'effect/Runtime'
import * as Schema from 'effect/Schema'
import * as Stream from 'effect/Stream'
import { afterEach, describe, expect, it } from 'vitest'

import { TabBar } from '@/components/shell/tab-bar'
import { ServerRpcClient } from '@/lib/rpc-client'

import { emptyLobby, makeLobby, silentLobby, staticLobby } from './lobby-feed'

afterEach(() => {
  cleanup()
})

/** One lobby row. Only the row count matters here, so the body is fixed. */
const liveSession = (id: string): SessionSummary =>
  new SessionSummary({
    id: Schema.decodeSync(SessionId)(id),
    workoutId: Schema.decodeSync(WorkoutId)('workout-athletica'),
    hostDisplayName: 'Alex',
    workoutName: 'Athletica',
    startedAt: DateTime.unsafeMake('2026-01-01T00:00:00.000Z'),
    participantCount: 2,
  })

/** What a fake `WatchActiveSessions` answers this render with. */
type LobbyHandler = () => Stream.Stream<readonly SessionSummary[], unknown>

/**
 * A runtime whose rpc client answers `WatchActiveSessions` with `lobby` and
 * nothing else — the tab bar reads no other rpc, so any other call is a bug.
 */
function makeFakeRuntime(lobby: LobbyHandler) {
  const client = (tag: string) => {
    if (tag !== 'WatchActiveSessions') {
      throw new Error(`unexpected rpc call: ${tag}`)
    }
    return lobby()
  }
  return Runtime.defaultRuntime.pipe(Runtime.provideService(ServerRpcClient, client as never))
}

/**
 * Mounts `TabBar` under a throwaway memory router so its `Link`s and
 * `useLocation` active-group logic have real router context. `initialPath`
 * is both the memory-history start and the only matched leaf. `lobby` is the
 * feed the live-session indicator reads; it defaults to no live sessions.
 */
function renderTabBar(initialPath: string, lobby: LobbyHandler = emptyLobby) {
  const rootRoute = createRootRoute({ component: Outlet })
  const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/',
    component: TabBar,
  })
  const libraryRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/library',
    component: TabBar,
  })
  const generateRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/generate',
    component: TabBar,
  })
  const historyRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/history',
    component: TabBar,
  })
  const workoutRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/workouts/$workoutId',
    component: TabBar,
  })
  const testRouter = createRouter({
    routeTree: rootRoute.addChildren([
      indexRoute,
      libraryRoute,
      generateRoute,
      historyRoute,
      workoutRoute,
    ]),
    history: createMemoryHistory({ initialEntries: [initialPath] }),
  })
  render(
    <RegistryProvider
      initialValues={[[ServerRpcClient.runtime, Result.success(makeFakeRuntime(lobby))]]}
    >
      <RouterProvider router={testRouter} />
    </RegistryProvider>,
  )
}

const TAB_IDS = ['tab-home', 'tab-library', 'tab-generate', 'tab-history'] as const
const TAB_HREFS = {
  'tab-home': '/',
  'tab-library': '/library',
  'tab-generate': '/generate',
  'tab-history': '/history',
} as const
const TAB_ICON_CLASS = {
  'tab-home': 'lucide-house',
  'tab-library': 'lucide-library-big',
  'tab-generate': 'lucide-sparkles',
  'tab-history': 'lucide-history',
} as const

describe('TabBar', () => {
  it('renders four Links with the pinned testids, hrefs, and lucide icons', async () => {
    renderTabBar('/')

    for (const id of TAB_IDS) {
      const link = await screen.findByTestId(id)
      expect(link.getAttribute('href')).toBe(TAB_HREFS[id])
      expect(link.querySelector(`svg.${TAB_ICON_CLASS[id]}`)).toBeTruthy()
    }
  })

  it('marks only the Home tab active on exact `/`', async () => {
    renderTabBar('/')

    const home = await screen.findByTestId('tab-home')
    expect(home.getAttribute('aria-current')).toBe('page')
    expect(home.dataset.active).toBe('true')

    for (const id of TAB_IDS.filter((tabId) => tabId !== 'tab-home')) {
      const link = screen.getByTestId(id)
      expect(link.getAttribute('aria-current')).toBeNull()
      expect(link.dataset.active).toBeUndefined()
    }
  })

  it('activates Library for `/library` and `/workouts/*` paths', async () => {
    renderTabBar('/library')
    const libraryOnList = await screen.findByTestId('tab-library')
    expect(libraryOnList.getAttribute('aria-current')).toBe('page')
    expect(libraryOnList.dataset.active).toBe('true')
    expect(screen.getByTestId('tab-home').getAttribute('aria-current')).toBeNull()

    cleanup()
    renderTabBar('/workouts/workout-1')
    const libraryOnDetail = await screen.findByTestId('tab-library')
    expect(libraryOnDetail.getAttribute('aria-current')).toBe('page')
    expect(libraryOnDetail.dataset.active).toBe('true')
  })

  it('activates Generate and History on their own paths', async () => {
    renderTabBar('/generate')
    const generate = await screen.findByTestId('tab-generate')
    expect(generate.getAttribute('aria-current')).toBe('page')
    expect(generate.dataset.active).toBe('true')
    expect(screen.getByTestId('tab-library').getAttribute('aria-current')).toBeNull()

    cleanup()
    renderTabBar('/history')
    const history = await screen.findByTestId('tab-history')
    expect(history.getAttribute('aria-current')).toBe('page')
    expect(history.dataset.active).toBe('true')
  })

  it('puts glass chrome on an inner .glass-surface inside a fixed wrapper', async () => {
    renderTabBar('/')
    await screen.findByTestId('tab-home')

    const glass = document.querySelector('.glass-surface')
    expect(glass).toBeInstanceOf(HTMLElement)
    if (!(glass instanceof HTMLElement)) {
      return
    }
    expect(glass.classList.contains('glass-surface')).toBe(true)
    expect(glass.dataset.glassTier).toBe('css')
    // Positioning lives on the wrapper, never on the glass surface itself.
    expect(glass.className).not.toMatch(/\bfixed\b/)
    expect(glass.parentElement?.className).toMatch(/\bfixed\b/)
  })
})

describe('TabBar live-session indicator', () => {
  it('shows the count of live sessions on a route that is not Home', async () => {
    renderTabBar('/library', staticLobby([liveSession('session-1'), liveSession('session-2')]))

    const indicator = await screen.findByTestId('tab-live-count')
    expect(indicator.textContent).toBe('2')
  })

  it('renders nothing when no session is live', async () => {
    renderTabBar('/library', emptyLobby)

    await screen.findByTestId('tab-library')
    expect(screen.queryByTestId('tab-live-count')).toBeNull()
  })

  it('renders nothing rather than an error while the feed is failing', async () => {
    renderTabBar('/library', () => Stream.fail(new Error('socket dropped')))

    await screen.findByTestId('tab-library')
    expect(screen.queryByTestId('tab-live-count')).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('renders nothing while the feed has not answered yet', async () => {
    renderTabBar('/library', silentLobby)

    await screen.findByTestId('tab-library')
    expect(screen.queryByTestId('tab-live-count')).toBeNull()
  })

  it('carries its meaning in an accessible label, not in colour or position', async () => {
    renderTabBar('/library', staticLobby([liveSession('session-1')]))

    const indicator = await screen.findByTestId('tab-live-count')
    expect(indicator.getAttribute('aria-label')).toBe('1 live session running. Open Home to join.')
    expect(indicator.getAttribute('role')).toBe('status')

    cleanup()
    renderTabBar('/library', staticLobby([liveSession('session-1'), liveSession('session-2')]))
    const plural = await screen.findByTestId('tab-live-count')
    expect(plural.getAttribute('aria-label')).toBe('2 live sessions running. Open Home to join.')
  })

  it('follows sessions starting and ending with no user action', async () => {
    const lobby = makeLobby([liveSession('session-1')])
    renderTabBar('/library', lobby.handler)

    const indicator = await screen.findByTestId('tab-live-count')
    expect(indicator.textContent).toBe('1')

    await lobby.publish([liveSession('session-1'), liveSession('session-2')])
    expect(screen.getByTestId('tab-live-count').textContent).toBe('2')

    await lobby.publish([])
    expect(screen.queryByTestId('tab-live-count')).toBeNull()
  })

  it('shows the count on every route the tab bar renders on', async () => {
    for (const path of ['/', '/library', '/generate', '/history', '/workouts/workout-1']) {
      renderTabBar(path, staticLobby([liveSession('session-1'), liveSession('session-2')]))
      const indicator = await screen.findByTestId('tab-live-count')
      expect(indicator.textContent).toBe('2')
      cleanup()
    }
  })

  it('routes attention to Home instead of joining a session itself', async () => {
    renderTabBar('/library', staticLobby([liveSession('session-1')]))

    const indicator = await screen.findByTestId('tab-live-count')
    // The only interactive ancestor is the Home tab link. Nothing in the
    // indicator leads to a session.
    expect(indicator.closest('a')).toBe(screen.getByTestId('tab-home'))
    expect(indicator.querySelector('a')).toBeNull()
  })
})
