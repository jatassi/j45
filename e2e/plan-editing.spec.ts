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
 * `/workouts/$workoutId`, and `/account` are routed — so once the visitor
 * authenticates while still sitting on `/register?invite=...`,
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

/** Every `workout-card-<id>` `Link` currently rendered on the library home. */
function workoutCards(page: Page) {
  return page.locator('a[data-testid^="workout-card-"]')
}

/**
 * Exercises the whole plan-editing stack: create-from-scratch via
 * `/workouts/new`, and structural edit of an existing workout (flow type,
 * station rename, station reorder, validation) via `/workouts/<id>/edit`.
 * Each test registers its own per-project account from
 * `plan-editing.spec.ts`'s own pre-minted invite pair
 * (`readE2eEnv().planEditingInvitesByProject`) so `fullyParallel`
 * chromium+webkit runs never share accounts with each other or with
 * `library.spec.ts` / `auth-register.spec.ts`.
 */
test.describe('plan-editing (chromium + webkit)', () => {
  test(
    'New workout from scratch: create via editor, land on detail with pods/stations, ' +
      'and the library card survives a page reload',
    async ({ page }, testInfo) => {
      const env = readE2eEnv()
      const projectName = projectNameFrom(testInfo)
      const [code] = env.planEditingInvitesByProject[projectName]
      const username = `e2e-plan-${projectName}`
      const displayName = `Plan Editing (${projectName})`
      const pin = '246810'
      const workoutName = 'Sprint Circuit'

      await registerAccount(page, env.baseUrl, { code, username, displayName, pin })

      await page.goto(env.baseUrl)
      await expect(page.getByTestId('library-screen')).toBeVisible()
      await page.getByTestId('new-workout-button').click()

      await expect(page.getByTestId('workout-editor-screen')).toBeVisible()

      await page.getByTestId('editor-name').fill(workoutName)
      await page.getByTestId('editor-focus').selectOption('strength')

      const pod = page.getByTestId('pod-editor').first()
      await pod.getByTestId('pod-name-input').fill('Main Pod')
      await pod.getByTestId('station-name-input').first().fill('Wall Balls')
      await pod.getByTestId('add-station').click()
      await pod.getByTestId('station-name-input').nth(1).fill('Box Jumps')

      await page.getByTestId('editor-flow-type').selectOption('sets')
      await page.getByTestId('editor-round-count').fill('3')
      await page.getByTestId('editor-uniform-work').fill('30')
      await page.getByTestId('editor-uniform-rest').fill('10')

      await expect(page.getByTestId('editor-summary')).toBeVisible()
      await expect(page.getByTestId('editor-save')).toBeEnabled()
      await page.getByTestId('editor-save').click()

      await expect(page.getByTestId('workout-detail-screen')).toBeVisible()
      await expect(page.getByTestId('workout-title')).toHaveText(workoutName)
      await expect(page.getByTestId('pod')).toHaveCount(1)
      await expect(page.getByTestId('station')).toHaveCount(2)
      await expect(page.getByTestId('station-name')).toHaveText(['Wall Balls', 'Box Jumps'])

      await page.getByTestId('library-nav-link').click()
      await expect(page.getByTestId('library-screen')).toBeVisible()
      const createdCard = workoutCards(page).filter({ hasText: workoutName })
      await expect(createdCard).toHaveCount(1)

      await page.reload()
      await expect(page.getByTestId('library-screen')).toBeVisible()
      await expect(workoutCards(page).filter({ hasText: workoutName })).toHaveCount(1)
    },
  )

  test(
    'editing a duplicated Athletica: flow switch, rename, reorder, cross-pod move, ' +
      'summary chip, and validation all persist across reloads',
    async ({ page }, testInfo) => {
      const env = readE2eEnv()
      const projectName = projectNameFrom(testInfo)
      const [, code] = env.planEditingInvitesByProject[projectName]
      const username = `e2e-plan2-${projectName}`
      const displayName = `Plan Editing Edit (${projectName})`
      const pin = '864209'
      const renamedStation = 'Rower Sprint Renamed'
      const movedStation = 'Dumbbell squat + alternating shoulder press'

      await registerAccount(page, env.baseUrl, { code, username, displayName, pin })

      await page.goto(env.baseUrl)
      await expect(page.getByTestId('library-screen')).toBeVisible()

      const athleticaLink = workoutCards(page).filter({ hasText: 'Athletica' })
      await expect(athleticaLink).toHaveCount(1)
      await athleticaLink.click()

      await expect(page.getByTestId('workout-detail-screen')).toBeVisible()
      await page.getByTestId('duplicate-button').click()

      await expect(page.getByTestId('library-screen')).toBeVisible()
      const copyLink = workoutCards(page).filter({ hasText: 'Athletica (copy)' })
      await expect(copyLink).toHaveCount(1)
      await copyLink.click()

      await expect(page.getByTestId('workout-detail-screen')).toBeVisible()
      await page.getByTestId('edit-button').click()

      await expect(page.getByTestId('workout-editor-screen')).toBeVisible()
      await expect(page.getByTestId('editor-summary')).toHaveText('27 works · 26:45')

      await page.getByTestId('editor-flow-type').selectOption('sets')

      const pod1 = page.getByTestId('pod-editor').first()
      const stationEditors = pod1.getByTestId('station-editor')
      await stationEditors.nth(0).getByTestId('station-name-input').fill(renamedStation)
      await stationEditors.nth(1).getByTestId('station-down').click()

      // After reorder: renamed, Burpee, Dumbbell. Move Dumbbell (last) to Pod 2.
      await stationEditors
        .nth(2)
        .getByTestId('station-move-to-pod')
        .selectOption({ label: 'Pod 2' })

      await expect(pod1.getByTestId('station-name-input')).toHaveCount(2)
      await expect(pod1.getByTestId('station-name-input').nth(0)).toHaveValue(renamedStation)
      await expect(pod1.getByTestId('station-name-input').nth(1)).toHaveValue('Burpee')
      const pod2 = page.getByTestId('pod-editor').nth(1)
      await expect(pod2.getByTestId('station-name-input')).toHaveCount(4)
      await expect(pod2.getByTestId('station-name-input').nth(3)).toHaveValue(movedStation)

      await expect(page.getByTestId('editor-save')).toBeEnabled()
      await page.getByTestId('editor-save').click()

      await expect(page.getByTestId('workout-detail-screen')).toBeVisible()
      const firstPod = page.getByTestId('pod').first()
      await expect(firstPod.getByTestId('station-name')).toHaveText([renamedStation, 'Burpee'])
      const secondPod = page.getByTestId('pod').nth(1)
      await expect(secondPod.getByTestId('station-name')).toHaveText([
        'Bike or treadmill — sprint effort',
        'Kettlebell swing',
        'Mountain climbers — fast, hips low',
        movedStation,
      ])

      await page.reload()
      await expect(page.getByTestId('workout-detail-screen')).toBeVisible()
      await expect(page.getByTestId('pod').first().getByTestId('station-name')).toHaveText([
        renamedStation,
        'Burpee',
      ])
      await expect(page.getByTestId('pod').nth(1).getByTestId('station-name')).toHaveText([
        'Bike or treadmill — sprint effort',
        'Kettlebell swing',
        'Mountain climbers — fast, hips low',
        movedStation,
      ])

      await page.getByTestId('edit-button').click()
      await expect(page.getByTestId('workout-editor-screen')).toBeVisible()
      await expect(page.getByTestId('editor-flow-type')).toHaveValue('sets')

      await page.reload()
      await expect(page.getByTestId('workout-editor-screen')).toBeVisible()
      await expect(page.getByTestId('editor-flow-type')).toHaveValue('sets')

      const reloadedPod1 = page.getByTestId('pod-editor').first()
      await reloadedPod1
        .getByTestId('station-editor')
        .nth(0)
        .getByTestId('station-name-input')
        .fill('')
      await expect(page.getByTestId('editor-save')).toBeDisabled()
      await expect(page.getByTestId('editor-error')).toBeVisible()
      await expect(page.getByTestId('editor-error')).not.toHaveText('')
    },
  )
})
