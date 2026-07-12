/// <reference lib="dom" />
import type { Page } from '@playwright/test'
import { expect, test } from '@playwright/test'

import { readE2eEnv } from './support/state.js'

/**
 * Registers a brand-new account through the real `/register` form (skipping
 * the passkey enrollment prompt). Lands on `home-screen` at `/`.
 */
async function registerAndReachHome(
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

  await expect(page.getByTestId('home-screen')).toBeVisible()
}

/**
 * PIN-login as the shared owner, mint two fresh invite codes via the real
 * People & Invites UI, then log out back to `login-screen`. Same pattern as
 * `live-session.spec.ts` — no shared invite pool needed.
 */
async function mintTwoInviteCodes(
  page: Page,
  baseUrl: string,
  owner: { readonly username: string; readonly pin: string },
): Promise<readonly [string, string]> {
  await page.goto(baseUrl)
  await page.locator('#login-username').fill(owner.username)
  await page.locator('#login-pin').fill(owner.pin)
  await page.getByRole('button', { name: 'Sign in with PIN' }).click()
  await expect(page.getByTestId('home-screen')).toBeVisible()
  await page.getByTestId('avatar-chip').click()
  await expect(page.getByTestId('account-screen')).toBeVisible()
  await expect(page.getByTestId('people-invites')).toBeVisible()

  await page.getByTestId('mint-invite-button').click()
  const minted = page.getByTestId('minted-invite-code')
  await expect(minted).toBeVisible()
  const firstGrouped = await minted.textContent()
  if (firstGrouped === null) {
    throw new Error('first mint produced no minted-invite-code text')
  }
  const first = firstGrouped.replaceAll('-', '')

  await page.getByTestId('mint-invite-button').click()
  await expect(minted).not.toHaveText(firstGrouped)
  const secondGrouped = await minted.textContent()
  if (secondGrouped === null) {
    throw new Error('second mint produced no minted-invite-code text')
  }
  const second = secondGrouped.replaceAll('-', '')

  await page.getByTestId('logout-button').click()
  await expect(page.getByTestId('login-screen')).toBeVisible()
  return [first, second]
}

/**
 * Opens `/library` via the tab bar, opens Apex, starts a session, returns
 * the session id from the URL.
 */
