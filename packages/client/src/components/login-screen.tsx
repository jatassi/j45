import * as React from 'react'

import * as Effect from 'effect/Effect'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import * as AuthApi from '@/lib/auth-api'
import * as Passkeys from '@/lib/passkeys'

type PinError =
  | { readonly _tag: 'InvalidCredentials' }
  | { readonly _tag: 'RateLimited'; readonly retryAfterSeconds: number }

type LoginScreenProps = {
  /** Called once a login attempt (passkey or PIN) produces a session. */
  readonly onAuthenticated: () => void
}

type LoginHandlers<E> = {
  readonly onFailure: (error: E) => void
  readonly onAuthenticated: () => void
  readonly onSettled: () => void
}

/** Runs a login `Effect`, routing its typed failure/success into React state. */
function runLogin<E>(effect: Effect.Effect<unknown, E>, handlers: LoginHandlers<E>): void {
  void Effect.runPromise(
    effect.pipe(
      Effect.match({
        onFailure: handlers.onFailure,
        onSuccess: () => {
          handlers.onAuthenticated()
        },
      }),
    ),
  ).finally(handlers.onSettled)
}

function usePinLogin(onAuthenticated: () => void) {
  const [username, setUsername] = React.useState('')
  const [pin, setPin] = React.useState('')
  const [error, setError] = React.useState<PinError | undefined>(undefined)
  const [submitting, setSubmitting] = React.useState(false)

  const handleSubmit = (event: React.SubmitEvent<HTMLFormElement>) => {
    event.preventDefault()
    setSubmitting(true)
    setError(undefined)
    runLogin(AuthApi.loginPin({ username, pin }), {
      onFailure: setError,
      onAuthenticated,
      onSettled: () => {
        setSubmitting(false)
      },
    })
  }

  return { username, setUsername, pin, setPin, error, submitting, handleSubmit }
}

function usePasskeyLogin(onAuthenticated: () => void) {
  const [failed, setFailed] = React.useState(false)
  const [submitting, setSubmitting] = React.useState(false)

  const handleClick = () => {
    setSubmitting(true)
    setFailed(false)
    runLogin(Passkeys.loginWithPasskey(), {
      onFailure: () => {
        setFailed(true)
      },
      onAuthenticated,
      onSettled: () => {
        setSubmitting(false)
      },
    })
  }

  return { failed, submitting, handleClick }
}

type PasskeySignInProps = {
  readonly submitting: boolean
  readonly failed: boolean
  readonly onClick: () => void
}

/** The primary, usernameless passkey sign-in button. */
function PasskeySignIn({ submitting, failed, onClick }: PasskeySignInProps) {
  return (
    <div className="flex flex-col gap-2">
      <Button
        type="button"
        className="w-full"
        disabled={submitting}
        data-testid="passkey-login-button"
        onClick={onClick}
      >
        Sign in with passkey
      </Button>
      {failed ? (
        <p role="alert" data-testid="passkey-login-error" className="text-sm text-destructive">
          Passkey sign-in didn&apos;t work — try your PIN below.
        </p>
      ) : null}
    </div>
  )
}

type PinFieldProps = {
  readonly id: string
  readonly label: string
  readonly value: string
  readonly onChange: (value: string) => void
  readonly type?: string
  readonly inputMode?: React.ComponentProps<'input'>['inputMode']
  readonly autoComplete: string
}

/** A labeled text input, shared by the username and PIN fields below. */
function PinField({ id, label, value, onChange, type, inputMode, autoComplete }: PinFieldProps) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-sm text-muted-foreground" htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        type={type}
        inputMode={inputMode}
        className="h-9 rounded-md border border-input bg-background px-2.5 text-sm"
        value={value}
        onChange={(event) => {
          onChange(event.target.value)
        }}
        autoComplete={autoComplete}
        required
      />
    </div>
  )
}

/** Renders `InvalidCredentials`/`RateLimited` distinctly (each gets its own testid and copy). */
function PinLoginError({ error }: { readonly error: PinError | undefined }) {
  if (error?._tag === 'InvalidCredentials') {
    return (
      <p
        role="alert"
        data-testid="login-error-invalid-credentials"
        className="text-sm text-destructive"
      >
        Incorrect username or PIN.
      </p>
    )
  }
  if (error?._tag === 'RateLimited') {
    return (
      <p role="alert" data-testid="login-error-rate-limited" className="text-sm text-destructive">
        Too many attempts — try again in {error.retryAfterSeconds}s.
      </p>
    )
  }
  return null
}

type PinLoginFormProps = ReturnType<typeof usePinLogin>

/** The username+PIN fallback form. */
function PinLoginForm(state: PinLoginFormProps) {
  return (
    <form className="flex flex-col gap-3" onSubmit={state.handleSubmit}>
      <PinField
        id="login-username"
        label="Username"
        value={state.username}
        onChange={state.setUsername}
        autoComplete="username"
      />
      <PinField
        id="login-pin"
        label="PIN"
        type="password"
        inputMode="numeric"
        value={state.pin}
        onChange={state.setPin}
        autoComplete="current-password"
      />
      <PinLoginError error={state.error} />
      <Button type="submit" variant="outline" className="w-full" disabled={state.submitting}>
        Sign in with PIN
      </Button>
    </form>
  )
}

/**
 * Primary passkey sign-in, a username+PIN fallback form, and an invite-code
 * entry point for first-timers — the anonymous state `AuthGate` renders.
 */
export function LoginScreen({ onAuthenticated }: LoginScreenProps) {
  const passkey = usePasskeyLogin(onAuthenticated)
  const pinLogin = usePinLogin(onAuthenticated)

  return (
    <div className="flex min-h-svh items-center justify-center p-6">
      <Card className="w-full max-w-sm" data-testid="login-screen">
        <CardHeader>
          <CardTitle>Sign in to J45</CardTitle>
          <CardDescription>Use a passkey, or your username and PIN.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <PasskeySignIn
            submitting={passkey.submitting}
            failed={passkey.failed}
            onClick={passkey.handleClick}
          />
          <PinLoginForm {...pinLogin} />
          <a
            className="text-center text-sm text-primary underline-offset-4 hover:underline"
            href="/register"
            data-testid="register-link"
          >
            Have an invite code? Register
          </a>
        </CardContent>
      </Card>
    </div>
  )
}
