/// <reference lib="dom" />
import type { Page, TestInfo } from '@playwright/test'
import { expect, test } from '@playwright/test'

import type { E2eProjectName } from './support/state.js'
import { readE2eEnv } from './support/state.js'

/** Narrows Playwright's `project.name` to the two projects this suite runs under. */
function projectNameFrom(testInfo: TestInfo): E2eProjectName {
  const name = testInfo.project.name
  if (name !== 'chromium' && name !== 'webkit') {
    throw new Error(`unexpected Playwright project name: ${name}`)
  }
  return name
}

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
 * PIN-login as the shared owner, mint one fresh invite code via the real
 * People & Invites UI, then log out back to `login-screen`. Same pattern as
 * `history.spec.ts` / `live-session.spec.ts` — no shared invite pool needed.
 */
async function mintOneInviteCode(
  page: Page,
  baseUrl: string,
  owner: { readonly username: string; readonly pin: string },
): Promise<string> {
  await page.goto(baseUrl)
  await page.locator('#login-username').fill(owner.username)
  await page.locator('#login-pin').fill(owner.pin)
  await expect(page.getByTestId('home-screen')).toBeVisible()
  await page.getByTestId('avatar-chip').click()
  await expect(page.getByTestId('account-screen')).toBeVisible()
  await expect(page.getByTestId('people-invites')).toBeVisible()

  await page.getByTestId('mint-invite-button').click()
  const minted = page.getByTestId('minted-invite-code')
  await expect(minted).toBeVisible()
  const grouped = await minted.textContent()
  if (grouped === null) {
    throw new Error('mint produced no minted-invite-code text')
  }
  const code = grouped.replaceAll('-', '')

  await page.getByTestId('logout-button').click()
  await expect(page.getByTestId('login-screen')).toBeVisible()
  return code
}

/** Every `workout-card-<id>` `Link` currently rendered on the library list. */
function workoutCards(page: Page) {
  return page.locator('a[data-testid^="workout-card-"]')
}

/** Compile chip shape: `N works · MM:SS` (or `M:SS` for short totals). */
const SUMMARY_SHAPE = /^\d+ works · \d{1,2}:\d{2}$/

/** Opens a base-ui Select by its trigger testid and picks the option with the given label. */
async function pickSelectOption(page: Page, testId: string, optionLabel: string): Promise<void> {
  await page.getByTestId(testId).click()
  await page.getByRole('option', { name: optionLabel }).click()
}

/**
 * Opens `/generate` from the tab bar, applies permissive constraints
 * (hybrid / 30 min / all equipment default / no emphasis / default no-repeat),
 * and clicks Generate until a preview appears.
 */
async function generatePreview(page: Page): Promise<void> {
  await page.getByTestId('tab-generate').click()
  await expect(page).toHaveURL(/\/generate/)
  await expect(page.getByTestId('generate-screen')).toBeVisible()

  // Explicit knobs via kit controls (defaults are already permissive; set them
  // so the test documents the intended constraint surface).
  await page.getByTestId('generate-focus-hybrid').click()
  // Duration defaults to 30; step once down and back up so the stepper is exercised.
  await page.getByTestId('generate-target-minutes-dec').click()
  await page.getByTestId('generate-target-minutes-inc').click()
  await expect(page.getByTestId('generate-target-minutes')).toHaveValue('30')
  await pickSelectOption(page, 'generate-emphasis', 'None')

  await page.getByTestId('generate-button').click()
  await expect(page.getByTestId('generate-preview')).toBeVisible({ timeout: 30_000 })
  await expect(page.getByTestId('generate-error')).toHaveCount(0)
}

/**
 * Asserts domain label maps render on the generate form and that the raw
 * vocabulary strings `full-body`, `med-ball`, `jump-rope`, and focus literals
 * never appear as visible text.
 */
