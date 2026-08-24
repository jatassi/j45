import * as React from 'react'

import { Result, useAtom, useAtomRefresh, useAtomValue } from '@effect-atom/atom-react'
import type { Invite, User, UserId } from '@j45/domain'
import { toast } from 'sonner'

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ServerRpcClient } from '@/lib/rpc-client'

/**
 * The owner-only rpc atoms this section drives: the user list, the unspent
 * invite list, minting (a plain registration invite, or — with `resetUserId`
 * set — a reset code for one user), and revoking an unspent invite. Hoisted
 * to module scope for the same reason `account-screen.tsx`'s passkey atoms
 * are: a stable atom identity across re-renders.
 */
const listUsersAtom = ServerRpcClient.query('ListUsers', undefined)
const listInvitesAtom = ServerRpcClient.query('ListInvites', undefined)
const createInviteAtom = ServerRpcClient.mutation('CreateInvite')
const revokeInviteAtom = ServerRpcClient.mutation('RevokeInvite')

const toastFailed = (d: string) => toast.error('Command failed', { description: d })

/**
 * Re-reads both owner lists. `ListUsers` and `ListInvites` are two views of
 * one roster — minting an invite, revoking one, and issuing a reset code all
 * move both — so no mutation path here refreshes one without the other.
 *
 * Deliberately not covered: an invitee registering on their own device, which
 * changes both lists with no local mutation to hang a refresh off. That needs
 * cross-user liveness this app has nowhere except the Home screen's poll.
 */
function usePeopleRefresh(): () => void {
  const refreshUsers = useAtomRefresh(listUsersAtom)
  const refreshInvites = useAtomRefresh(listInvitesAtom)
  return () => {
    refreshUsers()
    refreshInvites()
  }
}

/** Renders an 8-char invite/reset code as the design's grouped `XXXX-XXXX`. */
function formatCode(code: string): string {
  return `${code.slice(0, 4)}-${code.slice(4)}`
}

/**
 * `${APP_ORIGIN}/register?invite=<code>` per the design. The client never
 * reads `APP_ORIGIN` directly (that's server config) — the page's own
 * origin *is* `APP_ORIGIN` by construction, the same "same origin the page
 * was loaded from" fact `rpc-client.ts`'s `rpcUrl` relies on.
 */
function inviteLink(code: string): string {
  return `${globalThis.location.origin}/register?invite=${code}`
}

/**
 * Drives one `CreateInvite` call (plain invite when `resetUserId` is
 * omitted, a reset code when it's supplied) and holds the outcome as local
 * state — deliberately not the shared `createInviteAtom`'s own `Result`,
 * since every caller (the mint-invite action and each user row's
 * issue-reset-code action) shares that one atom, and one caller's in-flight
 * state/value would otherwise bleed into every other caller's rendering.
 */
function useCreateInvite() {
  const [, createInvite] = useAtom(createInviteAtom, { mode: 'promise' })
  const [pending, setPending] = React.useState(false)
  const [outcome, setOutcome] = React.useState<
    { readonly ok: true; readonly invite: Invite } | { readonly ok: false } | undefined
  >(undefined)

  const mint = (resetUserId?: UserId): Promise<void> => {
    setPending(true)
    setOutcome(undefined)
    const payload = resetUserId === undefined ? {} : { resetUserId }
    return createInvite({ payload })
      .then((invite) => {
        setOutcome({ ok: true, invite })
      })
      .catch(() => {
        setOutcome({ ok: false })
        toastFailed(
          resetUserId === undefined ? 'Could not mint an invite.' : 'Could not issue a reset code.',
        )
      })
      .finally(() => {
        setPending(false)
      })
  }

  return { pending, outcome, mint }
}

type UserRowProps = {
  readonly user: User
}

