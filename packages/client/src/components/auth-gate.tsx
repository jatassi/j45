import type * as React from 'react'

import { Atom, Result, useAtomRefresh, useAtomValue } from '@effect-atom/atom-react'
import type { User } from '@j45/domain'

import { LoginScreen } from '@/components/login-screen'
import { RegisterScreen } from '@/components/register-screen'
import * as AuthApi from '@/lib/auth-api'

/**
 * The `GET /auth/me` session probe, fetched once `AuthGate` mounts
 * ("on load"). `Result.Failure` here is the expected `Unauthorized` —
 * anonymous — state, not a defect; see `lib/auth-api.ts`'s `me`.
 */
const meAtom = Atom.make(AuthApi.me())

type AuthGateProps = {
  /**
   * Rendered once the session probe succeeds, with the signed-in `User` —
   * the render-prop shape (rather than context) keeps this the only export
   * from the file, matching the `Result.match`/render-prop callback idiom
   * this codebase already carves out of `react-refresh/only-export-components`.
   */
  readonly children: (user: User) => React.ReactNode
}

/**
 * `/register?invite=…` is the one other entry state this app understands —
 * decided from `window.location` here (no routing library yet, per the
 * design: "this feature needs exactly two entry states"). Anonymous visitors
 * to any other path see `LoginScreen`.
 */
function isRegisterRoute(): boolean {
  return globalThis.location.pathname === '/register'
}

/**
 * Wraps the app content: fetches `GET /auth/me` on load into
 * `loading | anonymous | authenticated(User)`. Anonymous renders
 * `RegisterScreen` on `/register` and `LoginScreen` everywhere else;
 * authenticated renders `children` with the user available. A successful
 * login or registration (passkey prompt included) refreshes the probe,
 * which now succeeds because the session cookie is set — flipping the gate
 * over.
 */
export function AuthGate({ children }: AuthGateProps) {
  const me = useAtomValue(meAtom)
  const refreshMe = useAtomRefresh(meAtom)

  return Result.match(me, {
    onInitial: () => (
      <div className="flex min-h-svh items-center justify-center" data-testid="auth-gate-loading">
        <p className="text-sm text-muted-foreground">Loading…</p>
      </div>
    ),
    onFailure: () =>
      isRegisterRoute() ? (
        <RegisterScreen onAuthenticated={refreshMe} />
      ) : (
        <LoginScreen onAuthenticated={refreshMe} />
      ),
    onSuccess: ({ value }) => children(value),
  })
}
