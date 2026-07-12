import * as React from 'react'

import { useAtomSet } from '@effect-atom/atom-react'
import * as Exit from 'effect/Exit'
import { Fingerprint } from 'lucide-react'

import { AuthLayout } from '@/components/auth-layout'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { enrollPasskeyAtom } from '@/lib/passkeys'

type EnrollPasskeyPromptProps = {
  /**
   * Called once the caller is done here — whether they enrolled a passkey
   * or skipped — either way the next screen is the app.
   */
  readonly onDone: () => void
}

/** Drives `lib/passkeys.ts`'s `enrollPasskeyAtom` and reports submitting/failed state. */
function useEnrollPasskey(onDone: () => void) {
  const enroll = useAtomSet(enrollPasskeyAtom, { mode: 'promiseExit' })
  const [submitting, setSubmitting] = React.useState(false)
  const [failed, setFailed] = React.useState(false)

  const handleEnroll = () => {
    setSubmitting(true)
    setFailed(false)
    void enroll().then((exit) => {
      setSubmitting(false)
      if (Exit.isSuccess(exit)) {
        onDone()
      } else {
        setFailed(true)
      }
    })
  }

  return { submitting, failed, handleEnroll }
}

/**
 * The one-time, skippable "Add Face ID / fingerprint?" prompt shown right
 * after a successful registration (see `register-screen.tsx`), offering
 * passkey enrollment via the shared `enrollPasskey` helper before handing
 * off to the app.
 */
export function EnrollPasskeyPrompt({ onDone }: EnrollPasskeyPromptProps) {
  const { submitting, failed, handleEnroll } = useEnrollPasskey(onDone)

  return (
    <AuthLayout>
      <Card className="w-full" data-testid="enroll-passkey-prompt">
        <CardHeader>
          <CardTitle>Add Face ID or fingerprint?</CardTitle>
          <CardDescription>
            Sign in faster next time with a passkey. You can always add one later from your account.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {failed ? (
            <Alert variant="destructive" data-testid="enroll-passkey-error">
              <AlertDescription>
                That didn&apos;t work — you can try again later from your account.
              </AlertDescription>
            </Alert>
          ) : null}
          <Button
            type="button"
            className="w-full"
            disabled={submitting}
            data-testid="enroll-passkey-button"
            onClick={handleEnroll}
          >
            <Fingerprint data-icon="inline-start" />
            Add passkey
          </Button>
          <Button
            type="button"
            variant="outline"
            className="w-full"
            disabled={submitting}
            data-testid="enroll-passkey-skip"
            onClick={onDone}
          >
            Skip
          </Button>
        </CardContent>
      </Card>
    </AuthLayout>
  )
}
