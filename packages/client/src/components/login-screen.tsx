import * as React from 'react'

import * as Effect from 'effect/Effect'
import { Fingerprint } from 'lucide-react'

import { AuthLayout } from '@/components/auth-layout'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Field, FieldGroup, FieldLabel, FieldSeparator } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
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
        <Fingerprint data-icon="inline-start" />
        Sign in with passkey
      </Button>
      {failed ? (
        <Alert variant="destructive" data-testid="passkey-login-error">
          <AlertDescription>
            Passkey sign-in didn&apos;t work — try your PIN below.
          </AlertDescription>
        </Alert>
      ) : null}
    </div>
  )
}

type AuthFieldProps = {
  readonly id: string
  readonly label: string
  readonly value: string
  readonly onChange: (value: string) => void
  readonly type?: string
  readonly inputMode?: React.ComponentProps<'input'>['inputMode']
  readonly autoComplete: string
}

/** A labeled kit field — username / PIN share this shape. */
function AuthField({ id, label, value, onChange, type, inputMode, autoComplete }: AuthFieldProps) {
  return (
    <Field orientation="vertical">
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Input
        id={id}
        type={type}
        inputMode={inputMode}
        value={value}
        onChange={(event) => {
          onChange(event.target.value)
        }}
        autoComplete={autoComplete}
        required
      />
    </Field>
  )
}

/** Renders `InvalidCredentials`/`RateLimited` distinctly (each gets its own testid and copy). */
function PinLoginError({ error }: { readonly error: PinError | undefined }) {
  if (error?._tag === 'InvalidCredentials') {
    return (
      <Alert variant="destructive" data-testid="login-error-invalid-credentials">
        <AlertDescription>Incorrect username or PIN.</AlertDescription>
      </Alert>
    )
  }
  if (error?._tag === 'RateLimited') {
    return (
      <Alert variant="destructive" data-testid="login-error-rate-limited">
        <AlertDescription>
          Too many attempts — try again in {error.retryAfterSeconds}s.
        </AlertDescription>
      </Alert>
    )
  }
  return null
}

type PinLoginFormProps = ReturnType<typeof usePinLogin>

/** The username+PIN fallback form. */
function PinLoginForm(state: PinLoginFormProps) {
  return (
    <form className="flex flex-col gap-4" onSubmit={state.handleSubmit}>
      <FieldGroup className="gap-3">
        <AuthField
          id="login-username"
          label="Username"
          value={state.username}
          onChange={state.setUsername}
          autoComplete="username"
        />
        <AuthField
          id="login-pin"
          label="PIN"
          type="password"
          inputMode="numeric"
          value={state.pin}
          onChange={state.setPin}
          autoComplete="current-password"
        />
      </FieldGroup>
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
    <AuthLayout>
      <Card className="w-full" data-testid="login-screen">
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
          <FieldSeparator>or</FieldSeparator>
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
    </AuthLayout>
  )
}
