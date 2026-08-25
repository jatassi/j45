/// <reference lib="dom" />
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
 * passkey enrollment), then reaches `/account` — a real, matched,
 * authenticated route — exactly like `plan-editing.spec.ts`'s helper.
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

/**
 * Opens a station's New/Edit actions drawer and clicks a structural action by
 * testid (add station / move to pod / delete). Mirrors plan-editing.spec.ts.
 */
async function stationDrawerAction(
  page: Page,
  stationActions: ReturnType<Page['getByTestId']>,
  actionTestId: string,
): Promise<void> {
  await stationActions.click()
  await expect(page.getByTestId('editor-station-drawer')).toBeVisible()
  await page.getByTestId(actionTestId).click()
  await expect(page.getByTestId('editor-station-drawer')).toHaveCount(0)
}

/**
 * Opens a station's launch-mode (reflow) actions drawer and clicks a structural
 * action by testid (move to pod / remove station).
 */
async function reflowStationDrawerAction(
  page: Page,
  stationActions: ReturnType<Page['getByTestId']>,
  actionTestId: string,
): Promise<void> {
  await stationActions.click()
  await expect(page.getByTestId('reflow-station-drawer')).toBeVisible()
  await page.getByTestId(actionTestId).click()
  await expect(page.getByTestId('reflow-station-drawer')).toHaveCount(0)
}

/**
 * Builds a fresh two-pod, sets-flow source workout through the real editor and
 * lands on its detail screen; returns the new workout's id (read off the URL).
 * Pod "Alpha": Alpha Push, Alpha Pull. Pod "Bravo": Bravo Squat. Flattened
 * station indexes 0/1/2. Sets, two uniform rounds of 20″/10″.
 */
async function createSource(page: Page, baseUrl: string, name: string): Promise<string> {
  await page.goto(baseUrl)
  await expect(page.getByTestId('home-screen')).toBeVisible()
  // Workout list / New workout live under Library now; Home only has the quick link.
  await page.getByTestId('home-new-workout-link').click()
  await expect(page.getByTestId('workout-editor-screen')).toBeVisible()

  await page.getByTestId('editor-name').fill(name)
  await page.getByTestId('editor-focus-strength').click()

  const alpha = page.getByTestId('pod-editor').first()
  await alpha.getByTestId('pod-name-input').fill('Alpha')
  await alpha.getByTestId('station-name-input').first().fill('Alpha Push')
  // Add a second station via the per-station actions drawer (no inline add).
  await stationDrawerAction(
    page,
    alpha.getByTestId('editor-station-actions').first(),
    'editor-add-station',
  )
  await alpha.getByTestId('station-name-input').nth(1).fill('Alpha Pull')

  await page.getByTestId('add-pod').click()
  const bravo = page.getByTestId('pod-editor').nth(1)
  await bravo.getByTestId('pod-name-input').fill('Bravo')
  await bravo.getByTestId('station-name-input').first().fill('Bravo Squat')

  await page.getByTestId('editor-flow-sets').click()
  await page.getByTestId('editor-round-count').fill('2')
  await page.getByTestId('editor-uniform-work').fill('20')
  await page.getByTestId('editor-uniform-rest').fill('10')

  await expect(page.getByTestId('editor-save')).toBeEnabled()
  await page.getByTestId('editor-save').click()

  await expect(page.getByTestId('workout-detail-screen')).toBeVisible()
  const url = page.url()
  return url.slice(url.lastIndexOf('/') + 1)
}

/** Moves Bravo's single station into Alpha, then removes the now-empty Bravo pod. */
async function regroupIntoAlpha(page: Page): Promise<void> {
  const bravo = page.getByTestId('reflow-pod-editor').nth(1)
  await reflowStationDrawerAction(
    page,
    bravo.getByTestId('reflow-station-actions').first(),
    'reflow-move-to-pod-0',
  )
  await bravo.getByTestId('reflow-remove-pod').click()
  await expect(page.getByTestId('reflow-pod-editor')).toHaveCount(1)
}

