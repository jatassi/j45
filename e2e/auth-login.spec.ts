import { expect, test } from '@playwright/test'

import { readE2eEnv } from './support/state.js'

/** A PIN that never matches the owner's real one (`readE2eEnv().owner.pin`), but still fits `Pin`'s 4-digit shape. */
const WRONG_PIN = '0000'

/**
 * PIN login against the one owner account `global-setup.ts` registers
 * (shared by chromium + webkit — no per-project account needed, unlike
 * `auth-register.spec.ts`'s invite-redeeming flows). Runs under both
 * projects against the one server `global-setup.ts` boots.
 */
test('PIN login succeeds with the correct PIN and shows InvalidCredentials with a wrong one', async ({
  page,
}) => {
  const env = readE2eEnv()

  await page.goto(env.baseUrl)
  await expect(page.getByTestId('login-screen')).toBeVisible()

  await page.locator('#login-username').fill(env.owner.username)
  await page.locator('#login-pin').fill(env.owner.pin)

  // Authenticated now lands on the routed library home, not `AccountScreen`
  // directly — reach the account screen the way a user does, via `/account`.
  await expect(page.getByTestId('home-screen')).toBeVisible()
  await page.goto(`${env.baseUrl}/account`)
  await expect(page.getByTestId('account-screen')).toBeVisible()
  await expect(page.getByTestId('account-display-name')).toHaveText(env.owner.displayName)

  await page.getByTestId('logout-button').click()
  await expect(page.getByTestId('login-screen')).toBeVisible()

  // The PIN sign-in above was remembered: the username field gives way to an
  // identity card, so the second attempt types only a (wrong) PIN.
  await expect(page.getByTestId('remembered-user-card')).toBeVisible()
  await expect(page.getByTestId('remembered-user-card')).toContainText(env.owner.displayName)
  await expect(page.getByTestId('remembered-user-card')).toContainText(`@${env.owner.username}`)
  await expect(page.locator('#login-username')).toHaveCount(0)

  await page.locator('#login-pin').fill(WRONG_PIN)

  await expect(page.getByTestId('login-error-invalid-credentials')).toBeVisible()
  await expect(page.getByTestId('login-screen')).toBeVisible()

  // "Not you?" forgets the remembered identity and restores the plain field.
  await page.getByTestId('remembered-user-forget').click()
  await expect(page.getByTestId('remembered-user-card')).toHaveCount(0)
  await expect(page.locator('#login-username')).toHaveValue('')
})
