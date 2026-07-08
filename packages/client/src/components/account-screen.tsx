import * as React from 'react'

import { Result, useAtom, useAtomRefresh, useAtomValue } from '@effect-atom/atom-react'
import type { User } from '@j45/domain'
import * as Effect from 'effect/Effect'

import { PeopleInvites } from '@/components/people-invites'
import { ServerInfoCard } from '@/components/server-info-card'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import * as AuthApi from '@/lib/auth-api'
import * as Passkeys from '@/lib/passkeys'
import { ServerRpcClient } from '@/lib/rpc-client'

/**
 * The `ListPasskeys` query, the enroll "fn" atom (runs the shared
 * `Passkeys.enrollPasskey` helper through the rpc client's runtime, per that
 * helper's own doc comment), and the `DeletePasskey` mutation — hoisted to
 * module scope like `auth-gate.tsx`'s `meAtom`, so `useAtomValue`/`useAtom`
 * key off a stable atom identity across re-renders rather than constructing a
 * fresh one (and losing in-flight state) every render.
 */
const listPasskeysAtom = ServerRpcClient.query('ListPasskeys', undefined)
const enrollPasskeyAtom = ServerRpcClient.runtime.fn(() => Passkeys.enrollPasskey)
const deletePasskeyAtom = ServerRpcClient.mutation('DeletePasskey')

type AccountScreenProps = {
  readonly user: User
  /**
   * Called once `POST /auth/logout` succeeds. `AccountScreen` has no way to
   * flip `AuthGate`'s session probe itself (that atom is private to
   * `auth-gate.tsx`), so the caller wires this to whatever puts the gate back
   * in its anonymous state — see `app.tsx`.
   */
  readonly onLoggedOut: () => void
}

type PasskeyRowProps = {
  readonly id: string
  readonly onDelete: () => void
}

/** One row of the passkey list: the credential id and a delete button. */
function PasskeyRow({ id, onDelete }: PasskeyRowProps) {
  return (
    <li className="flex items-center justify-between gap-2 text-sm" data-testid={`passkey-${id}`}>
      <span className="truncate font-mono">{id}</span>
      <Button
        type="button"
        variant="outline"
        size="sm"
        data-testid={`delete-passkey-${id}`}
        onClick={onDelete}
      >
        Delete
      </Button>
    </li>
  )
}

/** Lists the caller's passkeys (`ListPasskeys`) and deletes one (`DeletePasskey`) on request. */
function PasskeyList() {
  const passkeys = useAtomValue(listPasskeysAtom)
  const refreshPasskeys = useAtomRefresh(listPasskeysAtom)
  const [, deletePasskey] = useAtom(deletePasskeyAtom, { mode: 'promise' })

  const handleDelete = (id: string) => {
    void deletePasskey({ payload: { id } })
      .then(() => {
        refreshPasskeys()
      })
      .catch(() => {
        // The delete atom's own `Result` already carries the failure; this
        // catch only exists so the rejected promise doesn't go unhandled.
      })
  }

  return Result.match(passkeys, {
    onInitial: () => <p className="text-sm text-muted-foreground">Loading passkeys…</p>,
    onFailure: (failure) => (
      <p className="text-sm text-destructive">Failed to load passkeys: {String(failure.cause)}</p>
    ),
    onSuccess: ({ value }) =>
      value.length === 0 ? (
        <p className="text-sm text-muted-foreground" data-testid="passkey-list-empty">
          No passkeys yet.
        </p>
      ) : (
        <ul className="flex flex-col gap-2" data-testid="passkey-list">
          {value.map((passkey) => (
            <PasskeyRow
              key={passkey.id}
              id={passkey.id}
              onDelete={() => {
                handleDelete(passkey.id)
              }}
            />
          ))}
        </ul>
      ),
  })
}

/** Drives `Passkeys.enrollPasskey` from a click, then refreshes the list on success. */
function useEnrollPasskey() {
  const refreshPasskeys = useAtomRefresh(listPasskeysAtom)
  const [result, enroll] = useAtom(enrollPasskeyAtom, { mode: 'promise' })

  const handleEnroll = () => {
    void enroll(undefined)
      .then(() => {
        refreshPasskeys()
      })
      .catch(() => {
        // Surfaced via `result` below — the ceremony failing (cancelled,
        // unsupported, rejected by the server) isn't a defect.
      })
  }

  return { submitting: Result.isWaiting(result), failed: Result.isFailure(result), handleEnroll }
}

/** Posts `/auth/logout`, then calls `onLoggedOut`. */
function useLogout(onLoggedOut: () => void) {
  const [submitting, setSubmitting] = React.useState(false)

  const handleLogout = () => {
    setSubmitting(true)
    void Effect.runPromise(AuthApi.logout())
      .then(onLoggedOut)
      .finally(() => {
        setSubmitting(false)
      })
  }

  return { submitting, handleLogout }
}

/**
 * The authenticated account surface `AuthGate` renders once `GET /auth/me`
 * succeeds: display name and username, the caller's passkeys (list, add,
 * delete), and logout. The e2e passkey-enrollment and logout flows drive
 * this screen directly. For `user.role === "owner"` it additionally renders
 * `PeopleInvites` — the owner-only "People & Invites" section; for a member
 * that section isn't mounted at all, so none of its UI renders and none of
 * its rpcs are ever called. Also mounts `ServerInfoCard`: the walking
 * skeleton's rpc round-trip proof lives behind the gate now that the app
 * content is auth-gated (`e2e/server-info.spec.ts` logs in to reach it).
 */
export function AccountScreen({ user, onLoggedOut }: AccountScreenProps) {
  const enroll = useEnrollPasskey()
  const logout = useLogout(onLoggedOut)

  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-4 p-6">
      <Card className="w-full max-w-sm" data-testid="account-screen">
        <CardHeader>
          <CardTitle data-testid="account-display-name">{user.displayName}</CardTitle>
          <CardDescription data-testid="account-username">@{user.username}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <PasskeyList />
          <Button
            type="button"
            onClick={enroll.handleEnroll}
            disabled={enroll.submitting}
            data-testid="add-passkey-button"
          >
            Add a passkey
          </Button>
          {enroll.failed ? (
            <p role="alert" data-testid="add-passkey-error" className="text-sm text-destructive">
              Couldn&apos;t add that passkey — try again.
            </p>
          ) : null}
          <Button
            type="button"
            variant="outline"
            onClick={logout.handleLogout}
            disabled={logout.submitting}
            data-testid="logout-button"
          >
            Log out
          </Button>
        </CardContent>
      </Card>
      <ServerInfoCard />
      {user.role === 'owner' ? <PeopleInvites /> : null}
    </div>
  )
}
