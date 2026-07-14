/// <reference lib="dom" />
import type { Page } from '@playwright/test'
import { expect, test } from '@playwright/test'

import { readE2eEnv } from './support/state.js'

/**
 * Registers a brand-new account through the real `/register` form (skipping
 * the passkey enrollment prompt). Lands on `home-screen`.
 */
async function registerAndReachLibrary(
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
 * `auth-admin.spec.ts` — no shared invite pool needed.
 */
async function mintTwoInviteCodes(
  page: Page,
  baseUrl: string,
  owner: { readonly username: string; readonly pin: string },
): Promise<readonly [string, string]> {
  await page.goto(baseUrl)
  await page.locator('#login-username').fill(owner.username)
  await page.locator('#login-pin').fill(owner.pin)
  await expect(page.getByTestId('home-screen')).toBeVisible()
  await page.goto(`${baseUrl}/account`)
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

/** Opens Apex from the Library tab, starts a session, returns the session id from the URL. */
async function startApexSession(page: Page): Promise<string> {
  // Post-login landing is Home; seed workout cards live under the Library tab.
  await page.getByTestId('tab-library').click()
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
 * Mid-workout Leave: open the confirm alert-dialog, then confirm. Finish
 * (done state) calls leave directly and must not use this path.
 */
async function leaveSessionWithConfirm(page: Page): Promise<void> {
  await clickSessionControl(page, 'session-leave')
  await expect(page.getByTestId('session-leave-dialog')).toBeVisible()
  await expect(page.getByTestId('session-leave-confirm')).toBeVisible()
  await page.getByTestId('session-leave-confirm').click()
}

/** Bounded Skip loop until `session-phase` reads `Done` (Apex ≤ 16 segments). */
async function skipSessionToDone(page: Page): Promise<void> {
  for (let i = 0; i < 20; i++) {
    const phaseBefore = await page.getByTestId('session-phase').textContent()
    if (phaseBefore === 'Done') {
      return
    }
    // Apex alternates Work↔Rest (or →Done); phase is a reliable advance signal.
    await clickSessionControl(page, 'session-skip')
    await expect
      .poll(async () => {
        const phase = await page.getByTestId('session-phase').textContent()
        return phase === 'Done' || phase !== phaseBefore
      })
      .toBe(true)
  }
  await expect(page.getByTestId('session-phase')).toHaveText('Done')
}

/** Via History tab (not `page.goto`), assert an Apex row for this participant. */
async function assertApexOnHistory(page: Page): Promise<void> {
  await page.getByTestId('tab-history').click()
  await expect(page).toHaveURL(/\/history/)
  await expect(page.getByTestId('history-screen')).toBeVisible()
  await expect(page.getByTestId('history-list')).toBeVisible()
  await expect(
    page.locator('[data-testid^="history-row-"]').filter({ hasText: 'Apex' }),
  ).toBeVisible()
}

/** Assert both pages share the same `data-phase` attribute and `session-phase` label. */
async function assertBothPhase(
  pages: readonly [Page, Page],
  phase: { readonly data: string; readonly label: string },
): Promise<void> {
  for (const p of pages) {
    await expect(p.getByTestId('session-screen')).toHaveAttribute('data-phase', phase.data)
    await expect(p.getByTestId('session-phase')).toHaveText(phase.label)
  }
}

/** Assert B's phase text + data-phase match whatever A currently shows. */
async function assertBMatchesAPhase(pageA: Page, pageB: Page): Promise<void> {
  const phase = await pageA.getByTestId('session-phase').textContent()
  const dataPhase = await pageA.getByTestId('session-screen').getAttribute('data-phase')
  await expect(pageB.getByTestId('session-phase')).toHaveText(phase ?? '')
  await expect(pageB.getByTestId('session-screen')).toHaveAttribute('data-phase', dataPhase ?? '')
}

async function assertBothNextUp(pageA: Page, pageB: Page, text: string): Promise<void> {
  await expect(pageA.getByTestId('session-next-up')).toContainText(text)
  await expect(pageB.getByTestId('session-next-up')).toContainText(text)
}

function readBeepCount(page: Page): Promise<number> {
  return page.evaluate(() => (globalThis as unknown as { __beepCount: number }).__beepCount)
}

function readWakeLockAcquired(page: Page): Promise<boolean> {
  return page.evaluate(
    () => (globalThis as unknown as { __wakeLockAcquired: boolean }).__wakeLockAcquired,
  )
}

function readWakeLockReleaseCount(page: Page): Promise<number> {
  return page.evaluate(
    () => (globalThis as unknown as { __wakeLockReleaseCount: number }).__wakeLockReleaseCount,
  )
}

type OscillatorFactory = { createOscillator(): unknown }
type UnboundCreateOscillator = (this: OscillatorFactory) => unknown

/**
 * Init script: counts every `createOscillator()` call across `BaseAudioContext`
 * and the `AudioContext` / `webkitAudioContext` aliases onto
 * `globalThis.__beepCount`.
 */
function instrumentAudioBeeps(): void {
  const store = globalThis as unknown as { __beepCount: number }
  store.__beepCount = 0
  const scope = globalThis as unknown as {
    BaseAudioContext?: { prototype: OscillatorFactory }
    AudioContext?: { prototype: OscillatorFactory }
    webkitAudioContext?: { prototype: OscillatorFactory }
  }
  const targets = [
    scope.BaseAudioContext?.prototype,
    scope.AudioContext?.prototype,
    scope.webkitAudioContext?.prototype,
  ].filter((target): target is OscillatorFactory => target !== undefined)
  const seen = new Set<OscillatorFactory>()
  for (const target of targets) {
    if (seen.has(target)) {
      continue
    }
    seen.add(target)
    const original = Object.getOwnPropertyDescriptor(target, 'createOscillator')?.value as
      UnboundCreateOscillator | undefined
    if (original === undefined) {
      continue
    }
    target.createOscillator = function patchedCreateOscillator(this: OscillatorFactory): unknown {
      store.__beepCount += 1
      return original.call(this)
    }
  }
}

type FakeWakeLockSentinel = {
  release(): Promise<void>
  addEventListener(type: string, listener: () => void): void
}

/**
 * Init script: replaces `navigator.wakeLock` with a fake tracking
 * `globalThis.__wakeLockAcquired` and `globalThis.__wakeLockReleaseCount`.
 */
function instrumentWakeLock(): void {
  const store = globalThis as unknown as {
    __wakeLockAcquired: boolean
    __wakeLockReleaseCount: number
  }
  store.__wakeLockAcquired = false
  store.__wakeLockReleaseCount = 0

  const fakeWakeLock = {
    request: (_type: string): Promise<FakeWakeLockSentinel> => {
      store.__wakeLockAcquired = true
      const sentinel: FakeWakeLockSentinel = {
        release: (): Promise<void> => {
          store.__wakeLockAcquired = false
          store.__wakeLockReleaseCount += 1
          return Promise.resolve()
        },
        addEventListener: (): void => {
          // no-op — app only calls `.release()` itself
        },
      }
      return Promise.resolve(sentinel)
    },
  }

  Object.defineProperty(navigator, 'wakeLock', {
    value: fakeWakeLock,
    configurable: true,
  })
}

/** Distinctive substrings of Apex's first two work stations (seed has no `detail`). */
const APEX_STATION_1 = 'Dumbbell sprawl'
const APEX_STATION_2 = 'Sandbag/dumbbell clean'

test.describe('live session (chromium only — two logged-in browser contexts)', () => {
  test(
    'A starts Apex; B joins the same segment; phase/data-phase/next-up/demo sync; B pause ' +
      'shows Paused on A; A leaves via confirm (B keeps running); B finishes; both see history',
    async ({ page, browser, browserName }) => {
      test.skip(
        browserName !== 'chromium',
        'live-session e2e is chromium-only (two logged-in browser contexts; not webkit).',
      )
      test.setTimeout(120_000)

      const env = readE2eEnv()
      const [codeA, codeB] = await mintTwoInviteCodes(page, env.baseUrl, env.owner)

      const displayA = 'Live Host A'
      const displayB = 'Live Guest B'
      await registerAndReachLibrary(page, env.baseUrl, {
        code: codeA,
        username: 'e2e-ls1-a',
        displayName: displayA,
        pin: '8642',
      })

      const contextB = await browser.newContext()
      const pageB = await contextB.newPage()
      try {
        await registerAndReachLibrary(pageB, env.baseUrl, {
          code: codeB,
          username: 'e2e-ls1-b',
          displayName: displayB,
          pin: '8642',
        })
        await expect(pageB.getByTestId('home-screen')).toBeVisible()

        const sessionId = await startApexSession(page)
        await expect(page).toHaveURL(new RegExp(`/session/${sessionId}`))

        // Ready is only 5s — assert it on A before B's join race burns the window.
        await expect(page.getByTestId('session-screen')).toHaveAttribute('data-phase', 'ready')
        await expect(
          page.getByTestId('player-progress-ring').getByTestId('session-count'),
        ).toBeVisible()
        await expect(page.getByTestId('session-next-up')).toContainText(APEX_STATION_1)

        const card = pageB.getByTestId(`session-card-${sessionId}`)
        await expect(card).toBeVisible({ timeout: 10_000 })
        await expect(card).toContainText(displayA)
        await expect(card).toContainText('Apex')

        await card.click()
        await expect(pageB).toHaveURL(new RegExp(`/session/${sessionId}`))
        await expect(pageB.getByTestId('session-screen')).toBeVisible()

        // Land both players on the first work segment. Ready is only 5s and B's
        // join burns variable wall-clock, so rather than snapshot A mid ready→work
        // transition (or race a skip against the server's authoritative phase),
        // ride A's natural ready→work auto-advance first — 15s comfortably clears
        // the 5s ready window — then compare the two screens on a stable phase.
        await expect(page.getByTestId('session-phase')).toHaveText('Work', { timeout: 15_000 })

        // Both players now share the stable work segment.
        await assertBMatchesAPhase(page, pageB)
        await expect(
          pageB.getByTestId('player-progress-ring').getByTestId('session-count'),
        ).toBeVisible()

        await assertBothPhase([page, pageB], { data: 'work', label: 'Work' })

        // Next-up names following work; demo chip non-broken (Apex stations have no `detail`).
        await assertBothNextUp(page, pageB, APEX_STATION_2)
        const demo = page.locator('[data-slot="exercise-demo"]')
        await expect(demo).toBeVisible()
        await expect(demo).toContainText('Form guide coming soon')

        // B's pause freezes both screens on 'Paused' while data-phase stays work.
        await clickSessionControl(pageB, 'session-pause')
        await expect(pageB.getByTestId('session-resume')).toBeVisible()
        await expect(page.getByTestId('session-resume')).toBeVisible()
        await expect(page.getByTestId('session-phase')).toHaveText('Paused')
        await expect(pageB.getByTestId('session-phase')).toHaveText('Paused')
        await expect(page.getByTestId('session-screen')).toHaveAttribute('data-phase', 'work')

        // Skip from paused re-enters the next segment running (rest after work).
        await clickSessionControl(page, 'session-skip')
        await assertBothPhase([page, pageB], { data: 'rest', label: 'Rest' })
        // Rest still names the following work station in next-up; both screens stay in sync.
        await assertBothNextUp(page, pageB, APEX_STATION_2)
        const contextOnRest = await page.getByTestId('session-context').textContent()
        await expect(pageB.getByTestId('session-context')).toHaveText(contextOnRest ?? '')

        // A leaves mid-workout via confirm dialog — only A navigates home; B keeps running.
        await leaveSessionWithConfirm(page)
        await expect(page.getByTestId('home-screen')).toBeVisible()
        await expect(pageB.getByTestId('session-screen')).toBeVisible()
        await expect(pageB.getByTestId('session-phase')).toBeVisible()
        await expect(pageB.getByTestId('session-participants')).not.toContainText(displayA)

        // Last leave ends the session: B skips to Done; Finish leaves with no confirm.
        await skipSessionToDone(pageB)
        await expect(pageB.getByTestId('session-finish')).toBeVisible()
        await expect(pageB.getByTestId('session-leave-confirm')).toHaveCount(0)
        await clickSessionControl(pageB, 'session-finish')
        await expect(pageB.getByTestId('session-leave-confirm')).toHaveCount(0)
        await expect(pageB.getByTestId('home-screen')).toBeVisible()

        // Home poll (5s) must drop the ended session card for an observer (A).
        await expect(page.getByTestId(`session-card-${sessionId}`)).not.toBeVisible({
          timeout: 10_000,
        })

        // Both participants' History tab shows the session recorded.
        await assertApexOnHistory(page)
        await assertApexOnHistory(pageB)
      } finally {
        await contextB.close()
      }
    },
  )

  test(
    'with Web Audio + wakeLock instrumented on both contexts, join/start unlocks audio on both ' +
      'tabs, Skip beeps beyond the mount beep, and wake lock tracks running/paused/resume',
    async ({ page, browser, browserName }) => {
      test.skip(
        browserName !== 'chromium',
        'live-session e2e is chromium-only (two logged-in browser contexts; not webkit).',
      )
      test.setTimeout(60_000)

      // Must be installed before the first navigation so patches are active
      // by the time SessionScreen mounts.
      await page.addInitScript(instrumentAudioBeeps)
      await page.addInitScript(instrumentWakeLock)

      const env = readE2eEnv()
      const [codeA, codeB] = await mintTwoInviteCodes(page, env.baseUrl, env.owner)

      await registerAndReachLibrary(page, env.baseUrl, {
        code: codeA,
        username: 'e2e-ls2-a',
        displayName: 'Live Audio A',
        pin: '7531',
      })

      const contextB = await browser.newContext()
      const pageB = await contextB.newPage()
      try {
        await pageB.addInitScript(instrumentAudioBeeps)
        await pageB.addInitScript(instrumentWakeLock)

        await registerAndReachLibrary(pageB, env.baseUrl, {
          code: codeB,
          username: 'e2e-ls2-b',
          displayName: 'Live Audio B',
          pin: '7531',
        })

        const sessionId = await startApexSession(page)

        await expect(page.getByTestId('session-audio-indicator')).toHaveAttribute(
          'data-audio',
          'on',
          { timeout: 5000 },
        )
        expect(await readBeepCount(page)).toBeGreaterThanOrEqual(1)
        await expect.poll(async () => readWakeLockAcquired(page)).toBe(true)

        const card = pageB.getByTestId(`session-card-${sessionId}`)
        await expect(card).toBeVisible({ timeout: 10_000 })
        await card.click()
        await expect(pageB.getByTestId('session-screen')).toBeVisible()

        await expect(pageB.getByTestId('session-audio-indicator')).toHaveAttribute(
          'data-audio',
          'on',
          { timeout: 5000 },
        )

        const beepsBeforeSkip = await readBeepCount(page)
        await page.getByTestId('session-skip').click()
        await expect.poll(async () => readBeepCount(page)).toBeGreaterThan(beepsBeforeSkip)

        await page.getByTestId('session-pause').click()
        await expect.poll(async () => readWakeLockAcquired(page)).toBe(false)
        await expect.poll(async () => readWakeLockReleaseCount(page)).toBeGreaterThanOrEqual(1)

        await page.getByTestId('session-resume').click()
        await expect.poll(async () => readWakeLockAcquired(page)).toBe(true)
      } finally {
        await contextB.close()
      }
    },
  )
})
