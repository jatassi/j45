// @vitest-environment jsdom
import { RegistryProvider, Result } from '@effect-atom/atom-react'
import { Invite, User } from '@j45/domain'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import * as Effect from 'effect/Effect'
import * as Runtime from 'effect/Runtime'
import * as Schema from 'effect/Schema'
import { toast } from 'sonner'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { AccountScreen } from '@/components/account-screen'
import { ServerRpcClient } from '@/lib/rpc-client'

vi.mock('sonner', () => ({
  toast: { error: vi.fn() },
}))

afterEach(() => {
  cleanup()
  vi.mocked(toast.error).mockClear()
})

/** Decodes through the branded `User` schema, as a real `/auth/me` body would. */
function makeUser(input: {
  readonly id: string
  readonly username: string
  readonly displayName: string
  readonly role: 'owner' | 'member'
}): User {
  return Schema.decodeUnknownSync(User)(input)
}

/** Decodes through the branded `Invite` schema, `resetUserId` present only when supplied. */
function makeInvite(input: { readonly code: string; readonly resetUserId?: string }): Invite {
  return Schema.decodeUnknownSync(Invite)({
    code: input.code,
    createdAt: '2026-07-08T00:00:00.000Z',
    ...(input.resetUserId === undefined ? {} : { resetUserId: input.resetUserId }),
  })
}

/**
 * Builds a `Runtime` that provides `ServerRpcClient` with `handlers` in place
 * of the real (websocket-backed) rpc client — the same "seed the atom's
 * cache one level up" trick `account-screen.test.tsx` uses, so it covers
 * `PeopleInvites`'s `ListUsers`/`CreateInvite`/`ListInvites`/`RevokeInvite`
 * atoms too.
 */
function makeFakeRuntime(
  handlers: Partial<Record<string, (payload: unknown) => Effect.Effect<unknown, unknown>>>,
) {
  const client = (tag: string, payload: unknown) => {
    const handler = handlers[tag]
    if (handler === undefined) {
      throw new Error(`unexpected rpc call: ${tag}`)
    }
    return handler(payload)
  }
  return Runtime.defaultRuntime.pipe(Runtime.provideService(ServerRpcClient, client as never))
}

function renderAccountScreen(
  user: User,
  handlers: Partial<Record<string, (payload: unknown) => Effect.Effect<unknown, unknown>>>,
) {
  const fakeRuntime = makeFakeRuntime(handlers)
  render(
    <RegistryProvider initialValues={[[ServerRpcClient.runtime, Result.success(fakeRuntime)]]}>
      <AccountScreen user={user} onLoggedOut={vi.fn()} />
    </RegistryProvider>,
  )
}

