// @vitest-environment jsdom
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { TabBar } from '@/components/shell/tab-bar'

afterEach(() => {
  cleanup()
})

/**
 * Mounts `TabBar` under a throwaway memory router so its `Link`s and
 * `useLocation` active-group logic have real router context. `initialPath`
 * is both the memory-history start and the only matched leaf.
 */
function renderTabBar(initialPath: string) {
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
  render(<RouterProvider router={testRouter} />)
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