async function assertDomainLabelsOnGenerateScreen(page: Page): Promise<void> {
  await expect(page.getByTestId('generate-screen')).toBeVisible()
  await expect(page.getByTestId('generate-focus-cardio')).toHaveText('Cardio')
  await expect(page.getByTestId('generate-focus-strength')).toHaveText('Strength')
  await expect(page.getByTestId('generate-focus-hybrid')).toHaveText('Hybrid')
  await expect(page.getByTestId('generate-equipment-med-ball')).toHaveText('Med ball')
  await expect(page.getByTestId('generate-equipment-jump-rope')).toHaveText('Jump rope')

  // Emphasis options live in the base-ui Select popup — open, assert, dismiss.
  await page.getByTestId('generate-emphasis').click()
  await expect(page.getByRole('option', { name: 'Full body' })).toBeVisible()
  await expect(page.getByRole('option', { name: 'full-body' })).toHaveCount(0)
  // Pick None so the popup closes without changing the default.
  await page.getByRole('option', { name: 'None' }).click()

  const generateText = await page.getByTestId('generate-screen').textContent()
  expect(generateText).toContain('Cardio')
  expect(generateText).toContain('Strength')
  expect(generateText).toContain('Hybrid')
  expect(generateText).toContain('Med ball')
  expect(generateText).toContain('Jump rope')
  expect(generateText).not.toMatch(/\bfull-body\b/)
  expect(generateText).not.toMatch(/\bmed-ball\b/)
  expect(generateText).not.toMatch(/\bjump-rope\b/)
  // Focus toggle visible text is labels only — raw focus literals stay off-screen.
  const focusText = await page.getByTestId('generate-focus').textContent()
  expect(focusText).not.toMatch(/\bcardio\b/)
  expect(focusText).not.toMatch(/\bstrength\b/)
  expect(focusText).not.toMatch(/\bhybrid\b/)
}

/**
 * Captures the visible codename + summary chip from the generate preview.
 * Asserts both are non-empty / well-shaped so call sites stay linear.
 */
async function capturePreviewIdentity(page: Page): Promise<{
  readonly codename: string
  readonly summary: string
}> {
  const codenameText = await page.getByTestId('generate-codename').textContent()
  const codename = codenameText?.trim() ?? ''
  expect(codename.length).toBeGreaterThan(0)

  const summaryText = await page.getByTestId('generate-summary').textContent()
  const summary = summaryText?.trim() ?? ''
  expect(summary).toMatch(SUMMARY_SHAPE)

  return { codename, summary }
}

/** `data-seed` on the generate preview element (via `dataset`, not getAttribute). */
async function previewSeed(preview: ReturnType<Page['getByTestId']>): Promise<string | undefined> {
  return preview.evaluate((el) => {
    if (!(el instanceof HTMLElement)) {
      return undefined
    }
    return el.dataset.seed
  })
}

