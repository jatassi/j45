import * as React from 'react'

import * as Effect from 'effect/Effect'

import { EnrollPasskeyPrompt } from '@/components/enroll-passkey-prompt'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import * as AuthApi from '@/lib/auth-api'

type RegisterFormError =
  | { readonly _tag: 'InvalidInvite' }
  | { readonly _tag: 'UsernameTaken' }
  | { readonly _tag: 'RateLimited'; readonly retryAfterSeconds: number }

type RegisterScreenProps = {
  /**
   * Called once the caller is fully done registering — the account is
   * created and the post-register passkey prompt has been enrolled in or
   * skipped. Mirrors `LoginScreenProps.onAuthenticated`; `AuthGate` passes
   * its `refreshMe` so the gate flips to `authenticated` and the app renders.
   */
  readonly onAuthenticated: () => void
}

/** The invite code from `?invite=…`, read once at mount — the `/register` deep link's payload. */
function inviteCodeFromLocation(): string {
  return new URLSearchParams(globalThis.location.search).get('invite') ?? ''
}

function useRegisterForm(onRegistered: () => void) {
  const [code, setCode] = React.useState(inviteCodeFromLocation)
  const [username, setUsername] = React.useState('')
  const [displayName, setDisplayName] = React.useState('')
  const [pin, setPin] = React.useState('')
  const [error, setError] = React.useState<RegisterFormError | undefined>(undefined)
  const [submitting, setSubmitting] = React.useState(false)

  const handleSubmit = (event: React.SubmitEvent<HTMLFormElement>) => {
    event.preventDefault()
    setSubmitting(true)
    setError(undefined)
    void Effect.runPromise(
      AuthApi.register({ code, username, displayName, pin }).pipe(
        Effect.match({
          onFailure: setError,
          onSuccess: () => {
            onRegistered()
          },
        }),
      ),
    ).finally(() => {
      setSubmitting(false)
    })
  }

  return {
    code,
    setCode,
    username,
    setUsername,
    displayName,
    setDisplayName,
    pin,
    setPin,
    error,
    submitting,
    handleSubmit,
  }
}

type FieldProps = {
  readonly id: string
  readonly label: string
  readonly value: string
  readonly onChange: (value: string) => void
  readonly type?: string
  readonly inputMode?: React.ComponentProps<'input'>['inputMode']
  readonly autoComplete: string
}

/** A labeled text input — the same shape `login-screen.tsx`'s `PinField` uses. */
function Field({ id, label, value, onChange, type, inputMode, autoComplete }: FieldProps) {
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

/** Renders `InvalidInvite`/`UsernameTaken`/`RateLimited` distinctly, each with its own testid and copy. */
function RegisterErrorMessage({ error }: { readonly error: RegisterFormError | undefined }) {
  if (error?._tag === 'InvalidInvite') {
    return (
      <p
        role="alert"
        data-testid="register-error-invalid-invite"
        className="text-sm text-destructive"
      >
        That invite code isn&apos;t valid — check it and try again.
      </p>
    )
  }
  if (error?._tag === 'UsernameTaken') {
    return (
      <p
        role="alert"
        data-testid="register-error-username-taken"
        className="text-sm text-destructive"
      >
        That username is already taken.
      </p>
    )
  }
  if (error?._tag === 'RateLimited') {
    return (
      <p
        role="alert"
        data-testid="register-error-rate-limited"
        className="text-sm text-destructive"
      >
        Too many attempts — try again in {error.retryAfterSeconds}s.
      </p>
    )
  }
  return null
}

type RegisterFormProps = ReturnType<typeof useRegisterForm>

/** The code/username/display-name/PIN registration form. */
function RegisterForm(state: RegisterFormProps) {
  return (
    <form className="flex flex-col gap-3" onSubmit={state.handleSubmit}>
      <Field
        id="register-code"
        label="Invite code"
        value={state.code}
        onChange={state.setCode}
        autoComplete="off"
      />
      <Field
        id="register-username"
        label="Username"
        value={state.username}
        onChange={state.setUsername}
        autoComplete="username"
      />
      <Field
        id="register-display-name"
        label="Display name"
        value={state.displayName}
        onChange={state.setDisplayName}
        autoComplete="name"
      />
      <Field
        id="register-pin"
        label="PIN"
        type="password"
        inputMode="numeric"
        value={state.pin}
        onChange={state.setPin}
        autoComplete="new-password"
      />
      <RegisterErrorMessage error={state.error} />
      <Button type="submit" className="w-full" disabled={state.submitting}>
        Create account
      </Button>
    </form>
  )
}

/**
 * `/register?invite=…` — prefills the code, then submits code/username/
 * display name/PIN to `POST /auth/register`. On success it shows the
 * skippable `EnrollPasskeyPrompt` before calling `onAuthenticated`; a typed
 * `InvalidInvite`/`UsernameTaken`/`RateLimited` failure renders distinctly
 * without clearing the form.
 */
export function RegisterScreen({ onAuthenticated }: RegisterScreenProps) {
  const [phase, setPhase] = React.useState<'form' | 'enroll'>('form')
  const form = useRegisterForm(() => {
    setPhase('enroll')
  })

  if (phase === 'enroll') {
    return <EnrollPasskeyPrompt onDone={onAuthenticated} />
  }

  return (
    <div className="flex min-h-svh items-center justify-center p-6">
      <Card className="w-full max-w-sm" data-testid="register-screen">
        <CardHeader>
          <CardTitle>Create your account</CardTitle>
          <CardDescription>Redeem your invite code to join J45.</CardDescription>
        </CardHeader>
        <CardContent>
          <RegisterForm {...form} />
        </CardContent>
      </Card>
    </div>
  )
}
