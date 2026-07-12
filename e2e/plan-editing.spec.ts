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

/**
 * PIN-login as the shared owner, mint one fresh invite code via the real
 * People & Invites UI, then log out back to `login-screen`. Used for the
 * dirty-back test which needs a third account beyond the pre-minted pair.
 */
async function mintOneInviteCode(
  page: Page,
  baseUrl: string,
  owner: { readonly username: string; readonly pin: string },
): Promise<string> {
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

/**
 * Opens `/library` via the bottom tab bar and waits for `library-screen`.
 * Used when the app has landed on Home and the test needs the workout list
 * or the Library "New workout" action.
 */
async function openLibraryTab(page: Page): Promise<void> {
  await page.getByTestId('tab-library').click()
  await expect(page.getByTestId('library-screen')).toBeVisible()
}

/**
 * Opens a station's actions drawer and clicks a structural action by testid
 * (add station / move to pod / delete). Prefer testid clicks over coordinates
 * so bottom-pinned drawer buttons stay stable under CPU contention.
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
 * Exercises the whole plan-editing stack: create-from-scratch via
 * `/workouts/new`, and structural edit of an existing workout (flow type,
 * station rename, station reorder, validation) via `/workouts/<id>/edit`.
 * Create + edit tests register from `planEditingInvitesByProject` (one
 * invite each) so `fullyParallel` chromium+webkit runs never share
 * accounts with each other or with other specs. The dirty-back test mints
 * a third invite on the fly via the owner UI (username ≤ 20 chars).
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
      await expect(page.getByTestId('home-screen')).toBeVisible()
      await openLibraryTab(page)
      await page.getByTestId('new-workout-button').click()

      await expect(page.getByTestId('workout-editor-screen')).toBeVisible()

      await page.getByTestId('editor-name').fill(workoutName)
      await page.getByTestId('editor-focus-strength').click()

      const pod = page.getByTestId('pod-editor').first()
      await pod.getByTestId('pod-name-input').fill('Main Pod')
      await pod.getByTestId('station-name-input').first().fill('Wall Balls')
      // Add a second station via the per-station actions drawer (no inline add).
      await stationDrawerAction(
        page,
        pod.getByTestId('editor-station-actions').first(),
        'editor-add-station',
      )
      await pod.getByTestId('station-name-input').nth(1).fill('Box Jumps')

      await page.getByTestId('editor-flow-sets').click()
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
      await expect(page.getByTestId('home-screen')).toBeVisible()
      await openLibraryTab(page)

      const athleticaLink = workoutCards(page).filter({ hasText: 'Athletica' })
      await expect(athleticaLink).toHaveCount(1)
      await athleticaLink.click()

      await expect(page.getByTestId('workout-detail-screen')).toBeVisible()
      await page.getByTestId('duplicate-button').click()

      // Duplicate navigates to `/` (home); open Library to find the copy.
      await expect(page.getByTestId('home-screen')).toBeVisible()
      await openLibraryTab(page)
      const copyLink = workoutCards(page).filter({ hasText: 'Athletica (copy)' })
      await expect(copyLink).toHaveCount(1)
      await copyLink.click()

      await expect(page.getByTestId('workout-detail-screen')).toBeVisible()
      await page.getByTestId('edit-button').click()

      await expect(page.getByTestId('workout-editor-screen')).toBeVisible()
      await expect(page.getByTestId('editor-summary')).toHaveText('27 works · 26:45')

      await page.getByTestId('editor-flow-sets').click()

      const pod1 = page.getByTestId('pod-editor').first()
      const stationNames = pod1.getByTestId('station-name-input')
      await stationNames.nth(0).fill(renamedStation)
      // Reorder: move Dumbbell (index 1) down past Burpee.
      await pod1.getByTestId('station-down').nth(1).click()

      // After reorder: renamed, Burpee, Dumbbell. Move Dumbbell (last) to Pod 2
      // via the station actions drawer (no inline select).
      await stationDrawerAction(
        page,
        pod1.getByTestId('editor-station-actions').nth(2),
        'editor-move-to-pod-1',
      )

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
      await expect(page.getByTestId('editor-flow-sets')).toHaveAttribute('aria-pressed', 'true')

      await page.reload()
      await expect(page.getByTestId('workout-editor-screen')).toBeVisible()
      await expect(page.getByTestId('editor-flow-sets')).toHaveAttribute('aria-pressed', 'true')

      const reloadedPod1 = page.getByTestId('pod-editor').first()
      await reloadedPod1.getByTestId('station-name-input').nth(0).fill('')
      await expect(page.getByTestId('editor-save')).toBeDisabled()
      // Field-level validation pins next to the station — no page-level banner.
      const stationError = page.getByTestId('station-name-error')
      await expect(stationError).toBeVisible()
      await expect(stationError).not.toHaveText('')
    },
  )

  test(
    'dirty draft backs out only after discard confirm; pristine draft backs out with no dialog ' +
      'and nothing is persisted',
    async ({ page }, testInfo) => {
      test.setTimeout(90_000)

      const env = readE2eEnv()
      const projectName = projectNameFrom(testInfo)
      const code = await mintOneInviteCode(page, env.baseUrl, env.owner)
      // Username schema is 3–20 chars (`^[a-z0-9][a-z0-9._-]{2,19}$/i`).
      const username = `e2e-pdisc-${projectName}`
      const displayName = `Plan Discard (${projectName})`
      const pin = '135790'
      const originalTitle = 'Athletica (copy)'
      const dirtyName = 'Should Not Persist'

      await registerAccount(page, env.baseUrl, { code, username, displayName, pin })

      await page.goto(env.baseUrl)
      await expect(page.getByTestId('home-screen')).toBeVisible()
      await openLibraryTab(page)

      const athleticaLink = workoutCards(page).filter({ hasText: 'Athletica' })
      await expect(athleticaLink).toHaveCount(1)
      await athleticaLink.click()

      await expect(page.getByTestId('workout-detail-screen')).toBeVisible()
      await page.getByTestId('duplicate-button').click()
      await expect(page.getByTestId('home-screen')).toBeVisible()
      await openLibraryTab(page)
      const copyLink = workoutCards(page).filter({ hasText: originalTitle })
      await expect(copyLink).toHaveCount(1)
      await copyLink.click()

      await expect(page.getByTestId('workout-detail-screen')).toBeVisible()
      await expect(page.getByTestId('workout-title')).toHaveText(originalTitle)
      await page.getByTestId('edit-button').click()
      await expect(page.getByTestId('workout-editor-screen')).toBeVisible()

      // --- Pristine: back chevron leaves straight away, no discard dialog ---
      await page.getByTestId('back-button').click()
      await expect(page.getByTestId('editor-discard-dialog')).toHaveCount(0)
      await expect(page.getByTestId('workout-detail-screen')).toBeVisible()
      await expect(page.getByTestId('workout-title')).toHaveText(originalTitle)

      // --- Dirty: edit then back raises the discard confirm ---
      await page.getByTestId('edit-button').click()
      await expect(page.getByTestId('workout-editor-screen')).toBeVisible()
      await page.getByTestId('editor-name').fill(dirtyName)
      await page.getByTestId('back-button').click()
      await expect(page.getByTestId('editor-discard-dialog')).toBeVisible()

      // Keep editing cancels the dialog and stays on the editor with the edit.
      await page.getByTestId('editor-discard-cancel').click()
      await expect(page.getByTestId('editor-discard-dialog')).toHaveCount(0)
      await expect(page.getByTestId('workout-editor-screen')).toBeVisible()
      await expect(page.getByTestId('editor-name')).toHaveValue(dirtyName)

      // Discard confirms and returns to detail without persisting the rename.
      await page.getByTestId('back-button').click()
      await expect(page.getByTestId('editor-discard-dialog')).toBeVisible()
      await page.getByTestId('editor-discard-confirm').click()
      await expect(page.getByTestId('workout-detail-screen')).toBeVisible()
      await expect(page.getByTestId('workout-title')).toHaveText(originalTitle)

      // Survives reload — the dirty name never hit the server.
      await page.reload()
      await expect(page.getByTestId('workout-detail-screen')).toBeVisible()
      await expect(page.getByTestId('workout-title')).toHaveText(originalTitle)

      // Re-open edit: name is still the original, not the discarded dirty value.
      await page.getByTestId('edit-button').click()
      await expect(page.getByTestId('workout-editor-screen')).toBeVisible()
      await expect(page.getByTestId('editor-name')).toHaveValue(originalTitle)
    },
  )
})