async function startApexSession(page: Page): Promise<string> {
  await page.getByTestId('tab-library').click()
  await expect(page.getByTestId('library-screen')).toBeVisible()
  await page.locator('a[data-testid^="workout-card-"]').filter({ hasText: 'Apex' }).click()
  await expect(page.getByTestId('workout-detail-screen')).toBeVisible()
  await page.getByTestId('start-session-button').click()
  await expect(page).toHaveURL(/\/session\/[^/?#]+/)
  await expect(page.getByTestId('session-screen')).toBeVisible()
  const match = /\/session\/([^/?#]+)/.exec(page.url())
  const sessionId = match?.[1]
  if (sessionId === undefined) {
    throw new Error(`could not parse session id from url: ${page.url()}`)
  }
  return sessionId
}

/**
 * Click via the DOM node directly. Playwright's pointer click waits for
 * "stable" layout, but the live countdown re-renders RunControls every tick
 * so a normal/force click can hang or land on a detached node.
 */
async function clickSessionControl(page: Page, testId: string): Promise<void> {
  await page.getByTestId(testId).evaluate((node: HTMLElement) => {
    node.click()
  })
}

/**
 * Skip once to leave the ready segment (progressed gate), then keep skipping
 * until `session-phase` is `Done` so `session-finish` is available.
 * Apex has ≤ 16 segments; cap the loop well above that.
 */
async function progressAndSkipToDone(page: Page): Promise<void> {
  const phaseBefore = await page.getByTestId('session-phase').textContent()
  await clickSessionControl(page, 'session-skip')
  await expect
    .poll(async () => {
      const phase = await page.getByTestId('session-phase').textContent()
      return phase === 'Done' || phase !== phaseBefore
    })
    .toBe(true)

  for (let i = 0; i < 20; i++) {
    const phase = await page.getByTestId('session-phase').textContent()
    if (phase === 'Done') {
      return
    }
    const before = phase
    await clickSessionControl(page, 'session-skip')
    await expect
      .poll(async () => {
        const next = await page.getByTestId('session-phase').textContent()
        return next === 'Done' || next !== before
      })
      .toBe(true)
  }
  await expect(page.getByTestId('session-phase')).toHaveText('Done')
}

/**
 * Via the History tab (not `page.goto`), open `/history` and assert the row
 * for this session: Apex name, a non-empty date, and host label. Scope to the
 * row containing `rowMarker` so leftover history from other e2e runs cannot
 * confuse the assertion. Does not assert `participants` — each leave writes a
 * per-stint roster snapshot, so co-leavers may not share the same list.
 * Returns the completion id for progress assertions.
 */
async function assertHistoryRow(
  page: Page,
  input: {
    readonly rowMarker: string
    readonly hostLabel: string
  },
): Promise<string> {
  await page.getByTestId('tab-history').click()
  await expect(page).toHaveURL(/\/history/)
  await expect(page.getByTestId('history-screen')).toBeVisible()
  await expect(page.getByTestId('history-list')).toBeVisible()

  const row = page.locator('[data-testid^="history-row-"]').filter({ hasText: input.rowMarker })
  await expect(row).toBeVisible()
  await expect(row).toContainText('Apex')

  const testId = await row.getAttribute('data-testid')
  if (testId === null || !testId.startsWith('history-row-')) {
    throw new Error(`could not read history-row test id from row: ${testId}`)
  }
  const completionId = testId.slice('history-row-'.length)

  await expect(page.getByTestId(`history-name-${completionId}`)).toHaveText('Apex')
  const dateText = await page.getByTestId(`history-date-${completionId}`).textContent()
  expect(dateText?.trim().length ?? 0).toBeGreaterThan(0)
  await expect(page.getByTestId(`history-host-${completionId}`)).toHaveText(
    `Host: ${input.hostLabel}`,
  )
  return completionId
}

/** Parse `segmentsCompleted` from `history-progress-<id>` text like `"3/12"`. */
async function readHistoryProgressNumerator(page: Page, completionId: string): Promise<number> {
  const progress = page.getByTestId(`history-progress-${completionId}`)
  await expect(progress).toBeVisible()
  const rawText = await progress.textContent()
  const text = rawText?.trim() ?? ''
  const match = /^(\d+)\/(\d+)$/.exec(text)
  if (match === null) {
    throw new Error(`history-progress-${completionId} text was not N/M: ${JSON.stringify(text)}`)
  }
  return Number(match[1])
}

test.describe('history (chromium + webkit)', () => {
  test(
    'two users independently leave a progressed Apex session; both see name, date, host on ' +
      '/history; mid-leave progress numerator is strictly lower than done-leave',
    async ({ page, browser }, testInfo) => {
      test.setTimeout(90_000)

      const projectName = testInfo.project.name
      const env = readE2eEnv()
      const [codeA, codeB] = await mintTwoInviteCodes(page, env.baseUrl, env.owner)

      // Distinct display names (and per-project usernames) so chromium + webkit
      // can share one server without colliding, and history rows disambiguate.
      const displayA = `Hist Host ${projectName}`
      const displayB = `Hist Guest ${projectName}`

      await registerAndReachHome(page, env.baseUrl, {
        code: codeA,
        username: `e2e-hist-a-${projectName}`,
        displayName: displayA,
        pin: '192837',
      })

      const contextB = await browser.newContext()
      const pageB = await contextB.newPage()
      try {
        await registerAndReachHome(pageB, env.baseUrl, {
          code: codeB,
          username: `e2e-hist-b-${projectName}`,
          displayName: displayB,
          pin: '192838',
        })
        await expect(pageB.getByTestId('home-screen')).toBeVisible()

        const sessionId = await startApexSession(page)
        await expect(page).toHaveURL(new RegExp(`/session/${sessionId}`))

        // Active-session cards live on Home; guest is already there after register.
        const card = pageB.getByTestId(`session-card-${sessionId}`)
        await expect(card).toBeVisible({ timeout: 10_000 })
        await card.click()
        await expect(pageB).toHaveURL(new RegExp(`/session/${sessionId}`))
        await expect(pageB.getByTestId('session-screen')).toBeVisible()

        // A progresses past ready, then leaves mid-workout (partial progress).
        const phaseBefore = await page.getByTestId('session-phase').textContent()
        await clickSessionControl(page, 'session-skip')
        await expect
          .poll(async () => {
            const phase = await page.getByTestId('session-phase').textContent()
            return phase === 'Done' || phase !== phaseBefore
          })
          .toBe(true)
        // Leave opens an alert-dialog; only confirm exits mid-workout.
        await clickSessionControl(page, 'session-leave')
        await expect(page.getByTestId('session-leave-dialog')).toBeVisible()
        await page.getByTestId('session-leave-confirm').click()
        // Leave navigates to `/` (home).
        await expect(page.getByTestId('home-screen')).toBeVisible()

        // B continues to Done and leaves via Finish (higher progress).
        await progressAndSkipToDone(pageB)
        await expect(pageB.getByTestId('session-finish')).toBeVisible()
        await clickSessionControl(pageB, 'session-finish')
        await expect(pageB.getByTestId('home-screen')).toBeVisible()

        // Host row still lists B (roster at A's leave); guest row is keyed by host name.
        const completionIdA = await assertHistoryRow(page, {
          rowMarker: displayB,
          hostLabel: 'you',
        })
        const completionIdB = await assertHistoryRow(pageB, {
          rowMarker: displayA,
          hostLabel: displayA,
        })

        const progressA = await readHistoryProgressNumerator(page, completionIdA)
        const progressB = await readHistoryProgressNumerator(pageB, completionIdB)
        expect(progressA).toBeLessThan(progressB)
      } finally {
        await contextB.close()
      }
    },
  )
})
