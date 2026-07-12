import type { Page, TestInfo } from '@playwright/test'
import { expect, test } from '@playwright/test'

import type { E2eProjectName } from './support/state.js'
import { readE2eEnv } from './support/state.js'

/**
 * Seed catalog size from `packages/server/src/library/seed-exercises.json`
 * (`seedExercises.length`) — every newly-registered user gets a full copy
 * (see `registration-seeding.test.ts`). Same documentation style as
 * `library.spec.ts`'s hardcoded `12` for the workout seed set.
 */
const SEEDED_EXERCISE_COUNT = 96

/**
 * Exercises tagged `calves` in that same seed catalog — a real proper subset
 * (7 of 96), so filtering on `filter-muscle-calves` is a meaningful narrowing
 * check rather than a tautology.
 */
const CALVES_SEEDED_COUNT = 7

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
 * the passkey enrollment prompt, exactly like `auth-register.spec.ts` /
 * `library.spec.ts`).
 *
 * `router.tsx`'s route tree has no entry for `/register` itself — only `/`,
 * `/workouts/$workoutId`, `/exercises`, and `/account` are routed — so once
 * the visitor authenticates while still sitting on `/register?invite=...`,
 * `RouterProvider` finds no matching route there. This helper reaches
 * `/account` directly afterwards (a real, matched, authenticated route) so
 * callers land somewhere the router actually renders.
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

/** Every `exercise-row-<id>` currently rendered inside the catalog list. */
function exerciseRows(page: Page) {
  return page.locator('[data-testid="exercise-list"] [data-testid^="exercise-row-"]')
}

/**
 * Exercises the whole stack this feature adds atop `global-setup.ts`'s
 * harness: registration-time exercise seeding (`registration-seeding`), the
 * live `ExerciseRpcs` handlers, and the routed `/exercises` client screen
 * (`exercise-library-screen` / `exercise-dialogs`). Registers its own
 * per-project account from `exercises.spec.ts`'s own pre-minted invite
 * (`readE2eEnv().exercisesInvitesByProject`) precisely so `fullyParallel`
 * chromium+webkit runs never race `registerInvitesByProject` or
 * `libraryInvitesByProject` for the same codes.
 */
