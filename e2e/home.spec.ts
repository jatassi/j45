/// <reference lib="dom" />
import type { Page, TestInfo, WebSocketRoute } from '@playwright/test'
import { expect, test } from '@playwright/test'

import { readStripStates } from './support/live-session.js'
import type { E2eProjectName } from './support/state.js'
import { readE2eEnv } from './support/state.js'

function projectNameFrom(testInfo: TestInfo): E2eProjectName {
  const name = testInfo.project.name
  if (name !== 'chromium' && name !== 'webkit') {
    throw new Error(`unexpected Playwright project name: ${name}`)
  }
  return name
}

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
  await expect(page.getByTestId('register-screen')).toBeVisible()
  await expect(page.locator('#register-code')).toHaveValue(input.code)
  await page.locator('#register-username').fill(input.username)
  await page.locator('#register-display-name').fill(input.displayName)
  await page.locator('#register-pin').fill(input.pin)
  await page.getByRole('button', { name: 'Create account' }).click()
  await expect(page.getByTestId('enroll-passkey-prompt')).toBeVisible()
  await page.getByTestId('enroll-passkey-skip').click()
  await expect(page.getByTestId('home-screen')).toBeVisible()
}

async function mintInviteCodes(
  page: Page,
  baseUrl: string,
  owner: { readonly username: string; readonly pin: string; readonly count: 1 | 2 },
): Promise<readonly string[]> {
  await page.goto(baseUrl)
  await page.locator('#login-username').fill(owner.username)
  await page.locator('#login-pin').fill(owner.pin)
  await expect(page.getByTestId('home-screen')).toBeVisible()
  await page.getByTestId('avatar-chip').click()
  await expect(page.getByTestId('people-invites')).toBeVisible()
  const codes: string[] = []
  const minted = page.getByTestId('minted-invite-code')
  let previous: string | null = null
  for (let i = 0; i < owner.count; i++) {
    await page.getByTestId('mint-invite-button').click()
    await (previous === null
      ? expect(minted).toBeVisible()
      : expect(minted).not.toHaveText(previous))
    const grouped = await minted.textContent()
    if (grouped === null) {
      throw new Error(`mint ${i + 1} produced no text`)
    }
    previous = grouped
    codes.push(grouped.replaceAll('-', ''))
  }
  await page.getByTestId('logout-button').click()
  await expect(page.getByTestId('login-screen')).toBeVisible()
  return codes
}

