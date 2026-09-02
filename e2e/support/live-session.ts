/// <reference lib="dom" />
import type { Page } from '@playwright/test'
import { expect } from '@playwright/test'

/**
 * The harness the live-session end-to-end scenarios run on: two logged-in
 * browser contexts against the real stack. It lives here, with the other e2e
 * support modules, so that all of those scenarios use one copy of it.
 */

/**
 * Registers a brand-new account through the real `/register` form (skipping
 * the passkey enrollment prompt). Lands on `home-screen`.
 */
export async function registerAndReachLibrary(
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
export async function mintTwoInviteCodes(
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
export async function startApexSession(page: Page): Promise<string> {
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
 * Waits for `sessionId` to reach this Participant's lobby, then takes them
 * into it.
 *
 * The wait is the lobby assertion: the row reaches a second account's home on
 * its own, with no navigation. The entry is then by url rather than by a tap
 * on that row, and the reason is the hero slot. Home gives the newest live
 * session that slot, and React reuses the one link element for it: when a
 * newer session takes the slot, the link keeps its dom node and is rewritten
 * in place, `data-testid` and destination together. Live sessions are
 * server-wide, so another scenario starting one is enough to rewrite it
 * between the moment a tap resolves the row and the moment the router reads
 * the destination — and the tap then opens that other session.
 *
 * The tap itself is covered where the lobby is the subject, in `home.spec.ts`.
 * Here the join is setup, and these scenarios are about what two screens agree
 * on once both are inside the same session.
 */
export async function joinSessionFromLobby(
  page: Page,
  baseUrl: string,
  sessionId: string,
): Promise<void> {
  await expect(page.getByTestId(`session-card-${sessionId}`)).toBeVisible({ timeout: 10_000 })
  await page.goto(`${baseUrl}/session/${sessionId}`)
  await expect(page.getByTestId('session-screen')).toBeVisible()
}

/**
 * Click via the DOM node directly. Playwright's pointer click waits for
 * "stable" layout, but the live countdown re-renders RunControls every tick
 * so a normal/force click can hang or land on a detached node.
 */
export async function clickSessionControl(page: Page, testId: string): Promise<void> {
  await page.getByTestId(testId).evaluate((node: HTMLElement) => {
    node.click()
  })
}

/**
 * Mid-workout Leave: open the confirm alert-dialog, then confirm. Finish
 * (done state) calls leave directly and must not use this path.
 */
export async function leaveSessionWithConfirm(page: Page): Promise<void> {
  await clickSessionControl(page, 'session-leave')
  await expect(page.getByTestId('session-leave-dialog')).toBeVisible()
  await expect(page.getByTestId('session-leave-confirm')).toBeVisible()
  await page.getByTestId('session-leave-confirm').click()
}

/** Bounded Skip loop until `session-phase` reads `Done` (Apex ≤ 16 segments). */
export async function skipSessionToDone(page: Page): Promise<void> {
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
export async function assertApexOnHistory(page: Page): Promise<void> {
  await page.getByTestId('tab-history').click()
  await expect(page).toHaveURL(/\/history/)
  await expect(page.getByTestId('history-screen')).toBeVisible()
  await expect(page.getByTestId('history-list')).toBeVisible()
  await expect(
    page.locator('[data-testid^="history-row-"]').filter({ hasText: 'Apex' }),
  ).toBeVisible()
}

/** Assert both pages share the same `data-phase` attribute and `session-phase` label. */
export async function assertBothPhase(
  pages: readonly [Page, Page],
  phase: { readonly data: string; readonly label: string },
): Promise<void> {
  for (const p of pages) {
    await expect(p.getByTestId('session-screen')).toHaveAttribute('data-phase', phase.data)
    await expect(p.getByTestId('session-phase')).toHaveText(phase.label)
  }
}

/** Assert B's phase text + data-phase match whatever A currently shows. */
export async function assertBMatchesAPhase(pageA: Page, pageB: Page): Promise<void> {
  const phase = await pageA.getByTestId('session-phase').textContent()
  const dataPhase = await pageA.getByTestId('session-screen').getAttribute('data-phase')
  await expect(pageB.getByTestId('session-phase')).toHaveText(phase ?? '')
  await expect(pageB.getByTestId('session-screen')).toHaveAttribute('data-phase', dataPhase ?? '')
}

/**
 * Every mark of the Progress strip, in document order, as its `done` /
 * `active` / `upcoming` state — the bars, their cells and the round dots.
 *
 * This is what the strip shows a participant, and it replaces the context
 * line as the value two phones are compared on. The line said pod, round and
 * station in words; the strip says the same three in marks, so the comparison
 * still proves the two screens agree on the session's position.
 */
export function readStripStates(page: Page): Promise<readonly string[]> {
  return page
    .locator('[data-testid="session-progress"] [data-state]')
    .evaluateAll((nodes) => nodes.map((node) => (node as HTMLElement).dataset.state ?? ''))
}

export async function assertBothNextUp(pageA: Page, pageB: Page, text: string): Promise<void> {
  await expect(pageA.getByTestId('session-next-up')).toContainText(text)
  await expect(pageB.getByTestId('session-next-up')).toContainText(text)
}

export function readBeepCount(page: Page): Promise<number> {
  return page.evaluate(() => (globalThis as unknown as { __beepCount: number }).__beepCount)
}

export function readWakeLockAcquired(page: Page): Promise<boolean> {
  return page.evaluate(
    () => (globalThis as unknown as { __wakeLockAcquired: boolean }).__wakeLockAcquired,
  )
}

export function readWakeLockReleaseCount(page: Page): Promise<number> {
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
export function instrumentAudioBeeps(): void {
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
export function instrumentWakeLock(): void {
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
export const APEX_STATION_1 = 'Dumbbell sprawl'
export const APEX_STATION_2 = 'Sandbag/dumbbell clean'

/**
 * The plan-changed notice the player raises. `SessionScreen` sends this sonner
 * toast when the snapshot's `planRevision` increases. The filter reads the
 * title, so a toast from a different surface cannot match.
 */
export function planChangeNotice(page: Page) {
  return page.locator('[data-sonner-toast]').filter({ hasText: 'The plan changed' })
}

/** The name the host puts on Apex's second station while the session runs it. */
export const RENAMED_STATION = 'Renamed while the session ran'

/**
 * The live-session count the tab bar shows this page right now.
 *
 * No indicator means no live sessions, so it reads as zero. Live sessions are
 * server-wide: a session another scenario runs raises this number for every
 * account. A caller must therefore compare it with what it read before, never
 * with an absolute figure.
 */
export async function readTabLiveCount(page: Page): Promise<number> {
  const badge = page.getByTestId('tab-live-count')
  if ((await badge.count()) === 0) {
    return 0
  }
  const text = await badge.textContent()
  return Number.parseInt(text ?? '0', 10)
}