test.describe('exercises (chromium + webkit)', () => {
  test(
    "after registration, '/exercises' via the home nav lists the 96 seed exercises; " +
      'the calves muscle filter narrows the list; create → reload → edit tags → reload → ' +
      'delete all persist through the real stack',
    async ({ page }, testInfo) => {
      const env = readE2eEnv()
      const projectName = projectNameFrom(testInfo)
      const code = env.exercisesInvitesByProject[projectName]
      const username = `e2e-ex-${projectName}`
      const displayName = `Exercises Flow (${projectName})`
      const pin = '642875'
      const createdName = `E2E Wall Ball (${projectName})`

      await registerAccount(page, env.baseUrl, { code, username, displayName, pin })

      // Land on `/` (still authenticated) so the first visit to `/exercises`
      // goes through `library-screen.tsx`'s `exercises-nav-link`, not a
      // direct `page.goto('/exercises')`.
      await page.goto(env.baseUrl)
      await expect(page.getByTestId('library-screen')).toBeVisible()
      await page.getByTestId('exercises-nav-link').click()

      await expect(page.getByTestId('exercise-library-screen')).toBeVisible()
      await expect(page.getByTestId('exercise-list')).toBeVisible()
      await expect(exerciseRows(page)).toHaveCount(SEEDED_EXERCISE_COUNT)

      // Domain labels render; raw vocabulary literals never appear as visible text.
      // Seed catalog surfaces full-body / med-ball / jump-rope on filter chips + tags.
      const libraryText = await page.getByTestId('exercise-library-screen').textContent()
      expect(libraryText).toContain('Full body')
      expect(libraryText).toContain('Med ball')
      expect(libraryText).toContain('Jump rope')
      expect(libraryText).not.toMatch(/\bfull-body\b/)
      expect(libraryText).not.toMatch(/\bmed-ball\b/)
      expect(libraryText).not.toMatch(/\bjump-rope\b/)

      // Narrow with a real proper-subset facet from the seed catalog.
      await page.getByTestId('filter-muscle-calves').click()
      await expect(exerciseRows(page)).toHaveCount(CALVES_SEEDED_COUNT)
      await expect(exerciseRows(page)).not.toHaveCount(SEEDED_EXERCISE_COUNT)

      // Clear the filter so the create/edit flow sees the full list again.
      await page.getByTestId('filter-muscle-calves').click()
      await expect(exerciseRows(page)).toHaveCount(SEEDED_EXERCISE_COUNT)

      await page.getByTestId('create-exercise-button').click()
      await expect(page.getByTestId('exercise-dialog')).toBeVisible()
      await page.getByTestId('exercise-form-name').fill(createdName)
      await page.getByTestId('exercise-form-detail').fill('e2e create flow')
      await page.getByTestId('exercise-form-modality').selectOption('strength')
      await page.getByTestId('exercise-form-intensity').selectOption('moderate')
      // `muscleGroups` is non-empty — submit stays disabled until at least one chip.
      await page.getByTestId('exercise-form-muscle-quads').click()
      await page.getByTestId('exercise-form-equipment-med-ball').click()
      await page.getByTestId('exercise-form-submit').click()

      await expect(page.getByTestId('exercise-dialog')).toHaveCount(0)
      await expect(exerciseRows(page)).toHaveCount(SEEDED_EXERCISE_COUNT + 1)

      const createdRow = exerciseRows(page).filter({ hasText: createdName })
      await expect(createdRow).toHaveCount(1)
      const createdTestId = await createdRow.getAttribute('data-testid')
      if (createdTestId === null) {
        throw new Error('expected created exercise-row-<id> to expose data-testid')
      }
      const createdId = createdTestId.replace('exercise-row-', '')
      await expect(page.getByTestId(`exercise-name-${createdId}`)).toHaveText(createdName)
      // tagsOf: domain labels for modality, intensity, muscle groups, equipment.
      await expect(createdRow).toContainText('Strength')
      await expect(createdRow).toContainText('Moderate')
      await expect(createdRow).toContainText('Quads')
      await expect(createdRow).toContainText('Med ball')

      await page.reload()
      await expect(page.getByTestId('exercise-library-screen')).toBeVisible()
      await expect(page.getByTestId('exercise-list')).toBeVisible()
      await expect(page.getByTestId(`exercise-name-${createdId}`)).toHaveText(createdName)
      await expect(page.getByTestId(`exercise-row-${createdId}`)).toContainText('Quads')
      await expect(page.getByTestId(`exercise-row-${createdId}`)).toContainText('Med ball')

      // Real tag change: swap quads → chest (toggle chest on first so the
      // draft stays valid while quads is removed).
      await page.getByTestId(`edit-exercise-${createdId}`).click()
      await expect(page.getByTestId('exercise-dialog')).toBeVisible()
      await page.getByTestId('exercise-form-muscle-chest').click()
      await page.getByTestId('exercise-form-muscle-quads').click()
      await page.getByTestId('exercise-form-submit').click()

      await expect(page.getByTestId('exercise-dialog')).toHaveCount(0)
      const editedRow = page.getByTestId(`exercise-row-${createdId}`)
      await expect(editedRow).toContainText('Chest')
      await expect(editedRow).not.toContainText('Quads')
      await expect(editedRow).toContainText('Med ball')

      await page.reload()
      await expect(page.getByTestId('exercise-library-screen')).toBeVisible()
      await expect(page.getByTestId(`exercise-row-${createdId}`)).toContainText('Chest')
      await expect(page.getByTestId(`exercise-row-${createdId}`)).not.toContainText('Quads')
      await expect(page.getByTestId(`exercise-row-${createdId}`)).toContainText('Med ball')
      await expect(page.getByTestId(`exercise-name-${createdId}`)).toHaveText(createdName)

      await page.getByTestId(`delete-exercise-${createdId}`).click()
      await expect(page.getByTestId('delete-dialog')).toBeVisible()
      await page.getByTestId('confirm-delete-button').click()

      await expect(page.getByTestId('delete-dialog')).toHaveCount(0)
      await expect(exerciseRows(page)).toHaveCount(SEEDED_EXERCISE_COUNT)
      await expect(page.getByTestId(`exercise-row-${createdId}`)).toHaveCount(0)
      await expect(exerciseRows(page).filter({ hasText: createdName })).toHaveCount(0)
    },
  )
})
