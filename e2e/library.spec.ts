import type { Page, TestInfo } from '@playwright/test'
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

/**
 * Registers a brand-new account through the real `/register` form (skipping
 * the passkey enrollment prompt, exactly like `auth-register.spec.ts`).
 *
 * `router.tsx`'s route tree has no entry for `/register` itself — only `/`,
 * `/library`, `/workouts/$workoutId`, `/account`, and the other tab/push
 * leaves are routed — so once the visitor authenticates while still sitting
 * on `/register?invite=...`, `RouterProvider` finds no matching route there.
 * This helper reaches `/account` directly afterwards (a real, matched,
 * authenticated route) so callers land somewhere the router actually renders.
 */
async function registerAccount(
  page: Page,
  baseUrl: string,
  input: {
    readonly code: string
    readonly username: string
    readonly displayName: string
    readonly pin: string
  },
): Promise<void> {
  await page.goto(`${baseUrl}/register?invite=${input.code}`)
  await page.locator('#register-username').fill(input.username)
  await page.locator('#register-display-name').fill(input.displayName)
  await page.locator('#register-pin').fill(input.pin)
  await page.getByRole('button', { name: 'Create account' }).click()

  await expect(page.getByTestId('enroll-passkey-prompt')).toBeVisible()
  await page.getByTestId('enroll-passkey-skip').click()

  await page.goto(`${baseUrl}/account`)
  await expect(page.getByTestId('account-screen')).toBeVisible()
}

/** Logs the given credentials in through the real PIN form, starting from an anonymous `LoginScreen`. */
async function loginWithPin(
  page: Page,
  input: { readonly username: string; readonly pin: string },
): Promise<void> {
  await expect(page.getByTestId('login-screen')).toBeVisible()
  await page.locator('#login-username').fill(input.username)
  await page.locator('#login-pin').fill(input.pin)
}

/** Every `workout-card-<id>` `Link` currently rendered on the library list. */
function workoutCards(page: Page) {
  return page.locator('a[data-testid^="workout-card-"]')
}

/**
 * Opens `/library` via the bottom tab bar and waits for `library-screen`.
 * Used when the app has landed on Home (post-login, post-duplicate/delete)
 * and the test needs the workout list.
 */
async function openLibraryTab(page: Page): Promise<void> {
  await page.getByTestId('tab-library').click()
  await expect(page.getByTestId('library-screen')).toBeVisible()
}

/**
 * Exercises the whole stack this feature adds atop `global-setup.ts`'s
 * harness: registration-time seeding (`registration-seeding`), the
 * `LibraryRpcs` handlers (`library-handlers`), and the router/library UI
 * (`client-router-library`/`client-workout-detail`). Each test registers its
 * own per-project account from `library.spec.ts`'s own pre-minted invite
 * pair (`readE2eEnv().libraryInvitesByProject`) precisely so `fullyParallel`
 * chromium+webkit runs never mutate the one shared owner library
 * `global-setup.ts` itself depends on.
 */
