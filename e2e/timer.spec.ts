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
 * the passkey enrollment prompt). The catch-all (`router.tsx`) redirects
 * the post-registration landing (`/register?invite=…`) to Home at `/`
 * — so callers land on `home-screen` with no extra hop.
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

type OscillatorFactory = { createOscillator(): unknown }
type UnboundCreateOscillator = (this: OscillatorFactory) => unknown

/**
 * Init script: counts every `createOscillator()` call across `BaseAudioContext`
 * (where the method actually lives in Chromium/WebKit) and the `AudioContext` /
 * `webkitAudioContext` aliases (`player/audio.ts`'s own fallback) onto
 * `globalThis.__beepCount` — `player/audio.ts`'s `beep()` creates exactly one oscillator per
 * tone, so this is a faithful proxy for "a beep fired". Self-contained: Playwright serialises
 * this via `toString()` and re-evaluates it in the page, so no outer-scope reference survives.
 *
 * Only prototypes that own `createOscillator` are patched — `AudioContext.prototype` inherits
 * the method from `BaseAudioContext.prototype`, so a bare own-property descriptor read there
 * would be `undefined` and the patched replacement would throw on the Start tap.
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
    // Read via the property descriptor, not a bare `target.createOscillator`
    // member access, so nothing here is "an unbound method" — the plain
    // `function` below always forwards the real caller's `this` explicitly.
    // Skip prototypes that only inherit the method (e.g. `AudioContext.prototype`
    // under Chromium) so we don't shadow it with a broken original.
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

/**
 * The countdown, measured where it renders. The digits are sized as a share of
 * the arc's width, chosen by the character count, and the share is CSS: jsdom
 * resolves none of it, so this is the only seam that can say the digits
 * actually grew.
 *
 * Two things are asserted, and they pull against each other. The digits must
 * clear a floor, or the change did not happen — a Participant reads them from
 * several metres away, and the screen they replaced rendered them at about
 * 80px. They must also stay inside the arc's clear inner width, which is 90%
 * of the arc's own width: the arc's stroke takes 15 units of its 300-unit box
 * at each end.
 *
 * `floorPx` is the caller's, because the floor depends on which bucket is on
 * screen. A five-character countdown is deliberately smaller than a
 * two-character one.
 */
async function expectCountFillsTheArc(page: Page, floorPx: number): Promise<void> {
  const count = page.getByTestId('timer-count')
  const box = await count.boundingBox()
  const arc = await page.getByTestId('player-progress-arc').boundingBox()
  if (box === null || arc === null) {
    throw new Error('the countdown did not lay out')
  }
  const fontPx = await count.evaluate((el) => Number.parseFloat(getComputedStyle(el).fontSize))
  expect(fontPx).toBeGreaterThanOrEqual(floorPx)
  expect(box.width).toBeLessThanOrEqual(arc.width * 0.9)
}

/**
 * The phase label stays inside the arc, above the countdown. It is the first
 * thing the countdown pushes out when it grows: the label sits on top of the
 * countdown in the same column, so a countdown that took its whole height in
 * layout would carry the label past the arc's top. At the sizes the type scale
 * now reaches, that is a real failure and not a near miss.
 */
async function expectPhaseLabelStaysInsideTheArc(page: Page): Promise<void> {
  const label = await page.getByTestId('timer-phase').boundingBox()
  const count = await page.getByTestId('timer-count').boundingBox()
  const arc = await page.getByTestId('player-progress-arc').boundingBox()
  if (label === null || count === null || arc === null) {
    throw new Error('the phase label did not lay out')
  }
  expect(label.y).toBeGreaterThanOrEqual(arc.y)
  expect(label.y + label.height).toBeLessThanOrEqual(arc.y + arc.height)
  expect(label.y + label.height).toBeLessThanOrEqual(count.y)
}

/**
 * No glass surface overlaps the countdown.
 *
 * This is the condition two shortcuts in `progress-arc.tsx` depend on. The
 * digits' scene proxy repaints them flat white, and it measures their size and
 * their place once, when it registers. Both are correct only while nothing
 * refracts over the digits: a proxy that never repaints cannot show the wrong
 * colour, and it cannot show a stale size either.
 *
 * Measured, not assumed. On the manual timer the countdown sits lower on the
 * screen than it does on the live Session, so this screen is the closer of the
 * two, and the clearance here is the smaller number.
 *
 * Every `.glass-surface` is checked, not the dock alone. The dock is the one
 * the digits could reach, but the proxy repaints under any refracting surface,
 * so a new one placed over the digits must fail this as well.
 *
 * The region checked is the region the proxy registers: `readDigitsRegion`
 * takes the union of the digits' container and the countdown's own box,
 * because the countdown hangs below the container on a negative margin.
 *
 * A failure here is not a broken layout. It says the arc has grown into the
 * dock, and that both shortcuts must now be paid for: the proxy must paint the
 * digit colour rather than white, and it must measure again when the type
 * scale changes.
 */
