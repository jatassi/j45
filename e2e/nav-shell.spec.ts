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

const TAB_IDS = ['tab-home', 'tab-library', 'tab-generate', 'tab-history'] as const

type TabId = (typeof TAB_IDS)[number]

/** PIN-login as the shared owner; lands on home-screen at `/`. */
async function loginAsOwner(
  page: Page,
  baseUrl: string,
  owner: { readonly username: string; readonly pin: string },
): Promise<void> {
  await page.goto(baseUrl)
  await expect(page.getByTestId('login-screen')).toBeVisible()
  await page.locator('#login-username').fill(owner.username)
  await page.locator('#login-pin').fill(owner.pin)
  await expect(page.getByTestId('home-screen')).toBeVisible()
}

/** Asserts exactly `active` carries aria-current="page" and data-active="true". */
async function expectActiveTab(page: Page, active: TabId): Promise<void> {
  for (const id of TAB_IDS) {
    const tab = page.getByTestId(id)
    if (id === active) {
      await expect(tab).toHaveAttribute('aria-current', 'page')
      await expect(tab).toHaveAttribute('data-active', 'true')
    } else {
      await expect(tab).not.toHaveAttribute('aria-current')
      await expect(tab).not.toHaveAttribute('data-active')
    }
  }
}

/** Tab-layout chrome is present (all four tabs + avatar chip). */
async function expectTabLayout(page: Page): Promise<void> {
  for (const id of TAB_IDS) {
    await expect(page.getByTestId(id)).toBeVisible()
  }
  await expect(page.getByTestId('avatar-chip')).toBeVisible()
}

/** Push-layout chrome: no tab bar / avatar, back-button present. */
async function expectPushLayout(page: Page): Promise<void> {
  for (const id of TAB_IDS) {
    await expect(page.getByTestId(id)).toHaveCount(0)
  }
  await expect(page.getByTestId('avatar-chip')).toHaveCount(0)
  await expect(page.getByTestId('back-button')).toBeVisible()
}

/** Every `workout-card-<id>` Link currently rendered on the library list. */
function workoutCards(page: Page) {
  return page.locator('a[data-testid^="workout-card-"]')
}

/**
 * Reads the first library card's workout id from its `workout-card-<id>`
 * testid. Caller must already be on library-screen with at least one card.
 */
async function firstWorkoutId(page: Page): Promise<string> {
  const card = workoutCards(page).first()
  await expect(card).toBeVisible()
  const testId = await card.getAttribute('data-testid')
  if (testId === null || !testId.startsWith('workout-card-')) {
    throw new Error(`unexpected workout-card testid: ${testId}`)
  }
  return testId.slice('workout-card-'.length)
}

/**
 * Opens Apex from the library, starts a live session, returns the session id
 * from the URL. Same seed workout `live-session.spec.ts` uses — read-only
 * for the plan itself (start only).
 */