test.describe('library (chromium + webkit)', () => {
  test(
    "after PIN login, '/library' lists the 12 seed workouts; opening Athletica shows 3 pods, 9 stations, " +
      "and total duration 26:45; Duplicate creates 'Athletica (copy)'; renaming the copy persists " +
      'across a page reload; Delete removes it',
    async ({ page }, testInfo) => {
      const env = readE2eEnv()
      const projectName = projectNameFrom(testInfo)
      const [code] = env.libraryInvitesByProject[projectName]
      const username = `e2e-lib-${projectName}`
      const displayName = `Library Flow (${projectName})`
      const pin = '3197'

      await registerAccount(page, env.baseUrl, { code, username, displayName, pin })

      await page.getByTestId('logout-button').click()
      await expect(page.getByTestId('login-screen')).toBeVisible()

      // Land back on `/` (anonymous) before logging in, so the router mounts
      // at `/` — Home — once the login succeeds. Workout list lives at `/library`.
      await page.goto(env.baseUrl)
      await loginWithPin(page, { username, pin })

      await expect(page.getByTestId('home-screen')).toBeVisible()
      await openLibraryTab(page)
      await expect(workoutCards(page)).toHaveCount(12)

      // Every seed card shows a focus-label badge and an `N works · MM:SS` summary.
      for (const card of await workoutCards(page).all()) {
        const cardTestId = await card.getAttribute('data-testid')
        if (cardTestId === null) {
          throw new Error('expected workout-card-<id> data-testid on each library card')
        }
        const cardId = cardTestId.replace('workout-card-', '')
        await expect(page.getByTestId(`workout-focus-${cardId}`)).not.toHaveText('')
        await expect(page.getByTestId(`workout-summary-${cardId}`)).toHaveText(
          /\d+ works · \d+:\d{2}/,
        )
      }

      const athleticaLink = workoutCards(page).filter({ hasText: 'Athletica' })
      await expect(athleticaLink).toHaveCount(1)
      const athleticaCardTestId = await athleticaLink.getAttribute('data-testid')
      if (athleticaCardTestId === null) {
        throw new Error('expected Athletica card to carry a workout-card-<id> testid')
      }
      const athleticaId = athleticaCardTestId.replace('workout-card-', '')
      await expect(page.getByTestId(`workout-summary-${athleticaId}`)).toHaveText('9 works · 26:45')
      await athleticaLink.click()

      await expect(page.getByTestId('workout-detail-screen')).toBeVisible()
      await expect(page.getByTestId('workout-title')).toHaveText('Athletica')
      await expect(page.getByTestId('pod')).toHaveCount(3)
      await expect(page.getByTestId('station')).toHaveCount(9)
      await expect(page.getByTestId('workout-duration')).toHaveText('26:45')

      await page.getByTestId('duplicate-button').click()

      // Duplicate navigates to `/` (home); open Library to assert the new card.
      await expect(page.getByTestId('home-screen')).toBeVisible()
      await openLibraryTab(page)
      await expect(workoutCards(page)).toHaveCount(13)
      const copyLink = workoutCards(page).filter({ hasText: 'Athletica (copy)' })
      await expect(copyLink).toHaveCount(1)

      await copyLink.click()
      await expect(page.getByTestId('workout-detail-screen')).toBeVisible()
      await expect(page.getByTestId('workout-title')).toHaveText('Athletica (copy)')

      await page.getByTestId('rename-button').click()
      await expect(page.getByTestId('rename-dialog')).toBeVisible()
      await page.getByTestId('rename-input').fill('Athletica Renamed')
      await page.getByTestId('rename-confirm').click()
      await expect(page.getByTestId('rename-dialog')).toHaveCount(0)
      await expect(page.getByTestId('workout-title')).toHaveText('Athletica Renamed')

      await page.reload()
      await expect(page.getByTestId('workout-detail-screen')).toBeVisible()
      await expect(page.getByTestId('workout-title')).toHaveText('Athletica Renamed')

      await page.getByTestId('delete-button').click()
      await expect(page.getByTestId('delete-dialog')).toBeVisible()
      await page.getByTestId('delete-confirm').click()

      // Delete navigates to `/library` (not `/`); list should already be visible.
      await expect(page.getByTestId('library-screen')).toBeVisible()
      await expect(workoutCards(page)).toHaveCount(12)
      await expect(workoutCards(page).filter({ hasText: 'Athletica Renamed' })).toHaveCount(0)
    },
  )

  test(
    'a logged-out visit to /workouts/<seed id> shows the login screen, and completing PIN login ' +
      "renders that workout's detail without further navigation; /account renders the account " +
      'screen via the header avatar chip',
    async ({ page }, testInfo) => {
      const env = readE2eEnv()
      const projectName = projectNameFrom(testInfo)
      const [, code] = env.libraryInvitesByProject[projectName]
      const username = `e2e-lib2-${projectName}`
      const displayName = `Library Deep Link (${projectName})`
      const pin = '9753'

      await registerAccount(page, env.baseUrl, { code, username, displayName, pin })

      // Harvest a seed workout id from the library list at `/library`.
      await page.goto(env.baseUrl)
      await expect(page.getByTestId('home-screen')).toBeVisible()
      await openLibraryTab(page)
      const firstCard = workoutCards(page).first()
      const cardTestId = await firstCard.getAttribute('data-testid')
      if (cardTestId === null) {
        throw new Error('expected at least one workout-card-<id> Link on the library list')
      }
      const workoutId = cardTestId.replace('workout-card-', '')
      const workoutName = await page.getByTestId(`workout-name-${workoutId}`).textContent()

      // Log out via the header avatar chip, then attempt a deep link while anonymous.
      await page.getByTestId('avatar-chip').click()
      await expect(page.getByTestId('account-screen')).toBeVisible()
      await page.getByTestId('logout-button').click()
      await expect(page.getByTestId('login-screen')).toBeVisible()

      await page.goto(`${env.baseUrl}/workouts/${workoutId}`)
      await expect(page.getByTestId('login-screen')).toBeVisible()

      await loginWithPin(page, { username, pin })

      // The gate never redirects — the router renders the original
      // `/workouts/<id>` path with no further navigation from the test.
      await expect(page.getByTestId('workout-detail-screen')).toBeVisible()
      await expect(page.getByTestId('workout-title')).toHaveText(workoutName ?? '')

      await page.getByTestId('library-nav-link').click()
      await expect(page.getByTestId('library-screen')).toBeVisible()
      await page.getByTestId('avatar-chip').click()
      await expect(page.getByTestId('account-screen')).toBeVisible()
      await expect(page.getByTestId('account-display-name')).toHaveText(displayName)
    },
  )
})