test.describe('flow-control launch mode (chromium + webkit)', () => {
  test(
    'Start with reflow: regroup + flip sets→laps updates the chip, Start runs the ' +
      'reflowed structure, and the library workout is unchanged after a reload',
    async ({ page }, testInfo) => {
      const env = readE2eEnv()
      const projectName = projectNameFrom(testInfo)
      const [code] = env.flowControlInvitesByProject[projectName]
      await registerAccount(page, env.baseUrl, {
        code,
        username: `e2e-flow-${projectName}`,
        displayName: `Flow Control (${projectName})`,
        pin: '3141',
      })

      const workoutId = await createSource(page, env.baseUrl, 'Reflow Start Source')

      await page.getByTestId('start-with-reflow-button').click()
      await expect(page.getByTestId('reflow-editor-screen')).toBeVisible()
      await expect(page.getByTestId('reflow-summary')).toHaveText('6 works · 2:55')

      // Launch mode is read-only content: no station-name inputs, no add-station.
      await expect(page.getByTestId('station-name-input')).toHaveCount(0)
      await expect(page.getByTestId('add-station')).toHaveCount(0)
      await expect(page.getByTestId('reflow-station-name')).toHaveText([
        'Alpha Push',
        'Alpha Pull',
        'Bravo Squat',
      ])

      await regroupIntoAlpha(page)
      // Drop Alpha Pull (now the second station of the single pod), then flip to laps.
      await reflowStationDrawerAction(
        page,
        page.getByTestId('reflow-station').nth(1).getByTestId('reflow-station-actions'),
        'reflow-remove-station',
      )
      await page.getByTestId('reflow-flow-laps').click()

      await expect(page.getByTestId('reflow-summary')).toHaveText('4 works · 1:55')

      await expect(page.getByTestId('reflow-start')).toBeEnabled()
      await page.getByTestId('reflow-start').click()

      await expect(page.getByTestId('session-screen')).toBeVisible()
      expect(page.url()).toContain('/session/')
      await expect(page.locator('[data-testid^="session-progress-cell-"]')).toHaveCount(4)
      await expect(page.getByTestId('session-pod-group-0')).toBeVisible()
      await expect(page.getByTestId('session-pod-group-1')).toHaveCount(0)

      // Leave the launched session. Do not navigate away from it. A session
      // that stays live keeps its row in every account's lobby until the
      // 60-second collector removes it.
      await page.getByTestId('session-leave').evaluate((node: HTMLElement) => {
        node.click()
      })
      await expect(page.getByTestId('session-leave-dialog')).toBeVisible()
      await page.getByTestId('session-leave-confirm').click()
      await expect(page.getByTestId('home-screen')).toBeVisible()

      // The saved plan is untouched — still two pods, three stations, sets.
      await page.goto(`${env.baseUrl}/workouts/${workoutId}`)
      await page.reload()
      await expect(page.getByTestId('workout-detail-screen')).toBeVisible()
      await expect(page.getByTestId('pod')).toHaveCount(2)
      await expect(page.getByTestId('station-name')).toHaveText([
        'Alpha Push',
        'Alpha Pull',
        'Bravo Squat',
      ])
      await expect(page.getByTestId('workout-flow-summary')).toHaveText('Sets · 20″/10″ × 2')
    },
  )

  test(
    'Save to plan: the same regroup persists — the detail screen shows the new ' +
      'single-pod grouping after a page reload',
    async ({ page }, testInfo) => {
      const env = readE2eEnv()
      const projectName = projectNameFrom(testInfo)
      const [, code] = env.flowControlInvitesByProject[projectName]
      await registerAccount(page, env.baseUrl, {
        code,
        username: `e2e-flow2-${projectName}`,
        displayName: `Flow Control Save (${projectName})`,
        pin: '2718',
      })

      const workoutId = await createSource(page, env.baseUrl, 'Reflow Save Source')

      await page.getByTestId('start-with-reflow-button').click()
      await expect(page.getByTestId('reflow-editor-screen')).toBeVisible()

      await regroupIntoAlpha(page)
      await page.getByTestId('reflow-flow-laps').click()

      await expect(page.getByTestId('reflow-save')).toBeEnabled()
      await page.getByTestId('reflow-save').click()

      await expect(page.getByTestId('workout-detail-screen')).toBeVisible()
      await expect(page.getByTestId('pod')).toHaveCount(1)
      await expect(page.getByTestId('station-name')).toHaveText([
        'Alpha Push',
        'Alpha Pull',
        'Bravo Squat',
      ])

      await page.goto(`${env.baseUrl}/workouts/${workoutId}`)
      await page.reload()
      await expect(page.getByTestId('workout-detail-screen')).toBeVisible()
      await expect(page.getByTestId('pod')).toHaveCount(1)
      await expect(page.getByTestId('pod-name')).toHaveText('Alpha')
      await expect(page.getByTestId('station-name')).toHaveText([
        'Alpha Push',
        'Alpha Pull',
        'Bravo Squat',
      ])
    },
  )
})