/** One row of the user list: display name, and issue-reset-code. */
function UserRow({ user }: UserRowProps) {
  const resetInvite = useCreateInvite()
  const refreshPeople = usePeopleRefresh()

  return (
    <li className="flex flex-col gap-1 text-sm" data-testid={`user-${user.id}`}>
      <div className="flex items-center justify-between gap-2">
        <span data-testid={`user-display-name-${user.id}`}>{user.displayName}</span>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={resetInvite.pending}
          data-testid={`issue-reset-code-${user.id}`}
          onClick={() => {
            // A reset code is an unspent invite, so it lands in the invite
            // list too — both lists move, both get re-read.
            void resetInvite.mint(user.id).then(refreshPeople)
          }}
        >
          Issue reset code
        </Button>
      </div>
      {resetInvite.outcome?.ok === false ? (
        <p
          role="alert"
          className="text-sm text-destructive"
          data-testid={`reset-code-error-${user.id}`}
        >
          Couldn&apos;t issue a reset code — try again.
        </p>
      ) : null}
      {resetInvite.outcome?.ok === true ? (
        <p className="font-mono" data-testid={`reset-code-${user.id}`}>
          {formatCode(resetInvite.outcome.invite.code)}
        </p>
      ) : null}
    </li>
  )
}

/** Lists every user (`ListUsers`), each row offering issue-reset-code. */
function UserList() {
  const users = useAtomValue(listUsersAtom)

  return Result.match(users, {
    onInitial: () => <p className="text-sm text-muted-foreground">Loading people…</p>,
    onFailure: (failure) => (
      <p className="text-sm text-destructive">Failed to load people: {String(failure.cause)}</p>
    ),
    onSuccess: ({ value }) => (
      <ul className="flex flex-col gap-2" data-testid="user-list">
        {value.map((user) => (
          <UserRow key={user.id} user={user} />
        ))}
      </ul>
    ),
  })
}

