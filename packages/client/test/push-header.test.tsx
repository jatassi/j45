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
import { afterEach, describe, expect, it } from 'vitest'

import { PushHeader } from '@/components/shell/push-header'

afterEach(() => {
  cleanup()
})

type RenderOpts = {
  title?: string
  action?: ReactNode
  /** Memory-history stack; the last entry is the starting pathname. */
  entries?: string[]
}

/**
 * Mounts `PushHeader` on a detail leaf with a home destination so back
 * navigation (history.back vs navigate-to-`/`) is observable.
 */
function renderPushHeader(opts: RenderOpts = {}) {
  const { title = 'Account', action, entries = ['/account'] } = opts
  const rootRoute = createRootRoute({ component: Outlet })
  const homeRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/',
    component: () => <div data-testid="home-dest" />,
  })
  const accountRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/account',
    component: () => <PushHeader title={title} action={action} />,
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
})
