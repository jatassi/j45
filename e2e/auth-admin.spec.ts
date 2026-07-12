import type { Page } from '@playwright/test'
import { expect, test } from '@playwright/test'

import { readE2eEnv } from './support/state.js'

/** The `/rpc` websocket url, mirroring `packages/client/src/lib/rpc-client.ts`'s `rpcUrl`. */
function rpcWebSocketUrl(baseUrl: string): string {
  const url = new URL(baseUrl)
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  url.pathname = '/rpc'
  return url.toString()
}

/** The one wire shape this file cares about — see `@effect/rpc`'s `RpcMessage.ResponseExitEncoded`/`Schema.ExitEncoded`/`Schema.CauseEncoded`. */
type RpcFailureExit = {
  readonly _tag: 'Exit'
  readonly requestId: string
  readonly exit: {
    readonly _tag: 'Failure'
    readonly cause: { readonly _tag: 'Fail'; readonly error: { readonly _tag: string } }
  }
}

/** The minimal `WebSocket` surface this file drives — not in `@types/node`'s globals, so declared locally rather than pulled in via the DOM lib. */
type MinimalWebSocketEvent = { readonly data: unknown }
type MinimalWebSocket = {
  addEventListener: (
    type: 'open' | 'message' | 'error',
    listener: (event: MinimalWebSocketEvent) => void,
  ) => void
  send: (data: string) => void
  close: () => void
}
type MinimalWebSocketConstructor = new (url: string) => MinimalWebSocket

/**
 * Calls `tag` (an `OwnerRpcs` member, here always `ListUsers`) directly over
 * the real `/rpc` websocket from inside `page`'s browsing context — bypassing
 * the client UI entirely, since `AccountScreen` never mounts `PeopleInvites`
 * (and so never issues an owner rpc) for a member in the first place
 * (`packages/client/src/components/account-screen.tsx`). This is the only
 * way to observe the *server's* own `Forbidden` enforcement (criterion 7's
 * rpc half) for an account the UI deliberately gives no admin surface to.
 * The request frame matches `@effect/rpc`'s ndjson wire format exactly (one
 * `RequestEncoded` JSON object per line — see `@effect/rpc/RpcMessage.ts`
 * and `RpcSerialization.ts`'s `ndjson` codec); the browser's `WebSocket`
 * handshake carries the page's own cookies (including the httpOnly session
 * cookie) same-origin, same as the real rpc client's connection, so
 * `AuthMiddlewareLive` identifies the caller exactly as it would for any
 * other rpc this member's session makes.
 */
async function callOwnerRpcAsMember(
  page: Page,
  baseUrl: string,
  tag: string,
): Promise<RpcFailureExit> {
  return page.evaluate(
    ({ url, tag, requestId }) =>
      new Promise<RpcFailureExit>((resolve, reject) => {
        const WebSocketCtor = (globalThis as unknown as { WebSocket: MinimalWebSocketConstructor })
          .WebSocket
        const socket = new WebSocketCtor(url)
        socket.addEventListener('open', () => {
          const frame = { _tag: 'Request', id: requestId, tag, payload: {}, headers: [] }
          socket.send(`${JSON.stringify(frame)}\n`)
        })
        socket.addEventListener('message', (event) => {
          const message = JSON.parse(String(event.data).trim()) as RpcFailureExit
          if (message.requestId === requestId) {
            socket.close()
            resolve(message)
          }
        })
        socket.addEventListener('error', () => {
          reject(new Error('rpc websocket error'))
        })
      }),
    { url: rpcWebSocketUrl(baseUrl), tag, requestId: '1' },
  )
}

/**
 * Owner mints an invite (task 2's e2e half) → a second browser context
 * registers with it → the resulting member sees no admin UI and gets
 * `Forbidden` calling an owner-only rpc directly (criterion 7, both halves).
 * Runs on chromium and webkit — nothing here is passkey/CDP-specific.
 */
test.describe('owner invites + owner-only rpc access (chromium + webkit)', () => {
  test(
    'the owner mints an invite in the UI and a second context registers with it; the new ' +
      'member sees no admin UI and a direct owner-only rpc call fails Forbidden',
    async ({ page, browser }, testInfo) => {
      const env = readE2eEnv()

      // The owner, via the real "People & Invites" UI (`people-invites.tsx`).
      await page.goto(env.baseUrl)
      await page.locator('#login-username').fill(env.owner.username)
      await page.locator('#login-pin').fill(env.owner.pin)
      await page.getByRole('button', { name: 'Sign in with PIN' }).click()

      // Authenticated now lands on the routed library home, not
      // `AccountScreen` directly — reach `PeopleInvites` the way a user
      // does, via `/account`.
      await expect(page.getByTestId('home-screen')).toBeVisible()
      await page.goto(`${env.baseUrl}/account`)
      await expect(page.getByTestId('people-invites')).toBeVisible()

      await expect(page.getByTestId('minted-invite-code')).toHaveCount(0)
      await page.getByTestId('mint-invite-button').click()
      const mintedCodeLocator = page.getByTestId('minted-invite-code')
      await expect(mintedCodeLocator).toBeVisible()
      const grouped = await mintedCodeLocator.textContent()
      if (grouped === null) {
        throw new Error('mint-invite-button click produced no minted-invite-code text')
      }
      const code = grouped.replaceAll('-', '')

      await page.getByTestId('logout-button').click()
      await expect(page.getByTestId('login-screen')).toBeVisible()

      // A second, independent browser context registers with that code.
      const memberContext = await browser.newContext()
      const memberPage = await memberContext.newPage()
      try {
        const username = `e2e-admin-${testInfo.project.name}`
        const displayName = `Admin Flow (${testInfo.project.name})`
        await memberPage.goto(`${env.baseUrl}/register?invite=${code}`)
        await memberPage.locator('#register-username').fill(username)
        await memberPage.locator('#register-display-name').fill(displayName)
        await memberPage.locator('#register-pin').fill('864209')
        await memberPage.getByRole('button', { name: 'Create account' }).click()
        await expect(memberPage.getByTestId('enroll-passkey-prompt')).toBeVisible()
        await memberPage.getByTestId('enroll-passkey-skip').click()

        // Registering now lands the new member on the routed library home
        // (the catch-all's redirect target), not `AccountScreen` directly —
        // reach it via `/account`, same as the owner above.
        await expect(memberPage.getByTestId('home-screen')).toBeVisible()
        await memberPage.goto(`${env.baseUrl}/account`)
        await expect(memberPage.getByTestId('account-screen')).toBeVisible()
        await expect(memberPage.getByTestId('account-display-name')).toHaveText(displayName)

        // No admin UI at all for a member.
        await expect(memberPage.getByTestId('people-invites')).toHaveCount(0)

        // The server itself refuses an owner-only rpc for this member.
        const exit = await callOwnerRpcAsMember(memberPage, env.baseUrl, 'ListUsers')
        expect(exit.exit.cause.error._tag).toBe('Forbidden')
      } finally {
        await memberContext.close()
      }
    },
  )
})
