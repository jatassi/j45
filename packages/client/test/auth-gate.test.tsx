// @vitest-environment jsdom
import { RegistryProvider } from '@effect-atom/atom-react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import * as Option from 'effect/Option'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { AuthGate } from '@/components/auth-gate'
import { reportAuthSessionExpired } from '@/lib/auth-session-expiry'
import * as LastUser from '@/lib/last-user'

import { stubLoginScreenGlobals } from './login-screen-globals.js'
import { flushPinFieldTimers } from './pin-field-timers.js'

beforeEach(() => {
  stubLoginScreenGlobals()
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

// Keeps the jsdom environment open until the PIN field's uncleared timers
// have fired. See `flushPinFieldTimers`.
afterAll(flushPinFieldTimers)

const userJson = {
  id: 'u1',
  username: 'jill',
  displayName: 'Jill Owner',
  role: 'owner' as const,
}

function jsonResponse(status: number, body: unknown): Response {
  return Response.json(body, {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

type FetchHandler = (path: string) => Response | Promise<Response>

/**
 * Stubs `global.fetch` so `lib/auth-api.ts`'s real fetch calls hit `handler`
 * instead of the network. `lib/auth-api.ts` only ever calls `fetch` with a
 * plain path string, never a `Request`/`URL`, so narrowing to `string` here
 * (rather than the full `RequestInfo | URL` fetch accepts) is exact, not a
 * shortcut.
 */
function stubFetch(handler: FetchHandler): void {
  vi.stubGlobal(
    'fetch',
    vi.fn((path: string) => Promise.resolve(handler(path))),
  )
}

function renderGate() {
  render(
    <RegistryProvider>
      <AuthGate>
        {(user) => <p data-testid="app-content">Signed in as {user.displayName}</p>}
      </AuthGate>
    </RegistryProvider>,
  )
}

describe('AuthGate', () => {
  it('shows loading, then renders the app with the user once GET /auth/me succeeds', async () => {
    stubFetch(() => jsonResponse(200, { user: userJson }))

    renderGate()
    expect(screen.getByTestId('auth-gate-loading')).toBeTruthy()

    const content = await screen.findByTestId('app-content')
    expect(content.textContent).toBe('Signed in as Jill Owner')
  })

  it('a reported session expiry re-probes /auth/me and returns to LoginScreen — no manual reload', async () => {
    let signedIn = true
    let probes = 0
    stubFetch((path) => {
      if (path !== '/auth/me') {
        throw new Error(`unexpected fetch to ${path}`)
      }
      probes += 1
      return signedIn
        ? jsonResponse(200, { user: userJson })
        : jsonResponse(401, { _tag: 'Unauthorized' })
    })

    renderGate()
    await screen.findByTestId('app-content')
    expect(probes).toBe(1)

    // The cookie is revoked server-side: rpcs start failing Unauthorized, and
    // the rpc chokepoint reports it. The gate must act on that by itself.
    signedIn = false
    act(() => {
      reportAuthSessionExpired()
    })

    await screen.findByTestId('login-screen')
    expect(screen.queryByTestId('app-content')).toBeNull()
    expect(probes).toBe(2)
  })

  it('renders LoginScreen when GET /auth/me is Unauthorized (anonymous)', async () => {
    stubFetch(() => jsonResponse(401, { _tag: 'Unauthorized' }))

    renderGate()

    await screen.findByTestId('login-screen')
    expect(screen.getByTestId('passkey-login-button')).toBeTruthy()
    const registerLink = screen.getByRole('link', { name: /invite code/i })
    expect(registerLink.getAttribute('href')).toBe('/register')
  })
})

describe('LoginScreen', () => {
  it('renders InvalidCredentials and RateLimited distinctly, then flips authenticated on success', async () => {
    let loggedIn = false
    let pinAttempts = 0

    stubFetch((path) => {
      if (path === '/auth/me') {
        return loggedIn
          ? jsonResponse(200, { user: userJson })
          : jsonResponse(401, { _tag: 'Unauthorized' })
      }
      if (path === '/auth/login/pin') {
        pinAttempts += 1
        if (pinAttempts === 1) {
          return jsonResponse(401, { _tag: 'InvalidCredentials' })
        }
        if (pinAttempts === 2) {
          return jsonResponse(429, { _tag: 'RateLimited', retryAfterSeconds: 900 })
        }
        loggedIn = true
        return jsonResponse(200, { user: userJson })
      }
      throw new Error(`unexpected fetch to ${path}`)
    })

    renderGate()
    await screen.findByTestId('login-screen')

    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'jill' } })
    // Completing the fourth digit auto-submits (attempt 1) — no click needed.
    fireEvent.change(screen.getByLabelText('PIN'), { target: { value: '0000' } })
    await screen.findByTestId('login-error-invalid-credentials')

    // The PIN is unchanged after a failure, so retries go through the button.
    const submitPin = () => {
      fireEvent.click(screen.getByRole('button', { name: 'Sign in with PIN' }))
    }

    submitPin()
    const rateLimited = await screen.findByTestId('login-error-rate-limited')
    expect(rateLimited.textContent).toContain('900s')

    submitPin()
    await screen.findByTestId('app-content')

    // The successful PIN sign-in is remembered for the next login screen.
    const remembered = LastUser.load()
    expect(Option.isSome(remembered)).toBe(true)
    expect(Option.getOrThrow(remembered)).toEqual({ username: 'jill', displayName: 'Jill Owner' })
  })

  it("surfaces an undeclared response (e.g. the CSRF guard's Forbidden) as the unexpected-failure alert", async () => {
    stubFetch((path) => {
      if (path === '/auth/me') {
        return jsonResponse(401, { _tag: 'Unauthorized' })
      }
      if (path === '/auth/login/pin') {
        // The origin guard's answer to a non-allowlisted Origin — absent from
        // loginPin's declared error schema, so it reaches the screen as a
        // defect, which must still show the user something.
        return jsonResponse(403, { _tag: 'Forbidden' })
      }
      throw new Error(`unexpected fetch to ${path}`)
    })

    renderGate()
    await screen.findByTestId('login-screen')

    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'jill' } })
    // Completing the fourth digit auto-submits.
    fireEvent.change(screen.getByLabelText('PIN'), { target: { value: '0000' } })

    await screen.findByTestId('login-error-unexpected')
  })

  it('replaces the username field with the remembered-user card; "Not you?" restores the field', async () => {
    stubFetch(() => jsonResponse(401, { _tag: 'Unauthorized' }))
    LastUser.save({ username: 'jill', displayName: 'Jill Owner' })

    renderGate()
    await screen.findByTestId('login-screen')

    const card = screen.getByTestId('remembered-user-card')
    expect(card.textContent).toContain('Jill Owner')
    expect(card.textContent).toContain('@jill')
    expect(screen.queryByLabelText('Username')).toBeNull()

    fireEvent.click(screen.getByTestId('remembered-user-forget'))
    expect(screen.queryByTestId('remembered-user-card')).toBeNull()
    expect(screen.getByLabelText('Username')).toBeTruthy()
    expect(Option.isNone(LastUser.load())).toBe(true)
  })
})
