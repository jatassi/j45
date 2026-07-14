import * as React from 'react'

import { PIN_LENGTH } from '@j45/domain'
import * as Effect from 'effect/Effect'
import * as Option from 'effect/Option'
import { Fingerprint } from 'lucide-react'

import { AuthLayout } from '@/components/auth-layout'
import { PinField } from '@/components/pin-field'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Field, FieldGroup, FieldLabel, FieldSeparator } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import * as AuthApi from '@/lib/auth-api'
import { displayInitials } from '@/lib/initials'
import * as LastUser from '@/lib/last-user'
import * as Passkeys from '@/lib/passkeys'

type PinError =
  | { readonly _tag: 'InvalidCredentials' }
  | { readonly _tag: 'RateLimited'; readonly retryAfterSeconds: number }

type LoginScreenProps = {
  /** Called once a login attempt (passkey or PIN) produces a session. */
  readonly onAuthenticated: () => void
}

type LoginHandlers<A, E> = {
  readonly onFailure: (error: E) => void
  readonly onSuccess: (value: A) => void
  readonly onSettled: () => void
}

/** Runs a login `Effect`, routing its typed failure/success into React state. */
function runLogin<A, E>(effect: Effect.Effect<A, E>, handlers: LoginHandlers<A, E>): void {
  void Effect.runPromise(
    effect.pipe(
      Effect.match({
        onFailure: handlers.onFailure,
        onSuccess: handlers.onSuccess,
      }),
    ),
  ).finally(handlers.onSettled)
}

/**
 * The remembered identity (`lib/last-user.ts`) and the username it seeds.
 * Loaded once per mount — the login screen unmounts on authentication, so
 * there's no path that changes storage while this screen is showing.
 */
function useRememberedUser() {
  const [remembered, setRemembered] = React.useState(LastUser.load)
  const [username, setUsername] = React.useState(() =>
    Option.match(remembered, {
      onNone: () => '',
      onSome: (last) => last.username,
    }),
  )

  /** "Not you?" — drop the remembered identity and fall back to the field. */
  const forgetRemembered = () => {
    LastUser.clear()
    setRemembered(Option.none())
    setUsername('')
  }

  return { remembered, username, setUsername, forgetRemembered }
}

function usePinLogin(onAuthenticated: () => void) {
  const { remembered, username, setUsername, forgetRemembered } = useRememberedUser()
  const [pin, setPin] = React.useState('')
  const [error, setError] = React.useState<PinError | undefined>(undefined)
  const [submitting, setSubmitting] = React.useState(false)

  const login = (pinValue: string) => {
    if (submitting) {
      return
    }
    setSubmitting(true)
    setError(undefined)
    runLogin(AuthApi.loginPin({ username, pin: pinValue }), {
      onFailure: setError,
      onSuccess: (user) => {
        LastUser.save({ username: user.username, displayName: user.displayName })
        onAuthenticated()
      },
      onSettled: () => {
        setSubmitting(false)
      },
    })
  }

  const handleSubmit = (event: React.SubmitEvent<HTMLFormElement>) => {
    event.preventDefault()
    login(pin)
  }

  /**
   * iOS-passcode style: the fourth digit submits on its own — but only once
   * there's a username to pair it with (typing the PIN before the username
   * must not fire a doomed attempt).
   */
  const handlePinComplete = (pinValue: string) => {
    if (username === '') {
      return
    }
    login(pinValue)
  }

  return {
    remembered,
    forgetRemembered,
    username,
    setUsername,
    pin,
    setPin,
    error,
    submitting,
    handleSubmit,
    handlePinComplete,
  }
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
      onSuccess: () => {
        onAuthenticated()
      },
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

type RememberedUserCardProps = {
  readonly user: LastUser.LastUser
  readonly onForget: () => void
}

/** Stands in for the username field when a previous PIN sign-in is remembered. */
function RememberedUserCard({ user, onForget }: RememberedUserCardProps) {
  return (
    <div
      className="flex items-center gap-3 rounded-md border border-input p-3"
      data-testid="remembered-user-card"
    >
      <Avatar>
        <AvatarFallback>{displayInitials(user.displayName)}</AvatarFallback>
      </Avatar>
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm font-medium">{user.displayName}</span>
        <span className="truncate text-xs text-muted-foreground">@{user.username}</span>
      </div>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        data-testid="remembered-user-forget"
        onClick={onForget}
      >
        Not you?
      </Button>
    </div>
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
        {Option.match(state.remembered, {
          onNone: () => (
            <Field orientation="vertical">
              <FieldLabel htmlFor="login-username">Username</FieldLabel>
              <Input
                id="login-username"
                value={state.username}
                onChange={(event) => {
                  state.setUsername(event.target.value)
                }}
                autoComplete="username"
                required
              />
            </Field>
          ),
          onSome: (last) => <RememberedUserCard user={last} onForget={state.forgetRemembered} />,
        })}
        <PinField
          id="login-pin"
          value={state.pin}
          onChange={state.setPin}
          onComplete={state.handlePinComplete}
          autoComplete="current-password"
        />
      </FieldGroup>
      <PinLoginError error={state.error} />
      <Button
        type="submit"
        variant="outline"
        className="w-full"
        disabled={state.submitting || state.pin.length !== PIN_LENGTH}
      >
        Sign in with PIN
      </Button>
    </form>
  )
}

/**
 * Primary passkey sign-in, a username+PIN fallback form, and an invite-code
 * entry point for first-timers — the anonymous state `AuthGate` renders.
 * A remembered PIN sign-in (`lib/last-user.ts`) replaces the username field
 * with an identity card; "Not you?" falls back to the plain field.
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
