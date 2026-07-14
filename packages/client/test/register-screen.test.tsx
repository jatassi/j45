// @vitest-environment jsdom
import { RegistryProvider, Result } from '@effect-atom/atom-react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { AuthGate } from '@/components/auth-gate'
import { enrollPasskeyAtom } from '@/lib/passkeys'

import { stubLoginScreenGlobals } from './login-screen-globals.js'

beforeEach(() => {
  stubLoginScreenGlobals()
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  globalThis.history.pushState({}, '', '/')
})

const userJson = {
  id: 'u2',
  username: 'newmember',
  displayName: 'New Member',
  role: 'member' as const,
}

function jsonResponse(status: number, body: unknown): Response {
  return Response.json(body, {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

type FetchHandler = (path: string) => Response | Promise<Response>

/** Stubs `global.fetch` the same way `auth-gate.test.tsx` does. */
function stubFetch(handler: FetchHandler): void {
  vi.stubGlobal(
    'fetch',
    vi.fn((path: string) => Promise.resolve(handler(path))),
  )
}

/**
 * Renders `AuthGate` at the given path, seeding `enrollPasskeyAtom` with
 * `Result.initial()` so mounting `EnrollPasskeyPrompt` (once registration
 * succeeds) never attempts a real rpc/WebSocket connection — the same
 * seeding technique `server-info-card.test.tsx` uses for its rpc atom.
 */
function renderAt(path: string) {
  globalThis.history.pushState({}, '', path)
  render(
    <RegistryProvider initialValues={[[enrollPasskeyAtom, Result.initial()]]}>
      <AuthGate>
        {(user) => <p data-testid="app-content">Signed in as {user.displayName}</p>}
      </AuthGate>
    </RegistryProvider>,
  )
}

function fillForm(fields: {
  readonly username: string
  readonly displayName: string
  readonly pin: string
}) {
  fireEvent.change(screen.getByLabelText('Username'), { target: { value: fields.username } })
  fireEvent.change(screen.getByLabelText('Display name'), {
    target: { value: fields.displayName },
  })
  fireEvent.change(screen.getByLabelText('PIN'), { target: { value: fields.pin } })
}

const submitRegisterForm = () => {
  fireEvent.click(screen.getByRole('button', { name: 'Create account' }))
}

describe('RegisterScreen', () => {
  it('prefills the code from ?invite= and, after registering, lands the user authenticated in the gate', async () => {
    let registered = false
    stubFetch((path) => {
      if (path === '/auth/me') {
        return registered
          ? jsonResponse(200, { user: userJson })
          : jsonResponse(401, { _tag: 'Unauthorized' })
      }
      if (path === '/auth/register') {
        registered = true
        return jsonResponse(200, { user: userJson })
      }
      throw new Error(`unexpected fetch to ${path}`)
    })

    renderAt('/register?invite=ABCD-1234')
    await screen.findByTestId('register-screen')

    expect(screen.getByLabelText<HTMLInputElement>('Invite code').value).toBe('ABCD-1234')

    fillForm({ username: 'newmember', displayName: 'New Member', pin: '1234' })
    submitRegisterForm()

    // the post-register passkey prompt (criterion 3) sits between submit and
    // the gate flipping — skip it to reach "authenticated in the gate".
    await screen.findByTestId('enroll-passkey-prompt')
    fireEvent.click(screen.getByTestId('enroll-passkey-skip'))

    const content = await screen.findByTestId('app-content')
    expect(content.textContent).toBe('Signed in as New Member')
  })

  it('renders InvalidInvite, UsernameTaken, and RateLimited distinctly without clearing the form', async () => {
    let attempt = 0
    stubFetch((path) => {
      if (path === '/auth/me') {
        return jsonResponse(401, { _tag: 'Unauthorized' })
      }
      if (path === '/auth/register') {
        attempt += 1
        if (attempt === 1) {
          return jsonResponse(400, { _tag: 'InvalidInvite' })
        }
        if (attempt === 2) {
          return jsonResponse(400, { _tag: 'UsernameTaken' })
        }
        return jsonResponse(429, { _tag: 'RateLimited', retryAfterSeconds: 300 })
      }
      throw new Error(`unexpected fetch to ${path}`)
    })

    renderAt('/register?invite=WRONG-CODE')
    await screen.findByTestId('register-screen')

    fillForm({ username: 'jill', displayName: 'Jill', pin: '4242' })

    submitRegisterForm()
    await screen.findByTestId('register-error-invalid-invite')

    submitRegisterForm()
    await screen.findByTestId('register-error-username-taken')

    submitRegisterForm()
    const rateLimited = await screen.findByTestId('register-error-rate-limited')
    expect(rateLimited.textContent).toContain('300s')

    // none of the three failures cleared the form
    expect(screen.getByLabelText<HTMLInputElement>('Invite code').value).toBe('WRONG-CODE')
    expect(screen.getByLabelText<HTMLInputElement>('Username').value).toBe('jill')
    expect(screen.getByLabelText<HTMLInputElement>('Display name').value).toBe('Jill')
    expect(screen.getByLabelText<HTMLInputElement>('PIN').value).toBe('4242')
  })

  it('offers a skippable passkey-enrollment prompt on success, and skipping it proceeds straight to the app', async () => {
    let registered = false
    stubFetch((path) => {
      if (path === '/auth/me') {
        return registered
          ? jsonResponse(200, { user: userJson })
          : jsonResponse(401, { _tag: 'Unauthorized' })
      }
      if (path === '/auth/register') {
        registered = true
        return jsonResponse(200, { user: userJson })
      }
      throw new Error(`unexpected fetch to ${path}`)
    })

    renderAt('/register?invite=ABCD-1234')
    await screen.findByTestId('register-screen')

    fillForm({ username: 'newmember', displayName: 'New Member', pin: '1234' })
    submitRegisterForm()

    await screen.findByTestId('enroll-passkey-prompt')
    // it offers passkey enrollment via the shared enroll helper...
    expect(screen.getByTestId('enroll-passkey-button')).toBeTruthy()
    // ...but skipping alone is enough to proceed to the app.
    fireEvent.click(screen.getByTestId('enroll-passkey-skip'))

    const content = await screen.findByTestId('app-content')
    expect(content.textContent).toBe('Signed in as New Member')
  })
})
