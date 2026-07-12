import { expect, test } from '@playwright/test'

import { readE2eEnv } from './support/state.js'

/**
 * Exercises the full stack `global-setup.ts` boots: the real server (built
 * client + migrations run at startup) serving the page, the `ServerInfo`
 * rpc over the `/rpc` websocket, and the client rendering it. Runs under
 * both the chromium and webkit projects (see `playwright.config.ts`).
 *
 * The app content is auth-gated, so the spec first signs in as the owner
 * `global-setup.ts` registers — `ServerInfoCard` is mounted on the account
 * screen behind the gate.
 */
test('renders the rpc-delivered server SHA inside a shadcn/ui Card', async ({ page }) => {
  const env = readE2eEnv()

  await page.goto(env.baseUrl)
  await expect(page.getByTestId('login-screen')).toBeVisible()

  await page.locator('#login-username').fill(env.owner.username)
  await page.locator('#login-pin').fill(env.owner.pin)
  await page.getByRole('button', { name: 'Sign in with PIN' }).click()

  // Authenticated now lands on the routed library home, not `AccountScreen`
  // directly — `ServerInfoCard` is mounted there, reached via `/account`.
  await expect(page.getByTestId('home-screen')).toBeVisible()
  await page.goto(`${env.baseUrl}/account`)

  // `ServerInfoCard` renders a shadcn/ui `Card` (packages/client/src/components/ui/card.tsx).
  const card = page.getByTestId('server-info-card')
  await expect(card).toBeVisible()

  // The sha rendered inside it must be the one `global-setup.ts` handed the
  // server via `RELEASE_SHA` — proving it round-tripped through the
  // `ServerInfo` rpc rather than being hardcoded in the client.
  const shaCell = page.getByTestId('server-info-sha')
  await expect(shaCell).toHaveText(env.releaseSha)
})