async function expectNoGlassOverlapsTheCountdown(page: Page): Promise<void> {
  const overlaps = await page.evaluate(() => {
    const container = document.querySelector<HTMLElement>(
      '[data-testid="player-progress-arc-digits"]',
    )
    const digits = document.querySelector<HTMLElement>('[data-arc-digits]')
    if (container === null || digits === null) {
      throw new Error('the countdown did not lay out')
    }
    const host = container.getBoundingClientRect()
    const own = digits.getBoundingClientRect()
    const region = {
      left: Math.min(host.left, own.left),
      top: Math.min(host.top, own.top),
      right: Math.max(host.right, own.right),
      bottom: Math.max(host.bottom, own.bottom),
    }
    return [...document.querySelectorAll<HTMLElement>('.glass-surface')]
      .map((element) => {
        const box = element.getBoundingClientRect()
        const width = Math.min(region.right, box.right) - Math.max(region.left, box.left)
        const height = Math.min(region.bottom, box.bottom) - Math.max(region.top, box.top)
        return {
          surface: element.dataset.testid ?? 'unnamed glass surface',
          overlapPx: width > 0 && height > 0 ? Math.round(width * height) : 0,
        }
      })
      .filter((entry) => entry.overlapPx > 0)
  })
  expect(overlaps).toEqual([])
}

/**
 * The Progress arc is meant to span nearly the whole width of a phone, and
 * only a real browser can say whether it does: the size is CSS — an aspect
 * ratio, a viewport-width clamp and a pixel ceiling — and jsdom computes none
 * of it. Without this, an arc that silently rendered at 200px would still pass
 * every other assertion in the suite.
 *
 * Measured on a phone viewport rather than the project's desktop default,
 * because the pixel ceiling is what binds on a wide window, by design.
 *
 * The arc is also checked against its own box, so a wide box holding a small
 * arc cannot pass: the drawn path must fill the box it was given.
 *
 * The countdown and the phase label ride with it. They are sized and placed
 * off the arc, so the phone viewport this sets up is the one place they can be
 * measured, and a change to the arc that broke either of them belongs in the
 * same failure.
 */
async function expectArcAndItsContentFillThePhone(page: Page): Promise<void> {
  const before = page.viewportSize()
  const phone = { width: 390, height: 844 }
  await page.setViewportSize(phone)
  try {
    const arc = page.getByTestId('player-progress-arc')
    await expect(arc).toBeVisible()

    const box = await arc.boundingBox()
    const sweep = await page.getByTestId('player-progress-arc-sweep').boundingBox()
    if (box === null || sweep === null) {
      throw new Error('the progress arc did not lay out')
    }
    expect(box.width / phone.width).toBeGreaterThan(0.85)
    // Half as tall as it is wide: the box is the half circle's letterbox.
    expect(box.height).toBeCloseTo(box.width / 2, 0)
    // The drawn path fills the box it was given, so a wide box holding a
    // small arc cannot pass this.
    expect(sweep.width / box.width).toBeGreaterThan(0.9)

    // The count reads `5` here — the Get ready segment — so this is the
    // one- and two-character bucket, the size a Session shows for most of
    // its length. It is the whole point of the change, and only a browser
    // can say what it renders at.
    await expectCountFillsTheArc(page, 160)
    await expectPhaseLabelStaysInsideTheArc(page)
    // The largest bucket reaches lowest, so it is the one the dock is nearest.
    await expectNoGlassOverlapsTheCountdown(page)
  } finally {
    if (before !== null) {
      await page.setViewportSize(before)
    }
  }
}

type FakeWakeLockSentinel = {
  release(): Promise<void>
  addEventListener(type: string, listener: () => void): void
}

/**
 * Init script: replaces `navigator.wakeLock` with a fake that tracks acquisition onto
 * `globalThis.__wakeLockAcquired` (boolean) and release count onto
 * `globalThis.__wakeLockReleaseCount` — real desktop webkit/chromium wake-lock support is
 * inconsistent under Playwright, so this makes the assertion deterministic rather than relying
 * on the real API. Shape matches what `player/wake-lock.ts` calls:
 * `navigator.wakeLock.request('screen')` resolving to a sentinel with `release()` and
 * `addEventListener()`.
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
          // The app never relies on the sentinel's own spontaneous "release" event in this
          // flow (it only ever calls `.release()` itself), so this is a no-op.
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

/**
 * Exercises the `/timer` screen (`timer-screen.tsx`) against the real built
 * client + server `global-setup.ts` boots: nav reachability from Home via
 * `home-timer-link`, idle composition from the ui/ field kit, a full short run
 * to Done with pause/resume/reset on the immersive arc + dock, and Web Audio
 * + `navigator.wakeLock` instrumentation via init scripts. Each test registers
 * its own per-project account from `timer.spec.ts`'s own pre-minted invite pair
 * (`readE2eEnv().timerInvitesByProject`) so `fullyParallel` chromium+webkit
 * runs never share codes with other spec files.
 */
