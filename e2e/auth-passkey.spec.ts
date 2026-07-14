import { expect, test } from '@playwright/test'

import { readE2eEnv } from './support/state.js'
import { addVirtualAuthenticator } from './support/virtual-authenticator.js'

/**
 * Exercises the full passkey ceremony — enroll, then usernameless
 * login — against the real server, backed by a CDP virtual authenticator
 * (`support/virtual-authenticator.ts`). Chromium-only: `BrowserContext.
 * newCDPSession` (and the CDP `WebAuthn` domain it carries) has no webkit
 * equivalent, so this is an explicit, visible `test.skip` below — not a
 * silent absence — rather than a `playwright.config.ts` project restriction
 * (out of this task's footprint). See `docs/designs/auth-accounts/design.md`'s
 * Testing section for the same call.
 *
 * Runs against the shared owner account `global-setup.ts` registers (`env.
 * owner`) rather than registering a fresh one: the virtual authenticator is
 * scoped to this test's own isolated `page`/`BrowserContext`, so enrolling a
 * passkey here can't leak into any other test's authenticator state, and PIN
 * login stays available for the owner afterwards (enrolling a passkey adds a
 * `passkey_credentials` row; it revokes nothing).
 */
test.describe('passkey ceremony (chromium only — CDP virtual authenticator)', () => {
  test(
    'an authenticated user enrolls a passkey, logs out, and the sign-in-with-passkey button ' +
      'alone — no username or PIN typed — authenticates them',
    async ({ page, browserName }) => {
      test.skip(
        browserName !== 'chromium',
        'CDP WebAuthn.enable virtual authenticator is chromium-only (BrowserContext.newCDPSession ' +
          'has no webkit equivalent) — see design.md’s Testing section.',
      )

      const env = readE2eEnv()
      await addVirtualAuthenticator(page)

      await page.goto(env.baseUrl)
      await expect(page.getByTestId('login-screen')).toBeVisible()
      await page.locator('#login-username').fill(env.owner.username)
      await page.locator('#login-pin').fill(env.owner.pin)

      // Authenticated now lands on the routed library home, not
      // `AccountScreen` directly — reach it the way a user does, via `/account`.
      await expect(page.getByTestId('home-screen')).toBeVisible()
      await page.goto(`${env.baseUrl}/account`)
      await expect(page.getByTestId('account-screen')).toBeVisible()

      // Enroll — `PasskeyEnrollStart`/`Finish` round-trip through the
      // virtual authenticator with no prompt.
      await page.getByTestId('add-passkey-button').click()
      await expect(page.getByTestId('passkey-list')).toBeVisible()

      await page.getByTestId('logout-button').click()
      await expect(page.getByTestId('login-screen')).toBeVisible()

      // Criterion 4: nothing is typed — the earlier PIN sign-in left a
      // remembered-user card where the username field was, the PIN slots are
      // empty, and the passkey button alone authenticates the visitor.
      await expect(page.getByTestId('remembered-user-card')).toContainText(`@${env.owner.username}`)
      await expect(page.locator('#login-pin')).toHaveValue('')

      // Logging out reloads the *current* page — still `/account` (a real,
      // matched, authenticated route) — so passkey login here authenticates
      // straight back into `AccountScreen` with no catch-all redirect
      // involved, unlike the PIN login above (which starts from `/`).
      await page.getByTestId('passkey-login-button').click()
      await expect(page.getByTestId('account-screen')).toBeVisible({ timeout: 15_000 })
      await expect(page.getByTestId('account-display-name')).toHaveText(env.owner.displayName)
    },
  )

  test('delete passkey opens an alert-dialog; confirm removes it from the list', async ({
    page,
    browserName,
  }) => {
    test.skip(
      browserName !== 'chromium',
      'CDP WebAuthn.enable virtual authenticator is chromium-only (BrowserContext.newCDPSession ' +
        'has no webkit equivalent) — see design.md’s Testing section.',
    )

    const env = readE2eEnv()
    await addVirtualAuthenticator(page)

    await page.goto(env.baseUrl)
    await expect(page.getByTestId('login-screen')).toBeVisible()
    await page.locator('#login-username').fill(env.owner.username)
    await page.locator('#login-pin').fill(env.owner.pin)

    await expect(page.getByTestId('home-screen')).toBeVisible()
    await page.goto(`${env.baseUrl}/account`)
    await expect(page.getByTestId('account-screen')).toBeVisible()

    // Enroll a fresh credential so this test always has a known row to delete
    // (prior tests may have left passkeys on the shared owner account).
    await page.getByTestId('add-passkey-button').click()
    await expect(page.getByTestId('passkey-list')).toBeVisible()

    const deleteTrigger = page.locator('[data-testid^="delete-passkey-"]').last()
    const deleteTestId = await deleteTrigger.getAttribute('data-testid')
    expect(deleteTestId).toMatch(/^delete-passkey-/)
    if (deleteTestId === null) {
      throw new Error('expected delete-passkey trigger to carry a data-testid')
    }
    const passkeyId = deleteTestId.replace('delete-passkey-', '')

    // Trigger alone opens the dialog — passkey stays until confirm.
    await deleteTrigger.click()
    await expect(page.getByTestId(`confirm-delete-passkey-${passkeyId}`)).toBeVisible()
    await expect(page.getByTestId(`passkey-${passkeyId}`)).toBeVisible()

    await page.getByTestId(`confirm-delete-passkey-${passkeyId}`).click()
    await expect(page.getByTestId(`passkey-${passkeyId}`)).toHaveCount(0)
  })
})
