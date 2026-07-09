// @vitest-environment jsdom
import { RegistryProvider, Result } from '@effect-atom/atom-react'
import { cleanup, render, screen } from '@testing-library/react'
import * as Effect from 'effect/Effect'
import * as Runtime from 'effect/Runtime'
import { afterEach, describe, expect, it, vi } from 'vitest'

import App from '@/app'
import { ServerRpcClient } from '@/lib/rpc-client'
import { router } from '@/router'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

/**
 * Builds a `Runtime` that provides `ServerRpcClient` with `handlers` in
 * place of the real (websocket-backed) rpc client — the same fake-runtime
 * idiom `account-screen.test.tsx`/`library-screen.test.tsx` use, seeding
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

const userJson = { id: 'u1', username: 'jill', displayName: 'Jill Owner', role: 'owner' as const }

describe('router.tsx catch-all', () => {
  it(
    "redirects an authenticated navigation to a path the route tree doesn't match — " +
      "including '/register?invite=…', the post-registration landing — to '/', with the " +
      'library home always reachable and never a blank page',
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

      const fakeRuntime = makeFakeRuntime({ ListWorkouts: () => Effect.succeed([]) })

      render(
        <RegistryProvider initialValues={[[ServerRpcClient.runtime, Result.success(fakeRuntime)]]}>
          <App />
        </RegistryProvider>,
      )

      // Starts out authenticated on the routed library home.
      await screen.findByTestId('library-screen')

      // The exact scenario the catch-all repairs: an authenticated navigation
      // lands on `/register?invite=…` (the post-registration landing, with no
      // route of its own) — using the router's own imperative `navigate` (the
      // same mechanism a `Link`/redirect drives) rather than a raw
      // `history.pushState`, so this exercises `router.tsx`'s real, singleton
      // route tree exactly as `RouterProvider` in `app.tsx` renders it.
      await router.navigate({ to: '/register', search: { invite: 'ABCD-1234' } })

      // No blank/unmatched page — the catch-all's `beforeLoad` redirect wins
      // before anything unmatched ever renders, landing back on the library.
      await screen.findByTestId('library-screen')
      expect(router.state.location.pathname).toBe('/')
    },
  )
})
