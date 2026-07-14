import * as React from 'react'

import { PIN_LENGTH } from '@j45/domain'
import * as Effect from 'effect/Effect'

import { AuthLayout } from '@/components/auth-layout'
import { EnrollPasskeyPrompt } from '@/components/enroll-passkey-prompt'
import { PinField } from '@/components/pin-field'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
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

type AuthFieldProps = {
  readonly id: string
  readonly label: string
  readonly value: string
  readonly onChange: (value: string) => void
  readonly type?: string
  readonly inputMode?: React.ComponentProps<'input'>['inputMode']
  readonly autoComplete: string
}

/** A labeled kit field — invite / username / display name / PIN share this shape. */
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

/** Renders `InvalidInvite`/`UsernameTaken`/`RateLimited` distinctly, each with its own testid and copy. */
function RegisterErrorMessage({ error }: { readonly error: RegisterFormError | undefined }) {
  if (error?._tag === 'InvalidInvite') {
    return (
      <Alert variant="destructive" data-testid="register-error-invalid-invite">
        <AlertDescription>
          That invite code isn&apos;t valid — check it and try again.
        </AlertDescription>
      </Alert>
    )
  }
  if (error?._tag === 'UsernameTaken') {
    return (
      <Alert variant="destructive" data-testid="register-error-username-taken">
        <AlertDescription>That username is already taken.</AlertDescription>
      </Alert>
    )
  }
  if (error?._tag === 'RateLimited') {
    return (
      <Alert variant="destructive" data-testid="register-error-rate-limited">
        <AlertDescription>
          Too many attempts — try again in {error.retryAfterSeconds}s.
        </AlertDescription>
      </Alert>
    )
  }
  return null
}

type RegisterFormProps = ReturnType<typeof useRegisterForm>

/** The code/username/display-name/PIN registration form. */
function RegisterForm(state: RegisterFormProps) {
  return (
    <form className="flex flex-col gap-4" onSubmit={state.handleSubmit}>
      <FieldGroup className="gap-3">
        <AuthField
          id="register-code"
          label="Invite code"
          value={state.code}
          onChange={state.setCode}
          autoComplete="off"
        />
        <AuthField
          id="register-username"
          label="Username"
          value={state.username}
          onChange={state.setUsername}
          autoComplete="username"
        />
        <AuthField
          id="register-display-name"
          label="Display name"
          value={state.displayName}
          onChange={state.setDisplayName}
          autoComplete="name"
        />
        <PinField
          id="register-pin"
          value={state.pin}
          onChange={state.setPin}
          autoComplete="new-password"
        />
      </FieldGroup>
      <RegisterErrorMessage error={state.error} />
      <Button
        type="submit"
        className="w-full"
        disabled={state.submitting || state.pin.length !== PIN_LENGTH}
      >
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
    <AuthLayout>
      <Card className="w-full" data-testid="register-screen">
        <CardHeader>
          <CardTitle>Create your account</CardTitle>
          <CardDescription>Redeem your invite code to join J45.</CardDescription>
        </CardHeader>
        <CardContent>
          <RegisterForm {...form} />
        </CardContent>
      </Card>
    </AuthLayout>
  )
}
