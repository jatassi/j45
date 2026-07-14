// @vitest-environment jsdom
import { RegistryProvider } from '@effect-atom/atom-react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import * as Option from 'effect/Option'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { AuthGate } from '@/components/auth-gate'
import * as LastUser from '@/lib/last-user'

import { stubLoginScreenGlobals } from './login-screen-globals.js'

beforeEach(() => {
  stubLoginScreenGlobals()
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

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
