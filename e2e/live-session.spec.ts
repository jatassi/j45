/// <reference lib="dom" />
import type { Page } from '@playwright/test'
import { expect, test } from '@playwright/test'

import { readE2eEnv } from './support/state.js'

/**
 * Registers a brand-new account through the real `/register` form (skipping
 * the passkey enrollment prompt). Lands on `library-screen`.
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

  await expect(page.getByTestId('library-screen')).toBeVisible()
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
  await page.getByRole('button', { name: 'Sign in with PIN' }).click()
  await expect(page.getByTestId('library-screen')).toBeVisible()
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

/** Opens Apex, starts a session, returns the session id from the URL. */
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
 * Click via the DOM node directly. Playwright's pointer click waits for
 * "stable" layout, but the live countdown re-renders RunControls every tick
 * so a normal/force click can hang or land on a detached node.
 */
async function clickSessionControl(page: Page, testId: string): Promise<void> {
  await page.getByTestId(testId).evaluate((node: HTMLElement) => {
    node.click()
  })
}

/** Bounded Skip loop until `session-phase` reads `Done` (Apex ≤ 16 segments). */
async function skipSessionToDone(page: Page): Promise<void> {
  for (let i = 0; i < 20; i++) {
    const phaseBefore = await page.getByTestId('session-phase').textContent()
    if (phaseBefore === 'Done') {
      return
    }
    // Apex always alternates Work↔Rest (or →Done), so phase is a reliable
    // advance signal — rest and the following work can share the same context line.
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

test.describe('live session (chromium only — two logged-in browser contexts)', () => {
  test(
    'A starts Apex; B joins the same segment; B pause and A skip sync; A leaves mid-workout ' +
      '(B keeps running without A); B finishes and the session card clears on home',
    async ({ page, browser, browserName }) => {
      test.skip(
        browserName !== 'chromium',
        'live-session e2e is chromium-only (two logged-in browser contexts; not webkit).',
      )
      test.setTimeout(90_000)

      const env = readE2eEnv()
      const [codeA, codeB] = await mintTwoInviteCodes(page, env.baseUrl, env.owner)

      const displayA = 'Live Host A'
      await registerAndReachLibrary(page, env.baseUrl, {
        code: codeA,
        username: 'e2e-ls1-a',
        displayName: displayA,
        pin: '864201',
      })

      const contextB = await browser.newContext()
      const pageB = await contextB.newPage()
      try {
        await registerAndReachLibrary(pageB, env.baseUrl, {
          code: codeB,
          username: 'e2e-ls1-b',
          displayName: 'Live Guest B',
          pin: '864202',
        })
        await expect(pageB.getByTestId('library-screen')).toBeVisible()

        const sessionId = await startApexSession(page)
        await expect(page).toHaveURL(new RegExp(`/session/${sessionId}`))

        const card = pageB.getByTestId(`session-card-${sessionId}`)
        await expect(card).toBeVisible({ timeout: 10_000 })
        await expect(card).toContainText(displayA)
        await expect(card).toContainText('Apex')

        await card.click()
        await expect(pageB).toHaveURL(new RegExp(`/session/${sessionId}`))
        await expect(pageB.getByTestId('session-screen')).toBeVisible()

        const phaseA = await page.getByTestId('session-phase').textContent()
        await expect(pageB.getByTestId('session-phase')).toHaveText(phaseA ?? '')

        await pageB.getByTestId('session-pause').click()
        await expect(pageB.getByTestId('session-resume')).toBeVisible()
        await expect(page.getByTestId('session-resume')).toBeVisible()

        const contextBefore = await page.getByTestId('session-context').textContent()
        await page.getByTestId('session-skip').click()
        await expect(page.getByTestId('session-context')).not.toHaveText(contextBefore ?? '')
        const contextAfter = await page.getByTestId('session-context').textContent()
        await expect(pageB.getByTestId('session-context')).toHaveText(contextAfter ?? '')

        // A leaves mid-workout — only A navigates home; B's player keeps running.
        await clickSessionControl(page, 'session-leave')
        await expect(page.getByTestId('library-screen')).toBeVisible()

        await expect(pageB.getByTestId('session-screen')).toBeVisible()
        await expect(pageB.getByTestId('session-phase')).toBeVisible()
        await expect(pageB.getByTestId('session-participants')).not.toContainText(displayA)

        // Last leave ends the session: B skips to Done and finishes.
        await skipSessionToDone(pageB)
        await expect(pageB.getByTestId('session-finish')).toBeVisible()
        await clickSessionControl(pageB, 'session-finish')
        await expect(pageB.getByTestId('library-screen')).toBeVisible()

        // Home poll (5s) must drop the ended session card for an observer (A).
        await expect(page.getByTestId(`session-card-${sessionId}`)).not.toBeVisible({
          timeout: 10_000,
        })
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
        pin: '753191',
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
          pin: '753192',
        })

        const sessionId = await startApexSession(page)

        await expect(page.getByTestId('session-audio-indicator')).toHaveAttribute(
          'data-audio',
          'on',
          { timeout: 5000 },
        )
        expect(
          await page.evaluate(() => (globalThis as unknown as { __beepCount: number }).__beepCount),
        ).toBeGreaterThanOrEqual(1)

        await expect
          .poll(async () =>
            page.evaluate(
              () => (globalThis as unknown as { __wakeLockAcquired: boolean }).__wakeLockAcquired,
            ),
          )
          .toBe(true)

        const card = pageB.getByTestId(`session-card-${sessionId}`)
        await expect(card).toBeVisible({ timeout: 10_000 })
        await card.click()
        await expect(pageB.getByTestId('session-screen')).toBeVisible()

        await expect(pageB.getByTestId('session-audio-indicator')).toHaveAttribute(
          'data-audio',
          'on',
          { timeout: 5000 },
        )

        const beepsBeforeSkip = await page.evaluate(
          () => (globalThis as unknown as { __beepCount: number }).__beepCount,
        )
        await page.getByTestId('session-skip').click()
        await expect
          .poll(async () =>
            page.evaluate(() => (globalThis as unknown as { __beepCount: number }).__beepCount),
          )
          .toBeGreaterThan(beepsBeforeSkip)

        await page.getByTestId('session-pause').click()
        await expect
          .poll(async () =>
            page.evaluate(
              () => (globalThis as unknown as { __wakeLockAcquired: boolean }).__wakeLockAcquired,
            ),
          )
          .toBe(false)
        await expect
          .poll(async () =>
            page.evaluate(
              () =>
                (globalThis as unknown as { __wakeLockReleaseCount: number })
                  .__wakeLockReleaseCount,
            ),
          )
          .toBeGreaterThanOrEqual(1)

        await page.getByTestId('session-resume').click()
        await expect
          .poll(async () =>
            page.evaluate(
              () => (globalThis as unknown as { __wakeLockAcquired: boolean }).__wakeLockAcquired,
            ),
          )
          .toBe(true)
      } finally {
        await contextB.close()
      }
    },
  )
})
