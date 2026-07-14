// @vitest-environment jsdom
import { RegistryProvider, Result } from '@effect-atom/atom-react'
import { PasskeySummary, ServerInfo, User } from '@j45/domain'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import * as DateTime from 'effect/DateTime'
import * as Effect from 'effect/Effect'
import * as Runtime from 'effect/Runtime'
import * as Schema from 'effect/Schema'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import App from '@/app'
import { AccountScreen } from '@/components/account-screen'
import { ServerRpcClient } from '@/lib/rpc-client'
import { router } from '@/router'

import { stubLoginScreenGlobals } from './login-screen-globals.js'

vi.mock('@simplewebauthn/browser', () => ({
  startRegistration: vi.fn(() => Promise.resolve({ id: 'webauthn-response' })),
}))

// Logging out returns the gate to the anonymous `LoginScreen`, which needs
// these globals to mount.
beforeEach(() => {
  stubLoginScreenGlobals()
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

/**
 * `User.id`/`User.username` are branded (`UserId`/`Username`) — decoding
 * through the schema (rather than `new User(...)`) validates and brands
 * these plain strings, the same way a real `/auth/me` response body would.
 */
const user = Schema.decodeUnknownSync(User)({
  id: 'u1',
  username: 'jill',
  displayName: 'Jill Owner',
  role: 'owner',
})

/** `AccountScreen` mounts `ServerInfoCard`, so every fake runtime must answer its query. */
const serverInfoHandler = () =>
  Effect.succeed(
    new ServerInfo({
      sha: 'abc1234',
      version: '0.0.1',
      serverTime: DateTime.unsafeMake('2026-07-08T00:00:00.000Z'),
    }),
  )

/**
 * Builds a `Runtime` that provides `ServerRpcClient` with `handlers` in place
 * of the real (websocket-backed) rpc client. Presetting `ServerRpcClient.runtime`
 * itself (via `RegistryProvider`'s `initialValues`, below) short-circuits the
 * atom-rpc machinery's real `Layer` build for every atom derived from it
 * (`.query`, `.mutation`, `.runtime.fn`) — the same "seed the atom's cache"
 * trick `server-info-card.test.tsx` uses for a plain query atom, applied one
 * level up so it also covers the mutation/enroll atoms `AccountScreen` uses.
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

describe('AccountScreen', () => {
  it('shows the identity card, lists passkeys via ListPasskeys, adds one via the enroll helper, and deletes via DeletePasskey only after alert-dialog confirm', async () => {
    let passkeys: readonly PasskeySummary[] = [
      new PasskeySummary({
        id: 'seed-1',
        createdAt: DateTime.unsafeMake('2026-01-01T00:00:00.000Z'),
      }),
    ]
    let deleteCalls = 0

    const fakeRuntime = makeFakeRuntime({
      ServerInfo: serverInfoHandler,
      ListPasskeys: () => Effect.succeed(passkeys),
      DeletePasskey: (payload) => {
        deleteCalls += 1
        const { id } = payload as { id: string }
        passkeys = passkeys.filter((passkey) => passkey.id !== id)
        return Effect.succeed(undefined)
      },
      PasskeyEnrollStart: () => Effect.succeed({}),
      PasskeyEnrollFinish: () => {
        const created = new PasskeySummary({
          id: 'new-cred',
          createdAt: DateTime.unsafeMake('2026-07-08T00:00:00.000Z'),
        })
        passkeys = [...passkeys, created]
        return Effect.succeed(created)
      },
    })

    render(
      <RegistryProvider initialValues={[[ServerRpcClient.runtime, Result.success(fakeRuntime)]]}>
        <AccountScreen user={user} onLoggedOut={vi.fn()} />
      </RegistryProvider>,
    )

    expect(screen.getByTestId('account-screen')).toBeTruthy()
    expect(screen.getByTestId('account-avatar')).toBeTruthy()
    expect(screen.getByTestId('account-avatar').textContent).toBe('JO')
    expect(screen.getByTestId('account-display-name').textContent).toBe('Jill Owner')
    expect(screen.getByTestId('account-username').textContent).toBe('@jill')

    await screen.findByTestId('passkey-seed-1')

    fireEvent.click(screen.getByTestId('add-passkey-button'))
    await screen.findByTestId('passkey-new-cred')

    // Opening the delete dialog must not fire DeletePasskey on its own.
    fireEvent.click(screen.getByTestId('delete-passkey-seed-1'))
    const confirm = await screen.findByTestId('confirm-delete-passkey-seed-1')
    expect(deleteCalls).toBe(0)
    expect(screen.getByTestId('passkey-seed-1')).toBeTruthy()

    fireEvent.click(confirm)
    await waitFor(() => {
      expect(screen.queryByTestId('passkey-seed-1')).toBeNull()
    })
    expect(deleteCalls).toBe(1)
    expect(screen.getByTestId('passkey-new-cred')).toBeTruthy()
  })
})

describe('App', () => {
  it('reaches AccountScreen once authenticated; logout posts /auth/logout and returns the gate to anonymous', async () => {
    let loggedIn = true

    const userJson = { id: 'u1', username: 'jill', displayName: 'Jill Owner', role: 'owner' }

    vi.stubGlobal(
      'fetch',
      vi.fn((path: string) => {
        if (path === '/auth/me') {
          return Promise.resolve(
            loggedIn
              ? Response.json({ user: userJson }, { status: 200 })
              : Response.json({ _tag: 'Unauthorized' }, { status: 401 }),
          )
        }
        if (path === '/auth/logout') {
          loggedIn = false
          return Promise.resolve(new Response(null, { status: 204 }))
        }
        throw new Error(`unexpected fetch to ${path}`)
      }),
    )

    const fakeRuntime = makeFakeRuntime({
      ServerInfo: serverInfoHandler,
      ListPasskeys: () => Effect.succeed([]),
      ListWorkouts: () => Effect.succeed([]),
    })

    function Harness({ reloadKey }: { readonly reloadKey: number }) {
      return (
        <RegistryProvider
          key={reloadKey}
          initialValues={[[ServerRpcClient.runtime, Result.success(fakeRuntime)]]}
        >
          <App />
        </RegistryProvider>
      )
    }

    const { rerender } = render(<Harness reloadKey={0} />)

    // Authenticated lands on the home screen (`/`). Account is reached via
    // the shell avatar chip once the nav-shell lands; navigate imperatively
    // here (the old header nav link is gone).
    await screen.findByTestId('home-screen')
    await act(async () => {
      await router.navigate({ to: '/account' })
    })
    await screen.findByTestId('account-screen')

    // `App` wires `AccountScreen`'s `onLoggedOut` to `location.reload()` —
    // `AuthGate`'s session probe is private to `auth-gate.tsx`, so a full
    // reload (re-running that probe against the now-cleared cookie) is how
    // the gate flips back to anonymous. Stubbing `reload` to remount a fresh
    // `RegistryProvider` (a fresh atom registry, exactly what a real reload
    // gives you) reproduces that without a real navigation. (Only `reload`
    // is stubbed — `handleLoggedOut` never touches the rest of `Location`.)
    vi.stubGlobal('location', {
      reload: () => {
        rerender(<Harness reloadKey={1} />)
      },
    })

    fireEvent.click(screen.getByTestId('logout-button'))

    await screen.findByTestId('login-screen')
    expect(fetch).toHaveBeenCalledWith('/auth/logout', expect.objectContaining({ method: 'POST' }))
  })
})
