// @vitest-environment jsdom
import { RegistryProvider, Result } from '@effect-atom/atom-react'
import type { PasskeySummary } from '@j45/domain'
import { ServerInfo } from '@j45/domain'
import { act, cleanup, render, screen } from '@testing-library/react'
import * as DateTime from 'effect/DateTime'
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
 * Tab-layout `Outlet` clearance: `pb-[calc(6rem+env(safe-area-inset-bottom))]`
 * on the wrapper around every tab-root screen so content clears the fixed TabBar.
 */
const TAB_CLEARANCE_CLASS = 'pb-[calc(6rem+env(safe-area-inset-bottom))]'

/**
 * Builds a `Runtime` that provides `ServerRpcClient` with `handlers` in
 * place of the real (websocket-backed) rpc client — the same fake-runtime
 * idiom `router-fallback.test.tsx` / `account-screen.test.tsx` use.
 */
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

/** True when `el` or any ancestor carries the tab-layout bottom-clearance class. */
function hasTabClearanceAncestor(el: Element | null): boolean {
  let node: Element | null = el
  while (node !== null) {
    if (node.classList.contains(TAB_CLEARANCE_CLASS)) {
      return true
    }
    node = node.parentElement
  }
  return false
}

describe('router.tsx tab-layout Outlet clearance', () => {
  it(
    'wraps tab-root leaves (home-screen) with bottom clearance for the fixed TabBar, ' +
      'and does not wrap push-layout leaves (account-screen)',
    async () => {
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
        ServerInfo: () =>
          Effect.succeed(
            new ServerInfo({
              sha: 'abc1234',
              version: '0.0.1',
              serverTime: DateTime.unsafeMake('2026-07-08T00:00:00.000Z'),
            }),
          ),
        ListPasskeys: () => Effect.succeed([] as readonly PasskeySummary[]),
      })

      render(
        <RegistryProvider initialValues={[[ServerRpcClient.runtime, Result.success(fakeRuntime)]]}>
          <App />
        </RegistryProvider>,
      )

      // Tab-layout leaf (`/` → HomeScreen): must sit under the layout's
      // `pb-[calc(6rem+env(safe-area-inset-bottom))]` Outlet wrapper.
      const homeScreen = await screen.findByTestId('home-screen')
      expect(hasTabClearanceAncestor(homeScreen)).toBe(true)

      // Push-layout leaf (`/account` → AccountScreen): no TabBar, so no
      // tab-clearance wrapper may wrap this screen.
      await act(async () => {
        await router.navigate({ to: '/account' })
      })
      const accountScreen = await screen.findByTestId('account-screen')
      expect(hasTabClearanceAncestor(accountScreen)).toBe(false)
    },
  )
})