describe('PeopleInvites (owner)', () => {
  it('shows the user list, mints an invite with a visible register link and copy-link action, lists and revokes unspent invites via confirm dialog, and issues a per-user reset code', async () => {
    const owner = makeUser({ id: 'u1', username: 'jill', displayName: 'Jill Owner', role: 'owner' })
    const member = makeUser({
      id: 'u2',
      username: 'alice',
      displayName: 'Alice Member',
      role: 'member',
    })

    let invites: readonly Invite[] = []
    const mintedCodes = ['ABCD1234', 'WXYZ5678']
    let mintCount = 0
    let revokeCalls = 0

    const clipboardWriteText = vi.fn(() => Promise.resolve(undefined))
    Object.defineProperty(globalThis.navigator, 'clipboard', {
      value: { writeText: clipboardWriteText },
      configurable: true,
    })

    renderAccountScreen(owner, {
      ListPasskeys: () => Effect.succeed([]),
      ListUsers: () => Effect.succeed([owner, member]),
      ListInvites: () => Effect.succeed(invites),
      CreateInvite: (payload) => {
        const { resetUserId } = payload as { resetUserId?: string }
        const code = mintedCodes[mintCount]
        mintCount += 1
        const invite = makeInvite({ code, resetUserId })
        invites = [...invites, invite]
        return Effect.succeed(invite)
      },
      RevokeInvite: (payload) => {
        const { code } = payload as { code: string }
        revokeCalls += 1
        invites = invites.filter((invite) => invite.code !== code)
        return Effect.succeed(undefined)
      },
    })

    await screen.findByTestId('people-invites')
    expect(screen.getByTestId('user-display-name-u1').textContent).toBe('Jill Owner')
    expect(screen.getByTestId('user-display-name-u2').textContent).toBe('Alice Member')

    // Mint a registration invite; the code is shown grouped XXXX-XXXX.
    fireEvent.click(screen.getByTestId('mint-invite-button'))
    await screen.findByTestId('minted-invite-code')
    expect(screen.getByTestId('minted-invite-code').textContent).toBe('ABCD-1234')

    // The register link itself is rendered (not only copied silently).
    const expectedLink = `${globalThis.location.origin}/register?invite=ABCD1234`
    expect(screen.getByTestId('minted-invite-register-link').textContent).toBe(expectedLink)

    // It also shows up in the unspent-invites list, grouped the same way.
    await screen.findByTestId('invite-code-ABCD1234')
    expect(screen.getByTestId('invite-code-ABCD1234').textContent).toBe('ABCD-1234')

    // Copy-link produces ${APP_ORIGIN}/register?invite=<code> (the app's own origin).
    fireEvent.click(screen.getByTestId('copy-invite-link'))
    await waitFor(() => {
      expect(clipboardWriteText).toHaveBeenCalledWith(expectedLink)
    })

    // Revoking is gated behind a confirm dialog — cancel does nothing.
    fireEvent.click(screen.getByTestId('revoke-invite-ABCD1234'))
    await screen.findByTestId('revoke-invite-dialog-ABCD1234')
    fireEvent.click(screen.getByTestId('revoke-invite-cancel-ABCD1234'))
    await waitFor(() => {
      expect(screen.queryByTestId('revoke-invite-dialog-ABCD1234')).toBeNull()
    })
    expect(revokeCalls).toBe(0)
    expect(screen.getByTestId('invite-ABCD1234')).toBeTruthy()

    // Confirm calls RevokeInvite and removes the row.
    fireEvent.click(screen.getByTestId('revoke-invite-ABCD1234'))
    fireEvent.click(await screen.findByTestId('revoke-invite-confirm-ABCD1234'))
    await waitFor(() => {
      expect(screen.queryByTestId('invite-ABCD1234')).toBeNull()
    })
    expect(revokeCalls).toBe(1)

    // Per-user issue-reset-code shows the code, grouped, to read aloud.
    fireEvent.click(screen.getByTestId('issue-reset-code-u2'))
    await screen.findByTestId('reset-code-u2')
    expect(screen.getByTestId('reset-code-u2').textContent).toBe('WXYZ-5678')
  })

  it('every path that refreshes the invite list refreshes the user list too — minting, revoking, and issuing a reset code', async () => {
    const owner = makeUser({ id: 'u1', username: 'jill', displayName: 'Jill Owner', role: 'owner' })
    const member = makeUser({
      id: 'u2',
      username: 'alice',
      displayName: 'Alice Member',
      role: 'member',
    })

    let invites: readonly Invite[] = []
    let listUsersCalls = 0
    let listInvitesCalls = 0
    let mintCount = 0

    renderAccountScreen(owner, {
      ListPasskeys: () => Effect.succeed([]),
      ListUsers: () => {
        listUsersCalls += 1
        return Effect.succeed([owner, member])
      },
      ListInvites: () => {
        listInvitesCalls += 1
        return Effect.succeed(invites)
      },
      CreateInvite: (payload) => {
        const { resetUserId } = payload as { resetUserId?: string }
        mintCount += 1
        const invite = makeInvite({ code: `CODE000${mintCount}`, resetUserId })
        invites = [...invites, invite]
        return Effect.succeed(invite)
      },
      RevokeInvite: (payload) => {
        const { code } = payload as { code: string }
        invites = invites.filter((invite) => invite.code !== code)
        return Effect.succeed(undefined)
      },
    })

    await screen.findByTestId('people-invites')
    await waitFor(() => {
      expect(listUsersCalls).toBeGreaterThan(0)
    })

    /** Both lists changed together, so both must have been re-read. */
    const expectBothRefreshed = async (usersBefore: number, invitesBefore: number) => {
      await waitFor(() => {
        expect(listInvitesCalls).toBeGreaterThan(invitesBefore)
      })
      await waitFor(() => {
        expect(listUsersCalls).toBeGreaterThan(usersBefore)
      })
    }

    // Mint.
    let users = listUsersCalls
    let invitesRead = listInvitesCalls
    fireEvent.click(screen.getByTestId('mint-invite-button'))
    await screen.findByTestId('invite-code-CODE0001')
    await expectBothRefreshed(users, invitesRead)

    // Revoke.
    users = listUsersCalls
    invitesRead = listInvitesCalls
    fireEvent.click(screen.getByTestId('revoke-invite-CODE0001'))
    fireEvent.click(await screen.findByTestId('revoke-invite-confirm-CODE0001'))
    await expectBothRefreshed(users, invitesRead)

    // Issue a reset code — a reset code is an unspent invite, so it lands in
    // the invite list too; the roster it was issued against reads with it.
    users = listUsersCalls
    invitesRead = listInvitesCalls
    fireEvent.click(screen.getByTestId('issue-reset-code-u2'))
    await screen.findByTestId('reset-code-u2')
    await expectBothRefreshed(users, invitesRead)
  })

  it('toasts when CreateInvite rejects', async () => {
    const owner = makeUser({ id: 'u1', username: 'jill', displayName: 'Jill Owner', role: 'owner' })

    renderAccountScreen(owner, {
      ListPasskeys: () => Effect.succeed([]),
      ListUsers: () => Effect.succeed([owner]),
      ListInvites: () => Effect.succeed([]),
      CreateInvite: () => Effect.fail(new Error('mint failed')),
    })

    await screen.findByTestId('mint-invite-button')
    fireEvent.click(screen.getByTestId('mint-invite-button'))

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('Command failed', {
        description: 'Could not mint an invite.',
      })
    })
  })
})

describe('PeopleInvites (member)', () => {
  it('renders none of the admin UI and calls none of the owner rpcs', async () => {
    const member = makeUser({
      id: 'u2',
      username: 'alice',
      displayName: 'Alice Member',
      role: 'member',
    })
    const listUsers = vi.fn(() => Effect.succeed([]))

    renderAccountScreen(member, { ListPasskeys: () => Effect.succeed([]), ListUsers: listUsers })

    await screen.findByTestId('account-screen')
    expect(screen.queryByTestId('people-invites')).toBeNull()
    expect(screen.queryByTestId('mint-invite-button')).toBeNull()
    expect(screen.queryByTestId('user-list')).toBeNull()
    expect(listUsers).not.toHaveBeenCalled()
  })
})