test.describe('generate (chromium + webkit)', () => {
  test(
    'from Home: generate preview (codename + works·duration chip) via the Generate tab, regenerate ' +
      'changes data-seed, edit opens editor on the draft, save lands in library and ' +
      'survives reload',
    async ({ page }, testInfo) => {
      test.setTimeout(90_000)

      const env = readE2eEnv()
      const projectName = projectNameFrom(testInfo)
      const code = await mintOneInviteCode(page, env.baseUrl, env.owner)

      await registerAndReachHome(page, env.baseUrl, {
        code,
        username: `e2e-gen-${projectName}`,
        displayName: `Generate Flow (${projectName})`,
        pin: '5173',
      })

      // --- 1. Generate preview via tab bar + form knobs ---
      await page.goto(env.baseUrl)
      await expect(page.getByTestId('home-screen')).toBeVisible()
      await page.getByTestId('tab-generate').click()
      await expect(page).toHaveURL(/\/generate/)
      await assertDomainLabelsOnGenerateScreen(page)

      // Resume the generate flow after the label assertion (same knobs as generatePreview).
      await page.getByTestId('generate-focus-hybrid').click()
      await expect(page.getByTestId('generate-target-minutes')).toHaveValue('30')
      await pickSelectOption(page, 'generate-emphasis', 'None')
      await page.getByTestId('generate-button').click()
      await expect(page.getByTestId('generate-preview')).toBeVisible({ timeout: 30_000 })
      await expect(page.getByTestId('generate-error')).toHaveCount(0)

      const preview = page.getByTestId('generate-preview')
      await expect(preview).toBeVisible()
      const firstIdentity = await capturePreviewIdentity(page)
      expect(firstIdentity.codename.length).toBeGreaterThan(0)
      await expect(page.getByTestId('generate-summary')).toHaveText(SUMMARY_SHAPE)

      // --- 2. Regenerate changes data-seed ---
      const seedBefore = await previewSeed(preview)
      expect(seedBefore).toBeDefined()
      expect(seedBefore?.length ?? 0).toBeGreaterThan(0)

      await page.getByTestId('generate-regenerate').click()
      await expect(preview).toBeVisible({ timeout: 30_000 })
      await expect.poll(async () => previewSeed(preview), { timeout: 30_000 }).not.toBe(seedBefore)
      await expect(page.getByTestId('generate-codename')).not.toHaveText('')
      await expect(page.getByTestId('generate-summary')).toHaveText(SUMMARY_SHAPE)

      // Capture post-regenerate identity for Edit (and later Save re-generate).
      const { codename: editCodename, summary: editSummary } = await capturePreviewIdentity(page)

      // --- 3. Edit opens the workout editor seeded with the preview ---
      await page.getByTestId('generate-edit').click()
      await expect(page).toHaveURL(/\/workouts\/new/)
      await expect(page.getByTestId('workout-editor-screen')).toBeVisible()
      await expect(page.getByTestId('editor-name')).toHaveValue(editCodename)
      await expect(page.getByTestId('editor-summary')).toHaveText(editSummary)

      // --- 4. Save lands the workout in the library and survives reload ---
      // Back out of the pristine handoff draft (mount-time initial already
      // holds the preview — no dirty confirm), then generate a fresh preview
      // to Save (Edit navigated away from the generate form knobs).
      await page.getByTestId('back-button').click()
      await expect(page.getByTestId('editor-discard-dialog')).toHaveCount(0)
      // history.back returns to Generate; regenerate from there.
      await expect(page.getByTestId('generate-screen')).toBeVisible()
      await generatePreview(page)

      const { codename: saveCodename } = await capturePreviewIdentity(page)

      await page.getByTestId('generate-save').click()
      await expect(page.getByTestId('workout-detail-screen')).toBeVisible({ timeout: 15_000 })
      await expect(page.getByTestId('workout-title')).toHaveText(saveCodename)

      await page.getByTestId('library-nav-link').click()
      await expect(page.getByTestId('library-screen')).toBeVisible()
      const savedCard = workoutCards(page).filter({ hasText: saveCodename })
      await expect(savedCard).toHaveCount(1)

      await page.reload()
      await expect(page.getByTestId('library-screen')).toBeVisible()
      await expect(workoutCards(page).filter({ hasText: saveCodename })).toHaveCount(1)
    },
  )

  test(
    'starved constraints render GenerationInfeasible as an inline alert naming the constraint; ' +
      'form stays editable and a prior preview is not blanked',
    async ({ page }, testInfo) => {
      test.setTimeout(90_000)

      const env = readE2eEnv()
      const projectName = projectNameFrom(testInfo)
      // Separate username so this test does not collide with the happy-path account.
      const code = await mintOneInviteCode(page, env.baseUrl, env.owner)

      await registerAndReachHome(page, env.baseUrl, {
        code,
        username: `e2e-gen-inf-${projectName}`,
        displayName: `Generate Infeasible (${projectName})`,
        pin: '5173',
      })

      await page.goto(env.baseUrl)
      await expect(page.getByTestId('home-screen')).toBeVisible()
      await generatePreview(page)

      const priorCodename = await page.getByTestId('generate-codename').textContent()
      expect(priorCodename?.trim().length ?? 0).toBeGreaterThan(0)

      // Strength + Calves starves the seed catalog (one calves-tagged strength
      // exercise) while keeping the form knobs on the real kit controls.
      await page.getByTestId('generate-focus-strength').click()
      await pickSelectOption(page, 'generate-emphasis', 'Calves')
      await page.getByTestId('generate-button').click()

      const error = page.getByTestId('generate-error')
      await expect(error).toBeVisible({ timeout: 30_000 })
      await expect(error).toHaveAttribute('role', 'alert')
      // Typed reason names the starved constraint (pool / equipment / stations).
      await expect(error).toContainText(/exercise|equipment|station|pool/i)

      // Prior preview stays put — never blanked by the infeasible response.
      await expect(page.getByTestId('generate-preview')).toBeVisible()
      await expect(page.getByTestId('generate-codename')).toHaveText(priorCodename?.trim() ?? '')

      // Form remains editable: flip focus back to Hybrid.
      await page.getByTestId('generate-focus-hybrid').click()
      await expect(page.getByTestId('generate-focus-hybrid')).toHaveAttribute(
        'aria-pressed',
        'true',
      )
      await expect(page.getByTestId('generate-target-minutes')).toBeEnabled()
      await expect(page.getByTestId('generate-emphasis')).toBeEnabled()
    },
  )
})
