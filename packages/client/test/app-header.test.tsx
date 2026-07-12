// @vitest-environment jsdom
import { User } from '@j45/domain'
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router'
import { cleanup, render, screen } from '@testing-library/react'
import * as Schema from 'effect/Schema'
import { afterEach, describe, expect, it } from 'vitest'

import { AppHeader } from '@/components/shell/app-header'

afterEach(() => {
  cleanup()
})

/**
 * `User.id`/`User.username` are branded — decode through the schema rather
 * than constructing with `new User(...)`.
 */
function makeUser(displayName: string) {
  return Schema.decodeUnknownSync(User)({
    id: 'u1',
    username: 'jill',
    displayName,
    role: 'owner',
  })
}

/**
 * Mounts `AppHeader` as a route component so the avatar-chip `Link` has router
 * context, without pulling in the whole app shell.
 */
function renderAppHeader(user: User) {
  const rootRoute = createRootRoute({ component: Outlet })
  const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/',
    component: () => <AppHeader user={user} />,
  })
  const accountRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/account',
    component: () => <div data-testid="account-dest" />,
  })
  const testRouter = createRouter({
    routeTree: rootRoute.addChildren([indexRoute, accountRoute]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })
  render(<RouterProvider router={testRouter} />)
}

describe('AppHeader', () => {
  it('renders the Wordmark and an avatar-chip Link to /account with two-word initials', async () => {
    renderAppHeader(makeUser('Jill Owner'))

    const chip = await screen.findByTestId('avatar-chip')
    expect(chip.getAttribute('href')).toBe('/account')
    expect(chip.textContent).toBe('JO')
    // Wordmark: white J + primary orange 45.
    expect(document.body.textContent).toContain('J')
    expect(document.body.textContent).toContain('45')
  })

  it('uses a single initial for a single-word displayName', async () => {
    renderAppHeader(makeUser('Jordan'))

    const chip = await screen.findByTestId('avatar-chip')
    expect(chip.textContent).toBe('J')
  })

  it('uses first + last word initials for multi-word names', async () => {
    renderAppHeader(makeUser('Mary Jane Watson'))

    const chip = await screen.findByTestId('avatar-chip')
    expect(chip.textContent).toBe('MW')
  })

  it('puts glass chrome on an inner .glass-surface inside a sticky wrapper', async () => {
    renderAppHeader(makeUser('Jill Owner'))
    await screen.findByTestId('avatar-chip')

    const glass = document.querySelector('.glass-surface')
    expect(glass).toBeInstanceOf(HTMLElement)
    if (!(glass instanceof HTMLElement)) {
      return
    }
    expect(glass.dataset.glassTier).toBe('css')
    expect(glass.className).not.toMatch(/\bsticky\b/)
    expect(glass.parentElement?.className).toMatch(/\bsticky\b/)
  })
})