async function startApexSession(page: Page): Promise<string> {
  await page.getByTestId('tab-library').click()
  await page.locator('a[data-testid^="workout-card-"]').filter({ hasText: 'Apex' }).click()
  await page.getByTestId('start-session-button').click()
  await expect(page).toHaveURL(/\/session\/[^/?#]+/)
  const sessionId = /\/session\/([^/?#]+)/.exec(page.url())?.[1]
  if (sessionId === undefined) {
    throw new Error(`could not parse session id from url: ${page.url()}`)
  }
  return sessionId
}

async function clickSessionControl(page: Page, testId: string): Promise<void> {
  await page.getByTestId(testId).evaluate((node: HTMLElement) => node.click())
}

/**
 * Leaves the player through its confirm, then waits for home. The Leave
 * control only opens the dialog. A click alone keeps the session live, and a
 * live session stays in every account's lobby until the 60-second collector
 * removes it.
 */
async function leaveWithConfirm(page: Page): Promise<void> {
  await clickSessionControl(page, 'session-leave')
  await expect(page.getByTestId('session-leave-dialog')).toBeVisible()
  await page.getByTestId('session-leave-confirm').click()
  await expect(page.getByTestId('home-screen')).toBeVisible()
}

async function progressAndSkipToDone(page: Page): Promise<void> {
  for (let i = 0; i < 20; i++) {
    const before = await page.getByTestId('session-phase').textContent()
    if (before === 'Done') {
      return
    }
    await clickSessionControl(page, 'session-skip')
    await expect
      .poll(async () => {
        const next = await page.getByTestId('session-phase').textContent()
        return next === 'Done' || next !== before
      })
      .toBe(true)
  }
}

/** Hold rpc responses and/or fail StartSession; patch Toaster into the bundle. */
async function installHomeRpcAndToaster(
  page: Page,
  options: {
    readonly holdResponsesUntil?: Promise<void>
    readonly failStartSession?: boolean
    readonly mountToaster?: boolean
  } = {},
): Promise<void> {
  if (options.mountToaster) {
    await page.route('**/assets/index-*.js', async (route) => {
      const response = await route.fetch()
      let body = await response.text()
      const toaster =
        /var (\w+)=\(\{\.\.\.\w*\}\)=>\(0,\w+\.jsx\)\(\w+,\{theme:`dark`,className:`toaster group`/.exec(
          body,
        )
      const render =
        /\.render\(\(0,(\w+)\.jsx\)\((\w+)\.StrictMode,\{children:\(0,\1\.jsx\)\((\w+),\{children:\(0,\1\.jsx\)\((\w+),\{\}\)\}\)\}\)\);/.exec(
          body,
        )
      if (toaster !== null && render !== null) {
        const [t, j, p, a] = [toaster[1], render[1], render[3], render[4]]
        body = body.replace(
          `(0,${j}.jsx)(${p},{children:(0,${j}.jsx)(${a},{})})`,
          `(0,${j}.jsxs)(${p},{children:[(0,${j}.jsx)(${a},{}),(0,${j}.jsx)(${t},{})]})`,
        )
      }
      await route.fulfill({
        status: response.status(),
        headers: { ...response.headers(), 'content-type': 'application/javascript' },
        body,
      })
    })
  }
  const hold = options.holdResponsesUntil
  const failStart = options.failStartSession ?? false
  if (hold === undefined && !failStart) {
    return
  }
  await page.routeWebSocket(/\/rpc(?:\?|$)/, (ws: WebSocketRoute) => {
    const server = ws.connectToServer()
    if (hold !== undefined) {
      server.onMessage((message) => {
        void hold.then(() => {
          ws.send(message)
        })
      })
    }
    if (!failStart) {
      return
    }
    ws.onMessage((message) => {
      const raw = typeof message === 'string' ? message : message.toString()
      const lines = raw.split('\n').filter((l) => l.length > 0)
      if (lines.length === 0) {
        server.send(message)
        return
      }
      for (const line of lines) {
        try {
          const parsed = JSON.parse(line) as {
            _tag?: string
            tag?: string
            id?: string
            payload?: { workoutId?: string }
          }
          if (parsed._tag === 'Request' && parsed.tag === 'StartSession' && parsed.id) {
            const id = parsed.payload?.workoutId ?? 'workout-missing'
            ws.send(
              `${JSON.stringify({
                _tag: 'Exit',
                requestId: parsed.id,
                exit: {
                  _tag: 'Failure',
                  cause: { _tag: 'Fail', error: { _tag: 'WorkoutNotFound', id } },
                },
              })}\n`,
            )
            continue
          }
        } catch {
          // forward non-JSON
        }
        server.send(`${line}\n`)
      }
    })
  })
}

test.describe('home dashboard (chromium + webkit)', () => {
  test.describe.configure({ mode: 'serial' })

  test('quick-start tiles navigate; StartSession failure toasts; skeletons before resolve', async ({
    page,
  }, testInfo) => {
    test.setTimeout(90_000)
    const projectName = projectNameFrom(testInfo)
    const env = readE2eEnv()
    const [code] = await mintInviteCodes(page, env.baseUrl, { ...env.owner, count: 1 })
    let releaseHold: (() => void) | undefined
    const holdResponsesUntil = new Promise<void>((resolve) => {
      releaseHold = resolve
    })
    await installHomeRpcAndToaster(page, {
      holdResponsesUntil,
      failStartSession: true,
      mountToaster: true,
    })
    await page.goto(`${env.baseUrl}/register?invite=${code}`)
    await expect(page.getByTestId('register-screen')).toBeVisible()
    await page.locator('#register-username').fill(`e2e-ht-${projectName}`)
    await page.locator('#register-display-name').fill(`Home Tiles ${projectName}`)
    await page.locator('#register-pin').fill('1357')
    await page.getByRole('button', { name: 'Create account' }).click()
    await page.getByTestId('enroll-passkey-skip').click()
    await expect(page.getByTestId('home-hero-skeleton')).toBeVisible()
    await expect(page.getByTestId('home-recent-skeleton')).toBeVisible()
    releaseHold?.()
    await expect(page.getByTestId('home-hero')).toBeVisible()
    for (const [id, path, back] of [
      ['home-timer-link', /\/timer\/?$/, true],
      ['home-generate-link', /\/generate\/?$/, false],
      ['home-new-workout-link', /\/workouts\/new\/?$/, true],
    ] as const) {
      await page.getByTestId(id).click()
      await expect(page).toHaveURL(path)
      await page.getByTestId(back ? 'back-button' : 'tab-home').click()
      await expect(page.getByTestId('home-screen')).toBeVisible()
    }
    const recentStart = page.locator('[data-testid^="recent-start-"]').first()
    await recentStart.click()
    const startToast = page.locator('[data-sonner-toast]').filter({
      hasText: 'Could not start session',
    })
    await expect(startToast.first()).toBeVisible({ timeout: 10_000 })
    expect(new URL(page.url()).pathname).toBe('/')
    await expect(recentStart).toBeEnabled()
  })

  test("while A runs a seed session, B's home names host/workout; join lands on the same segment", async ({
    page,
    browser,
    browserName,
  }, testInfo) => {
    test.skip(
      browserName !== 'chromium',
      'two logged-in browser contexts for live join is chromium-only (same as live-session.spec.ts).',
    )
    test.setTimeout(90_000)
    const projectName = projectNameFrom(testInfo)
    const env = readE2eEnv()
    const [codeA, codeB] = await mintInviteCodes(page, env.baseUrl, { ...env.owner, count: 2 })
    const displayA = `Home Host ${projectName}`
    await registerAndReachHome(page, env.baseUrl, {
      code: codeA,
      username: `e2e-h1a-${projectName}`,
      displayName: displayA,
      pin: '2468',
    })
    const contextB = await browser.newContext()
    const pageB = await contextB.newPage()
    try {
      await registerAndReachHome(pageB, env.baseUrl, {
        code: codeB,
        username: `e2e-h1b-${projectName}`,
        displayName: `Home Guest ${projectName}`,
        pin: '2468',
      })
      const sessionId = await startApexSession(page)
      const join = pageB.getByTestId(`session-card-${sessionId}`)
      await expect(join).toBeVisible({ timeout: 15_000 })
      const hero = pageB.getByTestId('home-hero')
      await expect(hero).toBeVisible({ timeout: 15_000 })
      await expect
        .poll(async () => {
          const heroText = (await hero.textContent()) ?? ''
          const cardText = (await join.textContent()) ?? ''
          return (
            (heroText.includes(displayA) || cardText.includes(displayA)) &&
            (heroText.includes('Apex') || cardText.includes('Apex'))
          )
        })
        .toBe(true)
      await join.click()
      await expect(pageB).toHaveURL(new RegExp(`/session/${sessionId}`))
      // The live timer ticks phases in real time, so a value read from A goes
      // stale before B can be asserted against it — read both together and
      // poll until the pair agrees.
      await expect
        .poll(async () => {
          const [phaseA, phaseB, stripA, stripB] = await Promise.all([
            page.getByTestId('session-phase').textContent(),
            pageB.getByTestId('session-phase').textContent(),
            readStripStates(page),
            readStripStates(pageB),
          ])
          // The strip replaces the context line as the shared position: the
          // same bars, cells and dots in the same states on both phones.
          return (
            Boolean(phaseA) &&
            phaseA === phaseB &&
            stripA.length > 0 &&
            stripA.join(',') === stripB.join(',')
          )
        })
        .toBe(true)
      await leaveWithConfirm(pageB)
      await leaveWithConfirm(page)
    } finally {
      await contextB.close()
    }
  })

  test('fresh account: browse-fallback hero and library-padded recent list (≤5 rows)', async ({
    page,
  }, testInfo) => {
    // The browse hero has the lowest priority. A live session anywhere on the
    // server outranks it, because the lobby feed is not scoped to the
    // caller. This test thus needs one moment with no live session at all, and
    // a session ends 60 seconds after its last watcher goes. Under a loaded
    // parallel run, the other specs can keep that moment away until they stop.
    // The wait below is therefore long. It ends in milliseconds on a quiet
    // server.
    test.setTimeout(330_000)
    const projectName = projectNameFrom(testInfo)
    const env = readE2eEnv()
    const [code] = await mintInviteCodes(page, env.baseUrl, { ...env.owner, count: 1 })
    await registerAndReachHome(page, env.baseUrl, {
      code,
      username: `e2e-hf-${projectName}`,
      displayName: `Home Fresh ${projectName}`,
      pin: '1357',
    })
    await expect(page.getByTestId('home-screen')).toBeVisible()
    await expect(page.getByTestId('hero-browse-link')).toBeVisible({ timeout: 300_000 })
    await expect(page.getByTestId('home-hero')).toContainText('From your library')
    await expect(page.locator('[data-testid^="recent-row-"]')).toHaveCount(5)
  })

  test('after finishing Apex, hero shows Start last; hero-start opens a new session', async ({
    page,
  }, testInfo) => {
    test.setTimeout(150_000)
    const projectName = projectNameFrom(testInfo)
    const env = readE2eEnv()
    const [code] = await mintInviteCodes(page, env.baseUrl, { ...env.owner, count: 1 })
    await registerAndReachHome(page, env.baseUrl, {
      code,
      username: `e2e-hl-${projectName}`,
      displayName: `Home Last ${projectName}`,
      pin: '1357',
    })
    await startApexSession(page)
    await progressAndSkipToDone(page)
    await clickSessionControl(page, 'session-finish')
    await expect(page.getByTestId('home-screen')).toBeVisible()
    const hero = page.getByTestId('home-hero')
    await expect(hero).toContainText('Start last', { timeout: 120_000 })
    await expect(hero).toContainText('Apex')
    await page.getByTestId('hero-start').click()
    await expect(page).toHaveURL(/\/session\/[^/?#]+/)
    await leaveWithConfirm(page)
  })
})
