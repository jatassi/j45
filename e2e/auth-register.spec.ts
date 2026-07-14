import type { BrowserContext, Page, TestInfo } from '@playwright/test'
import { expect, test } from '@playwright/test'

import type { E2eProjectName } from './support/state.js'
import { readE2eEnv } from './support/state.js'

/** Narrows Playwright's `project.name` to the two projects `global-setup.ts` mints invites for. */
function projectNameFrom(testInfo: TestInfo): E2eProjectName {
  const name = testInfo.project.name
  if (name !== 'chromium' && name !== 'webkit') {
    throw new Error(`unexpected Playwright project name: ${name}`)
  }
  return name
}

const fillRegisterForm = async (
  page: Page,
  input: { readonly username: string; readonly displayName: string; readonly pin: string },
): Promise<void> => {
  await page.locator('#register-username').fill(input.username)
  await page.locator('#register-display-name').fill(input.displayName)
  await page.locator('#register-pin').fill(input.pin)
  await page.getByRole('button', { name: 'Create account' }).click()
}

const hasSessionCookie = async (context: BrowserContext): Promise<boolean> => {
  const cookies = await context.cookies()
  return cookies.some((cookie) => cookie.name === 'j45_session')
}

/**
 * Exercises the whole stack `global-setup.ts` boots: the real server
 * (built client + migrations + the auth env — `APP_ORIGIN`/`FIRST_RUN_INVITE`
 * — at startup) serving `/register`, `/auth/*`, and `/rpc`. Runs under both
 * the chromium and webkit projects; each gets its own pair of pre-minted
 * registration invites (`readE2eEnv().registerInvitesByProject`) so the two
 * projects never redeem the same code.
 */
test.describe('registration (chromium + webkit)', () => {
  test(
    'registering with a valid invite lands the visitor authenticated with their display name ' +
      'visible; a reload stays authenticated; logout returns to the login screen and a reload ' +
      'stays logged out; the session cookie is httpOnly and SameSite=Lax',
    async ({ page, context }, testInfo) => {
      const env = readE2eEnv()
      const projectName = projectNameFrom(testInfo)
      const [code] = env.registerInvitesByProject[projectName]
      // `Username` is capped at 20 chars (`packages/domain/src/auth.ts`) — `reg` (not
      // `register`) keeps `e2e-reg-chromium` under that limit.
      const username = `e2e-reg-${projectName}`
      const displayName = `Register Flow (${projectName})`

      await page.goto(`${env.baseUrl}/register?invite=${code}`)
      // Criterion 2: the invite deep link prefills the code field before the
      // visitor types anything.
      await expect(page.locator('#register-code')).toHaveValue(code)
      await fillRegisterForm(page, { username, displayName, pin: '2468' })

      await expect(page.getByTestId('enroll-passkey-prompt')).toBeVisible()
      await page.getByTestId('enroll-passkey-skip').click()

      // The catch-all (`router.tsx`) redirects the post-registration landing
      // (`/register?invite=…`, with no route of its own) to the library
      // home — never a blank page. `AccountScreen`-scoped assertions below
      // reach it via `/account`, the way a user does from there.
      await expect(page.getByTestId('home-screen')).toBeVisible()
      await page.goto(`${env.baseUrl}/account`)
      await expect(page.getByTestId('account-screen')).toBeVisible()
      await expect(page.getByTestId('account-display-name')).toHaveText(displayName)

      const cookies = await context.cookies()
      const sessionCookie = cookies.find((cookie) => cookie.name === 'j45_session')
      expect(sessionCookie).toBeDefined()
      expect(sessionCookie?.httpOnly).toBe(true)
      expect(sessionCookie?.sameSite).toBe('Lax')

      await page.reload()
      await expect(page.getByTestId('account-screen')).toBeVisible()
      await expect(page.getByTestId('account-display-name')).toHaveText(displayName)

      await page.getByTestId('logout-button').click()
      await expect(page.getByTestId('login-screen')).toBeVisible()

      await page.reload()
      await expect(page.getByTestId('login-screen')).toBeVisible()
    },
  )

  test('redeeming an unknown or already-spent invite shows a typed InvalidInvite error and creates no account', async ({
    page,
    context,
  }, testInfo) => {
    const projectName = projectNameFrom(testInfo)
    const env = readE2eEnv()

    // Unknown — a code nothing has ever minted.
    await page.goto(`${env.baseUrl}/register?invite=UNKNOWN9`)
    await fillRegisterForm(page, {
      username: `e2e-unknown-${projectName}`,
      displayName: 'Unknown Invite',
      pin: '1111',
    })
    await expect(page.getByTestId('register-error-invalid-invite')).toBeVisible()
    await expect(page.getByTestId('register-screen')).toBeVisible()
    expect(await hasSessionCookie(context)).toBe(false)

    // Spent — `global-setup.ts` already redeemed this exact code to register the owner.
    await page.goto(`${env.baseUrl}/register?invite=${env.firstRunInvite}`)
    await fillRegisterForm(page, {
      username: `e2e-spent-${projectName}`,
      displayName: 'Spent Invite',
      pin: '2222',
    })
    await expect(page.getByTestId('register-error-invalid-invite')).toBeVisible()
    await expect(page.getByTestId('register-screen')).toBeVisible()
    expect(await hasSessionCookie(context)).toBe(false)
  })

  test('registering twice with the same invite code fails the second time', async ({
    page,
    context,
  }, testInfo) => {
    const projectName = projectNameFrom(testInfo)
    const env = readE2eEnv()
    const [, code] = env.registerInvitesByProject[projectName]

    await page.goto(`${env.baseUrl}/register?invite=${code}`)
    await fillRegisterForm(page, {
      username: `e2e-twice-${projectName}-a`,
      displayName: 'Twice A',
      pin: '3333',
    })
    await expect(page.getByTestId('enroll-passkey-prompt')).toBeVisible()
    await page.getByTestId('enroll-passkey-skip').click()

    // The catch-all redirects the post-registration landing to the library
    // home — reach `AccountScreen`'s `logout-button` via `/account`.
    await expect(page.getByTestId('home-screen')).toBeVisible()
    await page.goto(`${env.baseUrl}/account`)
    await expect(page.getByTestId('account-screen')).toBeVisible()

    await page.getByTestId('logout-button').click()
    await expect(page.getByTestId('login-screen')).toBeVisible()

    // Same code, second attempt — already spent by the registration just above.
    await page.goto(`${env.baseUrl}/register?invite=${code}`)
    await fillRegisterForm(page, {
      username: `e2e-twice-${projectName}-b`,
      displayName: 'Twice B',
      pin: '4444',
    })
    await expect(page.getByTestId('register-error-invalid-invite')).toBeVisible()
    expect(await hasSessionCookie(context)).toBe(false)
  })
})