async function startApexSession(page: Page): Promise<string> {
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
 * Shell navigation end-to-end against the real built client + server
 * `global-setup.ts` boots. Authenticates as the shared owner (PIN) so this
 * file never touches pre-minted invite pools already consumed by sibling
 * specs. Does not create/duplicate/delete/rename the owner's workouts.
 */
test.describe('nav-shell (chromium + webkit)', () => {
  test('logged in: four tabs navigate with active aria/data attributes; avatar-chip opens /account', async ({
    page,
  }, testInfo) => {
    // Project is asserted so a misconfigured third project fails loudly.
    projectNameFrom(testInfo)
    const env = readE2eEnv()
    await loginAsOwner(page, env.baseUrl, env.owner)

    await expectTabLayout(page)
    await expectActiveTab(page, 'tab-home')
    expect(new URL(page.url()).pathname).toBe('/')

    await page.getByTestId('tab-library').click()
    await expect(page).toHaveURL(/\/library\/?$/)
    await expect(page.getByTestId('library-screen')).toBeVisible()
    await expectActiveTab(page, 'tab-library')

    await page.getByTestId('tab-generate').click()
    await expect(page).toHaveURL(/\/generate\/?$/)
    await expect(page.getByTestId('generate-screen')).toBeVisible()
    await expectActiveTab(page, 'tab-generate')

    await page.getByTestId('tab-history').click()
    await expect(page).toHaveURL(/\/history\/?$/)
    await expect(page.getByTestId('history-screen')).toBeVisible()
    await expectActiveTab(page, 'tab-history')

    await page.getByTestId('tab-home').click()
    await expect(page.getByTestId('home-screen')).toBeVisible()
    await expectActiveTab(page, 'tab-home')

    await page.getByTestId('avatar-chip').click()
    await expect(page).toHaveURL(/\/account\/?$/)
    await expect(page.getByTestId('account-screen')).toBeVisible()
    await expectPushLayout(page)
  })

  test('/library lists workouts; exercises segment + /exercises redirect; unmatched path → /', async ({
    page,
  }, testInfo) => {
    projectNameFrom(testInfo)
    const env = readE2eEnv()
    await loginAsOwner(page, env.baseUrl, env.owner)

    await page.getByTestId('tab-library').click()
    await expect(page.getByTestId('library-screen')).toBeVisible()
    await expect(page.getByTestId('workout-list')).toBeVisible()
    await expect(workoutCards(page).first()).toBeVisible()
    await expect(page.getByTestId('library-segment-workouts')).toHaveAttribute(
      'data-active',
      'true',
    )

    await page.getByTestId('library-segment-exercises').click()
    await expect(page).toHaveURL(/\/library\/exercises\/?$/)
    await expect(page.getByTestId('exercise-library-screen')).toBeVisible()
    await expect(page.getByTestId('library-segment-exercises')).toHaveAttribute(
      'data-active',
      'true',
    )
    await expectActiveTab(page, 'tab-library')

    await page.goto(`${env.baseUrl}/exercises`)
    await expect(page).toHaveURL(/\/library\/exercises\/?$/)
    await expect(page.getByTestId('exercise-library-screen')).toBeVisible()

    // Catch-all: any unmatched authenticated path redirects to home.
    await page.goto(`${env.baseUrl}/no-such-route`)
    await expect(page.getByTestId('home-screen')).toBeVisible()
    expect(new URL(page.url()).pathname).toBe('/')
  })

  test('push routes: no tab-bar + working back-button; workout detail keeps tab-library active', async ({
    page,
  }, testInfo) => {
    projectNameFrom(testInfo)
    const env = readE2eEnv()
    await loginAsOwner(page, env.baseUrl, env.owner)

    await page.getByTestId('tab-library').click()
    await expect(page.getByTestId('library-screen')).toBeVisible()
    const workoutId = await firstWorkoutId(page)

    // Detail stays in the tab layout with Library active.
    await workoutCards(page).first().click()
    await expect(page.getByTestId('workout-detail-screen')).toBeVisible()
    await expect(page).toHaveURL(new RegExp(`/workouts/${workoutId}`))
    await expectTabLayout(page)
    await expectActiveTab(page, 'tab-library')

    // Edit (push): back returns to detail.
    await page.getByTestId('edit-button').click()
    await expect(page).toHaveURL(new RegExp(`/workouts/${workoutId}/edit`))
    await expect(page.getByTestId('workout-editor-screen')).toBeVisible()
    await expectPushLayout(page)
    await page.getByTestId('back-button').click()
    await expect(page.getByTestId('workout-detail-screen')).toBeVisible()

    // Reflow (push): back returns to detail. Do not submit reflow/start.
    await page.getByTestId('start-with-reflow-button').click()
    await expect(page).toHaveURL(new RegExp(`/workouts/${workoutId}/reflow`))
    await expect(page.getByTestId('reflow-editor-screen')).toBeVisible()
    await expectPushLayout(page)
    await page.getByTestId('back-button').click()
    await expect(page.getByTestId('workout-detail-screen')).toBeVisible()

    // /workouts/new (push): render only — do not submit create.
    await page.goto(`${env.baseUrl}/library`)
    await expect(page.getByTestId('library-screen')).toBeVisible()
    await page.getByTestId('new-workout-button').click()
    await expect(page).toHaveURL(/\/workouts\/new\/?$/)
    await expect(page.getByTestId('workout-editor-screen')).toBeVisible()
    await expectPushLayout(page)
    await page.getByTestId('back-button').click()
    await expect(page.getByTestId('library-screen')).toBeVisible()

    // /timer (push) via home quick action.
    await page.getByTestId('tab-home').click()
    await expect(page.getByTestId('home-screen')).toBeVisible()
    await page.getByTestId('home-timer-link').click()
    await expect(page).toHaveURL(/\/timer\/?$/)
    await expect(page.getByTestId('timer-screen')).toBeVisible()
    await expectPushLayout(page)
    await page.getByTestId('back-button').click()
    await expect(page.getByTestId('home-screen')).toBeVisible()

    // /account (push) via avatar chip.
    await page.getByTestId('avatar-chip').click()
    await expect(page.getByTestId('account-screen')).toBeVisible()
    await expectPushLayout(page)
    await page.getByTestId('back-button').click()
    await expect(page.getByTestId('home-screen')).toBeVisible()

    // /session/<id> (headerless) after starting a live session from a seed
    // workout. The immersive player owns the whole viewport — no tab bar and
    // no push header/back-button — so browser back returns to detail.
    await page.getByTestId('tab-library').click()
    await expect(page.getByTestId('library-screen')).toBeVisible()
    const sessionId = await startApexSession(page)
    await expect(page).toHaveURL(new RegExp(`/session/${sessionId}`))
    await expect(page.getByTestId('session-screen')).toBeVisible()
    for (const id of TAB_IDS) {
      await expect(page.getByTestId(id)).toHaveCount(0)
    }
    await expect(page.getByTestId('back-button')).toHaveCount(0)
    await page.goBack()
    await expect(page.getByTestId('workout-detail-screen')).toBeVisible()
  })

  test('home has hero + quick-start tiles when live; glass tiers on chrome', async ({
    page,
  }, testInfo) => {
    projectNameFrom(testInfo)
    const env = readE2eEnv()
    await loginAsOwner(page, env.baseUrl, env.owner)

    await expect(page.getByTestId('home-screen')).toBeVisible()
    await expect(page.getByTestId('home-hero')).toBeVisible()
    await expect(page.getByTestId('home-timer-link')).toBeVisible()
    await expect(page.getByTestId('home-timer-link')).toHaveAttribute('href', '/timer')
    await expect(page.getByTestId('home-generate-link')).toBeVisible()
    await expect(page.getByTestId('home-generate-link')).toHaveAttribute('href', '/generate')
    await expect(page.getByTestId('home-new-workout-link')).toBeVisible()
    await expect(page.getByTestId('home-new-workout-link')).toHaveAttribute('href', '/workouts/new')

    // Glass chrome on tab bar + app header (data-glass-tier present).
    const tabGlass = page.locator('.glass-surface').filter({ has: page.getByTestId('tab-home') })
    await expect(tabGlass).toHaveCount(1)
    await expect(tabGlass).toHaveAttribute('data-glass-tier', /^(css|refract)$/)

    const headerGlass = page
      .locator('.glass-surface')
      .filter({ has: page.getByTestId('avatar-chip') })
    await expect(headerGlass).toHaveCount(1)
    await expect(headerGlass).toHaveAttribute('data-glass-tier', /^(css|refract)$/)

    // Start a live session so the home hero has a live pick to show.
    await page.getByTestId('tab-library').click()
    await expect(page.getByTestId('library-screen')).toBeVisible()
    const sessionId = await startApexSession(page)

    await page.goto(env.baseUrl)
    await expect(page.getByTestId('home-screen')).toBeVisible()
    // ListActiveSessions poll is 5s — allow a couple of ticks.
    await expect(page.getByTestId('home-hero')).toBeVisible({ timeout: 15_000 })
    await expect(page.getByTestId(`session-card-${sessionId}`)).toBeVisible({ timeout: 15_000 })

    // Re-enter and leave so we do not leave a server-wide live session for
    // sibling specs (ListActiveSessions is not scoped; idle GC is 60s).
    await page.getByTestId(`session-card-${sessionId}`).click()
    await expect(page.getByTestId('session-screen')).toBeVisible()
    await page.getByTestId('session-leave').evaluate((node: HTMLElement) => {
      node.click()
    })
    // player-screens put a confirm dialog in front of LeaveSession.
    await expect(page.getByTestId('session-leave-dialog')).toBeVisible()
    await page.getByTestId('session-leave-confirm').click()
    await expect(page.getByTestId('home-screen')).toBeVisible()
  })
})
