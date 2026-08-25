// @vitest-environment jsdom
import { RegistryProvider, Result } from '@effect-atom/atom-react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import * as Effect from 'effect/Effect'
import * as Runtime from 'effect/Runtime'
import { afterEach, describe, expect, it, vi } from 'vitest'

import App from '@/app'
import { ServerRpcClient } from '@/lib/rpc-client'
import { router } from '@/router'

import { emptyLobby } from './lobby-feed'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

/**
 * The explanation home shows somebody a session sent there. Driven through
 * the app's own route tree — the same singleton router `RouterProvider`
 * mounts — because the point of this notice is that the route reads the
 * search parameter. A test with its own router would prove nothing.
 */

/** Fake rpc runtime — the shared idiom from `router-fallback.test.tsx`. */
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

const userJson = { id: 'u1', username: 'jill', displayName: 'Jill Owner', role: 'owner' as const }

/** Mounts the whole app, authenticated, on the real route tree. */
async function renderApp() {
  vi.stubGlobal(
    'fetch',
    vi.fn((path: string) => {
      if (path === '/auth/me') {
        return Promise.resolve(Response.json({ user: userJson }, { status: 200 }))
      }
      throw new Error(`unexpected fetch to ${path}`)
    }),
  )
  const fakeRuntime = makeFakeRuntime({
    WatchActiveSessions: emptyLobby,
    ListHistory: () => Effect.succeed([]),
    ListWorkouts: () => Effect.succeed([]),
  })
  render(
    <RegistryProvider initialValues={[[ServerRpcClient.runtime, Result.success(fakeRuntime)]]}>
      <App />
    </RegistryProvider>,
  )
  await screen.findByTestId('home-screen')
}

describe('home notice', () => {
  it('names a deleted plan when that is what ended the session', async () => {
    await renderApp()

    await router.navigate({ to: '/', search: { notice: 'plan-deleted' } })

    const notice = await screen.findByTestId('home-notice')
    expect(notice.dataset.notice).toBe('plan-deleted')
    expect(notice.textContent).toContain('The plan was deleted')
    expect(notice.textContent).toContain('The host removed this workout')
  })

  it('says something different when the session simply ended', async () => {
    await renderApp()

    await router.navigate({ to: '/', search: { notice: 'session-ended' } })

    const notice = await screen.findByTestId('home-notice')
    expect(notice.dataset.notice).toBe('session-ended')
    expect(notice.textContent).toContain('Session ended')
    // The two explanations must not read the same. One of them means the
    // plan is gone for good.
    expect(notice.textContent).not.toContain('deleted')
  })

  it('goes away when dismissed, and stays away on a reload of the same url', async () => {
    await renderApp()
    await router.navigate({ to: '/', search: { notice: 'plan-deleted' } })
    await screen.findByTestId('home-notice')

    fireEvent.click(screen.getByTestId('home-notice-dismiss'))

    await waitFor(() => {
      expect(screen.queryByTestId('home-notice')).toBeNull()
    })
    // The parameter is gone from the url, so nothing brings the message back.
    expect(router.state.location.search).toEqual({})
  })

  it('shows nothing at all when nobody was sent here', async () => {
    await renderApp()

    await router.navigate({ to: '/' })

    await screen.findByTestId('home-screen')
    expect(screen.queryByTestId('home-notice')).toBeNull()
  })

  it('ignores a search value that is not a notice, and still renders home', async () => {
    await renderApp()

    await router.navigate({ to: '/', search: { notice: 'not-a-notice' } })

    await screen.findByTestId('home-screen')
    expect(screen.queryByTestId('home-notice')).toBeNull()
  })
})
