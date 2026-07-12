// @vitest-environment jsdom
import type { ReactNode } from 'react'

import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { PushHeader } from '@/components/shell/push-header'
import { router } from '@/router'

afterEach(() => {
  cleanup()
})

type RenderOpts = {
  title?: string
  action?: ReactNode
  onBack?: () => void
  /** Memory-history stack; the last entry is the starting pathname. */
  entries?: string[]
}

/**
 * Mounts `PushHeader` on a detail leaf with a home destination so back
 * navigation (history.back vs navigate-to-`/`) is observable.
 */
function renderPushHeader(opts: RenderOpts = {}) {
  const { title = 'Account', action, onBack, entries = ['/account'] } = opts
  const rootRoute = createRootRoute({ component: Outlet })
  const homeRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/',
    component: () => <div data-testid="home-dest" />,
  })
  const accountRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/account',
    component: () => <PushHeader title={title} action={action} onBack={onBack} />,
  })
  const history = createMemoryHistory({
    initialEntries: entries,
    initialIndex: entries.length - 1,
  })
  const testRouter = createRouter({
    routeTree: rootRoute.addChildren([homeRoute, accountRoute]),
    history,
  })
  render(<RouterProvider router={testRouter} />)
  return { history, testRouter }
}

describe('PushHeader', () => {
  it('renders the title, optional action slot, and a back button', async () => {
    renderPushHeader({
      title: 'Edit workout',
      action: (
        <button type="button" data-testid="save-action">
          Save
        </button>
      ),
    })

    expect(await screen.findByText('Edit workout')).toBeTruthy()
    expect(screen.getByTestId('save-action')).toBeTruthy()
    expect(screen.getByTestId('back-button')).toBeTruthy()
  })

  it('omits the action slot when none is provided', async () => {
    renderPushHeader({ title: 'Account' })

    expect(await screen.findByText('Account')).toBeTruthy()
    expect(screen.queryByTestId('save-action')).toBeNull()
  })

  it('navigates to `/` when history cannot go back', async () => {
    // A single-entry stack has `__TSR_index === 0`, so canGoBack() is false.
    const { testRouter } = renderPushHeader({ entries: ['/account'] })

    fireEvent.click(await screen.findByTestId('back-button'))

    await screen.findByTestId('home-dest')
    expect(testRouter.state.location.pathname).toBe('/')
  })

  it('calls history.back() when there is a prior in-app entry', async () => {
    // Two entries; starting on /account means canGoBack() is true.
    const { testRouter } = renderPushHeader({ entries: ['/', '/account'] })

    expect(testRouter.state.location.pathname).toBe('/account')
    fireEvent.click(await screen.findByTestId('back-button'))

    await screen.findByTestId('home-dest')
    expect(testRouter.state.location.pathname).toBe('/')
  })

  it('calls the onBack prop instead of default history/navigate behavior when provided', async () => {
    const onBack = vi.fn()
    // Stack would allow history.back() — onBack must win anyway.
    const { testRouter } = renderPushHeader({
      entries: ['/', '/account'],
      onBack,
    })

    fireEvent.click(await screen.findByTestId('back-button'))

    expect(onBack).toHaveBeenCalledTimes(1)
    // Default navigation must not run when the override is provided.
    expect(testRouter.state.location.pathname).toBe('/account')
    expect(screen.queryByTestId('home-dest')).toBeNull()
  })
})

/**
 * Parent layout id for a leaf matched by `fullPath`. The global `Register`
 * step is skipped in this app, so route nodes are loosely typed — narrow
 * only the parent chain we assert on.
 */
function parentLayoutId(fullPath: string): string | undefined {
  const route = Object.values(router.routesById).find((r) => r.fullPath === fullPath)
  if (route === undefined) {
    return undefined
  }
  const parent = route.parentRoute as { id?: string; parentRoute?: { id?: string } } | undefined
  return parent?.id
}

function grandparentLayoutId(fullPath: string): string | undefined {
  const route = Object.values(router.routesById).find((r) => r.fullPath === fullPath)
  if (route === undefined) {
    return undefined
  }
  const parent = route.parentRoute as { parentRoute?: { id?: string } } | undefined
  return parent?.parentRoute?.id
}

/**
 * The three editor leaves own their header in a later task; this commit only
 * strips the shared push-layout `PushHeader` by parenting them under a
 * headerless pathless group. Other push leaves stay under `/push`.
 */
describe('router.tsx headerless editor group', () => {
  const editorFullPaths = [
    '/workouts/new',
    '/workouts/$workoutId/edit',
    '/workouts/$workoutId/reflow',
  ] as const

  const headedPushFullPaths = ['/timer', '/account', '/session/$sessionId'] as const

  it('parents editor leaves under a headerless group, not the push layout with PushHeader', () => {
    for (const fullPath of editorFullPaths) {
      const parentId = parentLayoutId(fullPath)
      expect(parentId, `missing route for ${fullPath}`).toBeDefined()
      // Must not sit under the pathless push layout that renders PushHeader.
      expect(parentId).not.toBe('/push')
      // Still a pathless group under root (no tab layout either).
      expect(grandparentLayoutId(fullPath)).toBe('__root__')
    }
  })

  it('keeps other push leaves under the headed push layout', () => {
    for (const fullPath of headedPushFullPaths) {
      expect(parentLayoutId(fullPath), `missing route for ${fullPath}`).toBe('/push')
    }
  })
})