test.describe('timer (chromium + webkit)', () => {
  test(
    'e2e (chromium + webkit): /timer is reachable via home-timer-link from Home while ' +
      'logged in; idle composes work/rest/rounds from ui/ fields; with short inputs ' +
      '(5s work, 0s rest, 2 rounds) Start runs ready → work → work → Done with the round ' +
      'indicator advancing; Pause freezes the displayed count, Resume continues, Reset ' +
      'returns to the idle input state; and on a 390px phone the countdown clears its size ' +
      'floor, stays inside the arc, and is overlapped by no glass surface, in both the short ' +
      'and the five-character bucket.',
    async ({ page }, testInfo) => {
      test.setTimeout(75_000)

      const env = readE2eEnv()
      const projectName = projectNameFrom(testInfo)
      const [code] = env.timerInvitesByProject[projectName]
      const username = `e2e-timer-${projectName}`
      const displayName = `Timer Flow (${projectName})`
      const pin = '8642'

      await registerAndReachHome(page, env.baseUrl, { code, username, displayName, pin })

      await page.getByTestId('home-timer-link').click()
      await expect(page.getByTestId('timer-screen')).toBeVisible()

      // Idle: kit Field + Input composition (data-slot contract), not raw rows.
      const workInput = page.getByTestId('work-input')
      const restInput = page.getByTestId('rest-input')
      const roundsInput = page.getByTestId('rounds-input')
      await expect(workInput).toHaveAttribute('data-slot', 'input')
      await expect(restInput).toHaveAttribute('data-slot', 'input')
      await expect(roundsInput).toHaveAttribute('data-slot', 'input')
      await expect(workInput.locator('xpath=ancestor::*[@data-slot="field"]')).toHaveCount(1)

      await workInput.fill('5')
      await restInput.fill('0')
      await roundsInput.fill('2')

      await page.getByTestId('start-button').click()
      await expect(page.getByTestId('timer-phase')).toHaveText('Get ready')
      // Immersive kit mounts on start.
      await expect(page.getByTestId('player-phase-backdrop')).toBeVisible()
      await expect(page.getByTestId('player-progress-arc')).toBeVisible()
      await expect(page.getByTestId('player-control-dock')).toBeVisible()

      await expectArcAndItsContentFillThePhone(page)

      await expect(page.getByTestId('timer-phase')).toHaveText('Work', { timeout: 8000 })
      await expect(page.getByTestId('timer-context')).toHaveText('Round 1 of 2')

      // Rest is 0s, so work flows straight into the next round — phase stays
      // `Work`; the round indicator is the reliable transition signal.
      await expect(page.getByTestId('timer-context')).toHaveText('Round 2 of 2', { timeout: 8000 })

      await expect(page.getByTestId('timer-phase')).toHaveText('Done', { timeout: 8000 })
      // The player drops the leading zero minute: complete reads `0`, not `0:00`.
      await expect(page.getByTestId('timer-count')).toHaveText('0')
      await expect(page.getByTestId('timer-context')).toHaveText('Nice work')

      await page.getByTestId('reset-button').click()
      await expect(page.getByTestId('work-input')).toHaveValue('5')
      await expect(page.getByTestId('rest-input')).toHaveValue('0')
      await expect(page.getByTestId('rounds-input')).toHaveValue('2')
      await expect(page.getByTestId('start-button')).toBeVisible()
      await expect(page.getByTestId('pause-button')).toHaveCount(0)
      await expect(page.getByTestId('resume-button')).toHaveCount(0)

      // Second run — same retained settings — exercises Pause/Resume/Reset mid-run.
      await page.getByTestId('start-button').click()
      await expect(page.getByTestId('timer-phase')).toHaveText('Work', { timeout: 8000 })

      await page.getByTestId('pause-button').click()
      const frozenCount = await page.getByTestId('timer-count').textContent()
      await page.waitForTimeout(2000)
      await expect(page.getByTestId('timer-count')).toHaveText(frozenCount ?? '')

      await page.getByTestId('resume-button').click()
      await expect(page.getByTestId('pause-button')).toBeVisible()
      await expect(page.getByTestId('work-input')).toHaveCount(0)

      await page.getByTestId('reset-button').click()
      await expect(page.getByTestId('work-input')).toBeVisible()
      await expect(page.getByTestId('start-button')).toBeVisible()
      await expect(page.getByTestId('pause-button')).toHaveCount(0)
      await expect(page.getByTestId('resume-button')).toHaveCount(0)

      // Third run — a fifteen-minute work segment — reaches the
      // five-character bucket, the longest one the type scale names. A
      // `Segment`'s duration has no upper bound, so this is what a long
      // finisher renders as, and it has to stay inside the arc on the
      // narrowest phone. Fifteen minutes, not ten, so the count holds five
      // characters for minutes rather than for the one second `10:00` lasts.
      await page.getByTestId('work-input').fill('900')
      await page.getByTestId('rounds-input').fill('1')
      await page.setViewportSize({ width: 390, height: 844 })
      await page.getByTestId('start-button').click()
      await expect(page.getByTestId('timer-phase')).toHaveText('Work', { timeout: 10_000 })
      await expect(page.getByTestId('timer-count')).toHaveText(/^\d\d:\d\d$/)
      // Smaller than the two-character bucket above, by design, but still
      // well past the ~80px the screen rendered before this change.
      await expectCountFillsTheArc(page, 90)
      await expectPhaseLabelStaysInsideTheArc(page)
      await expectNoGlassOverlapsTheCountdown(page)
    },
  )

  test(
    'e2e: with Web Audio instrumented via init script, the Start tap itself unlocks audio ' +
      '(the player shows data-audio="on") and at least one beep fires on a segment transition; with ' +
      'navigator.wakeLock instrumented, the lock is acquired while running and released on pause and ' +
      'on Done.',
    async ({ page }, testInfo) => {
      test.setTimeout(45_000)

      // Must be installed before the first navigation so the patches are
      // active by the time `/timer` mounts (and createOscillator/wakeLock
      // are first touched). Harmless on register/login pages.
      await page.addInitScript(instrumentAudioBeeps)
      await page.addInitScript(instrumentWakeLock)

      const env = readE2eEnv()
      const projectName = projectNameFrom(testInfo)
      const [, code] = env.timerInvitesByProject[projectName]
      const username = `e2e-tmr2-${projectName}`
      const displayName = `Timer Audio (${projectName})`
      const pin = '7531'

      await registerAndReachHome(page, env.baseUrl, { code, username, displayName, pin })

      await page.getByTestId('home-timer-link').click()
      await expect(page.getByTestId('timer-screen')).toBeVisible()

      // One round is enough here — round-indicator advancing is covered by the other test.
      await page.getByTestId('work-input').fill('5')
      await page.getByTestId('rest-input').fill('0')
      await page.getByTestId('rounds-input').fill('1')

      expect(
        await page.evaluate(() => (globalThis as unknown as { __beepCount: number }).__beepCount),
      ).toBe(0)

      await page.getByTestId('start-button').click()

      // `unlockAudio()`'s `resume()` is async; the DOM attribute only updates
      // on React's next re-render, which the live countdown drives frequently.
      await expect(page.getByTestId('audio-indicator')).toHaveAttribute('data-audio', 'on', {
        timeout: 5000,
      })

      // Ready-segment beep fires on the Start tap itself (segment transition into `ready`).
      const beepsAfterStart = await page.evaluate(
        () => (globalThis as unknown as { __beepCount: number }).__beepCount,
      )
      expect(beepsAfterStart).toBeGreaterThanOrEqual(1)

      await expect
        .poll(async () =>
          page.evaluate(
            () => (globalThis as unknown as { __wakeLockAcquired: boolean }).__wakeLockAcquired,
          ),
        )
        .toBe(true)

      await expect(page.getByTestId('timer-phase')).toHaveText('Work', { timeout: 8000 })

      await page.getByTestId('pause-button').click()
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
              (globalThis as unknown as { __wakeLockReleaseCount: number }).__wakeLockReleaseCount,
          ),
        )
        .toBeGreaterThanOrEqual(1)

      await page.getByTestId('resume-button').click()
      await expect
        .poll(async () =>
          page.evaluate(
            () => (globalThis as unknown as { __wakeLockAcquired: boolean }).__wakeLockAcquired,
          ),
        )
        .toBe(true)

      await expect(page.getByTestId('timer-phase')).toHaveText('Done', { timeout: 8000 })
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
              (globalThis as unknown as { __wakeLockReleaseCount: number }).__wakeLockReleaseCount,
          ),
        )
        .toBeGreaterThanOrEqual(2)

      // Work-segment beep + Done chord create more oscillators beyond the ready beep.
      const beepsAtDone = await page.evaluate(
        () => (globalThis as unknown as { __beepCount: number }).__beepCount,
      )
      expect(beepsAtDone).toBeGreaterThan(beepsAfterStart)
    },
  )
})
