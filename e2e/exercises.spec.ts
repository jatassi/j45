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
 * `/library`, `/library/exercises`, `/workouts/$workoutId`, `/account`, and
 * the other tab/push leaves are routed — so once the visitor authenticates
 * while still sitting on `/register?invite=...`, `RouterProvider` finds no
 * matching route there. This helper reaches `/account` directly afterwards
 * (a real, matched, authenticated route) so callers land somewhere the
 * router actually renders.
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

/** Opens a base-ui Select by its trigger testid and picks the option with the given label. */
async function pickSelectOption(page: Page, testId: string, optionLabel: string): Promise<void> {
  await page.getByTestId(testId).click()
  await page.getByRole('option', { name: optionLabel }).click()
}

/**
 * Exercises the whole stack this feature adds atop `global-setup.ts`'s
 * harness: registration-time exercise seeding (`registration-seeding`), the
 * live `ExerciseRpcs` handlers, and the routed `/library/exercises` client
 * screen (`exercise-library-screen` drawer/alert-dialog UI). Registers its
 * own per-project account from `exercises.spec.ts`'s own pre-minted invite
 * (`readE2eEnv().exercisesInvitesByProject`) precisely so `fullyParallel`
 * chromium+webkit runs never race `registerInvitesByProject` or
 * `libraryInvitesByProject` for the same codes.
 */
test.describe('exercises (chromium + webkit)', () => {
  test(
    "after registration, '/library/exercises' via the Library tab + Exercises segment lists the 96 seed exercises; " +
      'the calves muscle filter narrows the list; create → reload → edit tags → reload → ' +
      'delete all persist through the real stack; a forced command failure surfaces a toast',
    async ({ page }, testInfo) => {
      const env = readE2eEnv()
      const projectName = projectNameFrom(testInfo)
      const code = env.exercisesInvitesByProject[projectName]
      const username = `e2e-ex-${projectName}`
      const displayName = `Exercises Flow (${projectName})`
      const pin = '6428'
      const createdName = `E2E Wall Ball (${projectName})`

      await registerAccount(page, env.baseUrl, { code, username, displayName, pin })

      // Land on `/` (still authenticated) so the first visit to the catalog
      // goes through the Library tab + Exercises segment control, not a
      // direct `page.goto('/library/exercises')`.
      await page.goto(env.baseUrl)
      await expect(page.getByTestId('home-screen')).toBeVisible()
      await page.getByTestId('tab-library').click()
      await expect(page.getByTestId('library-screen')).toBeVisible()
      await page.getByTestId('library-segment-exercises').click()

      await expect(page).toHaveURL(/\/library\/exercises/)
      await expect(page.getByTestId('exercise-library-screen')).toBeVisible()
      await expect(page.getByTestId('exercise-list')).toBeVisible()
      await expect(exerciseRows(page)).toHaveCount(SEEDED_EXERCISE_COUNT)

      // Domain labels render; raw vocabulary literals never appear as visible text.
      // The seed catalog shows med-ball and jump-rope on the filter chips and
      // on the tags. After ADR-0003 no muscle group has a hyphen. Only
      // equipment can test this rule now.
      const libraryText = await page.getByTestId('exercise-library-screen').textContent()
      expect(libraryText).toContain('Med ball')
      expect(libraryText).toContain('Jump rope')
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
      await expect(page.getByTestId('exercise-drawer')).toBeVisible()
      await page.getByTestId('exercise-form-name').fill(createdName)
      await page.getByTestId('exercise-form-detail').fill('e2e create flow')
      await pickSelectOption(page, 'exercise-form-modality', 'Strength')
      await pickSelectOption(page, 'exercise-form-intensity', 'Moderate')
      // `muscleGroups` is non-empty — submit stays disabled until at least one chip.
      await page.getByTestId('exercise-form-muscle-quads').click()
      await page.getByTestId('exercise-form-equipment-med-ball').click()
      await page.getByTestId('exercise-form-submit').click()

      await expect(page.getByTestId('exercise-drawer')).toHaveCount(0)
      await expect(exerciseRows(page)).toHaveCount(SEEDED_EXERCISE_COUNT + 1)

      const createdRow = exerciseRows(page).filter({ hasText: createdName })
      await expect(createdRow).toHaveCount(1)
      const createdTestId = await createdRow.getAttribute('data-testid')
      if (createdTestId === null) {
        throw new Error('expected created exercise-row-<id> to expose data-testid')
      }
      const createdId = createdTestId.replace('exercise-row-', '')
      await expect(page.getByTestId(`exercise-name-${createdId}`)).toHaveText(createdName)
      // Domain labels for modality, intensity, muscle groups, equipment.
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
      await expect(page.getByTestId('exercise-drawer')).toBeVisible()
      await page.getByTestId('exercise-form-muscle-chest').click()
      await page.getByTestId('exercise-form-muscle-quads').click()
      await page.getByTestId('exercise-form-submit').click()

      await expect(page.getByTestId('exercise-drawer')).toHaveCount(0)
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

      // Force a create failure by dropping CreateExercise frames on the rpc
      // WebSocket, then assert a sonner toast surfaces (not silent swallow).
      await page.routeWebSocket('**/rpc', (ws) => {
        const server = ws.connectToServer()
        ws.onMessage((message) => {
          const text =
            typeof message === 'string'
              ? message
              : Buffer.from(message as ArrayBuffer).toString('utf8')
          if (text.includes('CreateExercise')) {
            try {
              void server.close({ code: 1011, reason: 'forced e2e failure' })
            } catch {
              // ignore
            }
            try {
              void ws.close()
            } catch {
              // ignore
            }
            return
          }
          server.send(message)
        })
        server.onMessage((message) => {
          ws.send(message)
        })
      })

      // Reconnect the client over the intercepted socket.
      await page.reload()
      await expect(page.getByTestId('exercise-library-screen')).toBeVisible()
      await expect(page.getByTestId('exercise-list')).toBeVisible()

      const failName = `E2E Fail Create (${projectName})`
      await page.getByTestId('create-exercise-button').click()
      await expect(page.getByTestId('exercise-drawer')).toBeVisible()
      await page.getByTestId('exercise-form-name').fill(failName)
      await page.getByTestId('exercise-form-muscle-quads').click()
      await page.getByTestId('exercise-form-submit').click()

      await expect(page.locator('[data-sonner-toast]').first()).toBeVisible()
      await expect(page.getByText(/Command failed|Could not/i).first()).toBeVisible()
      // Drawer stays open on failure.
      await expect(page.getByTestId('exercise-drawer')).toBeVisible()
    },
  )
})