function RevokeDialog(p: {
  readonly code: string
  readonly open: boolean
  readonly onCancel: () => void
  readonly onConfirm: () => void
}) {
  return (
    <AlertDialog open={p.open} onOpenChange={(n) => (n ? undefined : p.onCancel())}>
      <AlertDialogContent data-testid={`revoke-invite-dialog-${p.code}`} size="sm">
        <AlertDialogTitle>Revoke invite</AlertDialogTitle>
        <AlertDialogDescription>
          Revoke {formatCode(p.code)}? It can&apos;t be used to register after this.
        </AlertDialogDescription>
        <AlertDialogFooter>
          <AlertDialogCancel data-testid={`revoke-invite-cancel-${p.code}`} size="sm">
            Cancel
          </AlertDialogCancel>
          <AlertDialogAction
            type="button"
            variant="destructive"
            size="sm"
            data-testid={`revoke-invite-confirm-${p.code}`}
            onClick={p.onConfirm}
          >
            Revoke
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

type InviteRowProps = {
  readonly invite: Invite
  readonly onRevoked: () => void
}

/**
 * One row of the unspent-invites list: the grouped code and a revoke action
 * gated behind an AlertDialog confirm (mirrors `workout-detail-screen`'s
 * `DeleteDialog`).
 */
function InviteRow({ invite, onRevoked }: InviteRowProps) {
  const [, revoke] = useAtom(revokeInviteAtom, { mode: 'promise' })
  const [confirmOpen, setConfirmOpen] = React.useState(false)

  const confirmRevoke = () => {
    void revoke({ payload: { code: invite.code } })
      .then(() => {
        setConfirmOpen(false)
        onRevoked()
      })
      .catch(() => toastFailed('Could not revoke the invite.'))
  }

  return (
    <li
      className="flex items-center justify-between gap-2 text-sm"
      data-testid={`invite-${invite.code}`}
    >
      <span className="font-mono" data-testid={`invite-code-${invite.code}`}>
        {formatCode(invite.code)}
      </span>
      <Button
        type="button"
        variant="outline"
        size="sm"
        data-testid={`revoke-invite-${invite.code}`}
        onClick={() => setConfirmOpen(true)}
      >
        Revoke
      </Button>
      <RevokeDialog
        code={invite.code}
        open={confirmOpen}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={confirmRevoke}
      />
    </li>
  )
}

/** The unspent-invites list (`ListInvites`), each row revocable (`RevokeInvite`). */
function InviteList() {
  const invites = useAtomValue(listInvitesAtom)
  const refreshPeople = usePeopleRefresh()

  return Result.match(invites, {
    onInitial: () => <p className="text-sm text-muted-foreground">Loading invites…</p>,
    onFailure: (failure) => (
      <p className="text-sm text-destructive">Failed to load invites: {String(failure.cause)}</p>
    ),
    onSuccess: ({ value }) =>
      value.length === 0 ? (
        <p className="text-sm text-muted-foreground" data-testid="invite-list-empty">
          No unspent invites.
        </p>
      ) : (
        <ul className="flex flex-col gap-2" data-testid="invite-list">
          {value.map((invite) => (
            <InviteRow key={invite.code} invite={invite} onRevoked={refreshPeople} />
          ))}
        </ul>
      ),
  })
}

/** Copies `${APP_ORIGIN}/register?invite=<code>` to the clipboard. */
function handleCopyLink(code: string) {
  void globalThis.navigator.clipboard.writeText(inviteLink(code))
}

type MintedInviteProps = {
  readonly invite: Invite
}

/**
 * The just-minted invite's grouped code, its shareable register link (visible,
 * not only copied), and the copy-link action.
 */
function MintedInvite({ invite }: MintedInviteProps) {
  const link = inviteLink(invite.code)
  return (
    <div className="flex flex-col gap-2 text-sm" data-testid="minted-invite">
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono" data-testid="minted-invite-code">
          {formatCode(invite.code)}
        </span>
        <Button
          type="button"
          variant="outline"
          size="sm"
          data-testid="copy-invite-link"
          onClick={() => {
            handleCopyLink(invite.code)
          }}
        >
          Copy link
        </Button>
      </div>
      <p className="break-all text-muted-foreground" data-testid="minted-invite-register-link">
        {link}
      </p>
    </div>
  )
}

/** Mints a registration invite and offers to copy its shareable link. */
function MintInvite() {
  const refreshPeople = usePeopleRefresh()
  const invite = useCreateInvite()
  const outcome = invite.outcome

  const handleMint = () => {
    void invite.mint().then(refreshPeople)
  }

  return (
    <div className="flex flex-col gap-2">
      <Button
        type="button"
        onClick={handleMint}
        disabled={invite.pending}
        data-testid="mint-invite-button"
      >
        Mint invite
      </Button>
      {outcome?.ok === false ? (
        <p role="alert" className="text-sm text-destructive" data-testid="mint-invite-error">
          Couldn&apos;t mint an invite — try again.
        </p>
      ) : null}
      {outcome?.ok === true ? <MintedInvite invite={outcome.invite} /> : null}
    </div>
  )
}

/**
 * The owner-only "People & Invites" section `AccountScreen` renders
 * (`user.role === "owner"` only — nothing here is mounted, and no owner rpc
 * is ever called, for a member). `UserList`, `MintInvite`, and `InviteList`
 * each own their slice of `OwnerRpcs`; every mutation path here re-reads
 * *both* lists through `usePeopleRefresh` once it settles (mirroring
 * `PasskeyList`'s refresh-after-enroll in `account-screen.tsx`) — minting,
 * revoking, and issuing a reset code each move the roster and the invite
 * list together, so refreshing one without the other just leaves the screen
 * disagreeing with itself.
 */
export function PeopleInvites() {
  return (
    <Card className="w-full max-w-sm" data-testid="people-invites">
      <CardHeader>
        <CardTitle>People &amp; Invites</CardTitle>
        <CardDescription>Manage accounts, invites, and reset codes.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <UserList />
        <MintInvite />
        <InviteList />
      </CardContent>
    </Card>
  )
}
