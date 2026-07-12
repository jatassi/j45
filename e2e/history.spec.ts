/// <reference lib="dom" />
import type { Page } from '@playwright/test'
import { expect, test } from '@playwright/test'

import { readE2eEnv } from './support/state.js'

/**
 * Registers a brand-new account through the real `/register` form (skipping
 * the passkey enrollment prompt). Lands on `home-screen` at `/`.
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

/**
 * PIN-login as the shared owner, mint two fresh invite codes via the real
 * People & Invites UI, then log out back to `login-screen`. Same pattern as
 * `live-session.spec.ts` — no shared invite pool needed.
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
  await expect(page.getByTestId('home-screen')).toBeVisible()
  await page.getByTestId('avatar-chip').click()
  await expect(page.getByTestId('account-screen')).toBeVisible()
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

/**
 * Opens `/library` via the tab bar, opens Apex, starts a session, returns
 * the session id from the URL.
 */
async function startApexSession(page: Page): Promise<string> {
  await page.getByTestId('tab-library').click()
  await expect(page.getByTestId('library-screen')).toBeVisible()
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
 * Skip once to leave the ready segment (progressed gate), then keep skipping
 * until `session-phase` is `Done` so `session-finish` is available.
 * Apex has ≤ 16 segments; cap the loop well above that.
 */
async function progressAndSkipToDone(page: Page): Promise<void> {
  const phaseBefore = await page.getByTestId('session-phase').textContent()
  await clickSessionControl(page, 'session-skip')
  await expect
    .poll(async () => {
      const phase = await page.getByTestId('session-phase').textContent()
      return phase === 'Done' || phase !== phaseBefore
    })
    .toBe(true)

  for (let i = 0; i < 20; i++) {
    const phase = await page.getByTestId('session-phase').textContent()
    if (phase === 'Done') {
      return
    }
    const before = phase
    await clickSessionControl(page, 'session-skip')
    await expect
      .poll(async () => {
        const next = await page.getByTestId('session-phase').textContent()
        return next === 'Done' || next !== before
      })
      .toBe(true)
  }
  await expect(page.getByTestId('session-phase')).toHaveText('Done')
}

/**
 * Via the History tab (not `page.goto`), open `/history` and assert the row
 * for this session: Apex name, a non-empty date, and host label. Scope to the
 * row containing `rowMarker` so leftover history from other e2e runs cannot
 * confuse the assertion. Does not assert `participants` — each leave writes a
 * per-stint roster snapshot, so co-leavers may not share the same list.
 * Returns the completion id for progress assertions.
 */
async function assertHistoryRow(
  page: Page,
  input: {
    readonly rowMarker: string
    readonly hostLabel: string
  },
): Promise<string> {
  await page.getByTestId('tab-history').click()
  await expect(page).toHaveURL(/\/history/)
  await expect(page.getByTestId('history-screen')).toBeVisible()
  await expect(page.getByTestId('history-list')).toBeVisible()

  const row = page.locator('[data-testid^="history-row-"]').filter({ hasText: input.rowMarker })
  await expect(row).toBeVisible()
  await expect(row).toContainText('Apex')

  const testId = await row.getAttribute('data-testid')
  if (testId === null || !testId.startsWith('history-row-')) {
    throw new Error(`could not read history-row test id from row: ${testId}`)
  }
  const completionId = testId.slice('history-row-'.length)

  await expect(page.getByTestId(`history-name-${completionId}`)).toHaveText('Apex')
  const dateText = await page.getByTestId(`history-date-${completionId}`).textContent()
  expect(dateText?.trim().length ?? 0).toBeGreaterThan(0)
  await expect(page.getByTestId(`history-host-${completionId}`)).toHaveText(
    `Host: ${input.hostLabel}`,
  )
  return completionId
}

/**
 * Parse `segmentsCompleted` from `history-progress-<id>`. Prefers
 * `data-segments-completed` (works for both partial N/M and Finished rows);
 * falls back to parsing N/M text so older partial-only markup still works.
 */
async function readHistoryProgressNumerator(page: Page, completionId: string): Promise<number> {
  const progress = page.getByTestId(`history-progress-${completionId}`)
  await expect(progress).toBeVisible()

  const attr = await progress.getAttribute('data-segments-completed')
  if (attr !== null && attr.length > 0) {
    return Number(attr)
  }

  const rawText = await progress.textContent()
  const text = rawText?.trim() ?? ''
  const match = /(\d+)\/(\d+)/.exec(text)
  if (match === null) {
    throw new Error(`history-progress-${completionId} text was not N/M: ${JSON.stringify(text)}`)
  }
  return Number(match[1])
}

test.describe('history (chromium + webkit)', () => {
  test(
    'two users independently leave a progressed Apex session; both see name, date, host on ' +
      '/history; mid-leave progress numerator is strictly lower than done-leave',
    async ({ page, browser }, testInfo) => {
      test.setTimeout(90_000)

      const projectName = testInfo.project.name
      const env = readE2eEnv()
      const [codeA, codeB] = await mintTwoInviteCodes(page, env.baseUrl, env.owner)

      // Distinct display names (and per-project usernames) so chromium + webkit
      // can share one server without colliding, and history rows disambiguate.
      const displayA = `Hist Host ${projectName}`
      const displayB = `Hist Guest ${projectName}`

      await registerAndReachHome(page, env.baseUrl, {
        code: codeA,
        username: `e2e-hist-a-${projectName}`,
        displayName: displayA,
        pin: '192837',
      })

      const contextB = await browser.newContext()
      const pageB = await contextB.newPage()
      try {
        await registerAndReachHome(pageB, env.baseUrl, {
          code: codeB,
          username: `e2e-hist-b-${projectName}`,
          displayName: displayB,
          pin: '192838',
        })
        await expect(pageB.getByTestId('home-screen')).toBeVisible()

        const sessionId = await startApexSession(page)
        await expect(page).toHaveURL(new RegExp(`/session/${sessionId}`))

        // Active-session cards live on Home; guest is already there after register.
        const card = pageB.getByTestId(`session-card-${sessionId}`)
        await expect(card).toBeVisible({ timeout: 10_000 })
        await card.click()
        await expect(pageB).toHaveURL(new RegExp(`/session/${sessionId}`))
        await expect(pageB.getByTestId('session-screen')).toBeVisible()

        // A progresses past ready, then leaves mid-workout (partial progress).
        const phaseBefore = await page.getByTestId('session-phase').textContent()
        await clickSessionControl(page, 'session-skip')
        await expect
          .poll(async () => {
            const phase = await page.getByTestId('session-phase').textContent()
            return phase === 'Done' || phase !== phaseBefore
          })
          .toBe(true)
        // Leave opens an alert-dialog; only confirm exits mid-workout.
        await clickSessionControl(page, 'session-leave')
        await expect(page.getByTestId('session-leave-dialog')).toBeVisible()
        await page.getByTestId('session-leave-confirm').click()
        // Leave navigates to `/` (home).
        await expect(page.getByTestId('home-screen')).toBeVisible()

        // B continues to Done and leaves via Finish (higher progress).
        await progressAndSkipToDone(pageB)
        await expect(pageB.getByTestId('session-finish')).toBeVisible()
        await clickSessionControl(pageB, 'session-finish')
        await expect(pageB.getByTestId('home-screen')).toBeVisible()

        // Host row still lists B (roster at A's leave); guest row is keyed by host name.
        const completionIdA = await assertHistoryRow(page, {
          rowMarker: displayB,
          hostLabel: 'you',
        })
        const completionIdB = await assertHistoryRow(pageB, {
          rowMarker: displayA,
          hostLabel: displayA,
        })

        // Participant pills, asserted e2e on the one card with a deterministic
        // roster. `recordLeaver` snapshots the roster *before* unrostering, so
        // A's own completion — written when A left first, while B was still
        // present — lists both the host (A) and the guest (B). (B's card, by
        // contrast, is written after A departed and lists only B, which is why
        // `assertHistoryRow` deliberately skips participants.) Scope to the
        // `history-participants-<id>` container so the host badge (a sibling)
        // can't satisfy the pill assertion on its own.
        const participantsA = page.getByTestId(`history-participants-${completionIdA}`)
        await expect(participantsA).toBeVisible()
        await expect(participantsA.getByText(displayA, { exact: true })).toBeVisible()
        await expect(participantsA.getByText(displayB, { exact: true })).toBeVisible()

        // Mid-leaver shows a partial N/M fraction; finisher shows Finished.
        const progressAEl = page.getByTestId(`history-progress-${completionIdA}`)
        await expect(progressAEl).toBeVisible()
        await expect(progressAEl).toContainText(/\d+\/\d+/)
        await expect(progressAEl).not.toContainText('Finished')

        const progressBEl = pageB.getByTestId(`history-progress-${completionIdB}`)
        await expect(progressBEl).toBeVisible()
        await expect(progressBEl).toHaveText('Finished')

        const progressA = await readHistoryProgressNumerator(page, completionIdA)
        const progressB = await readHistoryProgressNumerator(pageB, completionIdB)
        expect(progressA).toBeLessThan(progressB)

        // Expanding a card reveals the as-run Apex pod/station snapshot.
        await page.getByTestId(`history-expand-${completionIdA}`).click()
        const snapshotA = page.getByTestId(`history-snapshot-${completionIdA}`)
        await expect(snapshotA).toBeVisible()
        await expect(snapshotA).toContainText('8 combo stations')
        await expect(snapshotA).toContainText('Kettlebell swing')
        await expect(snapshotA).toContainText('Rower')

        await pageB.getByTestId(`history-expand-${completionIdB}`).click()
        const snapshotB = pageB.getByTestId(`history-snapshot-${completionIdB}`)
        await expect(snapshotB).toBeVisible()
        await expect(snapshotB).toContainText('8 combo stations')
        await expect(snapshotB).toContainText('Hand-release burpee')
      } finally {
        await contextB.close()
      }
    },
  )

  test(
    'a freshly registered account with no completions sees the empty state on /history — ' +
      'query-boundary-empty with a Start a workout CTA that links to (and navigates to) /library',
    async ({ page }, testInfo) => {
      const projectName = testInfo.project.name
      const env = readE2eEnv()
      const [code] = await mintTwoInviteCodes(page, env.baseUrl, env.owner)

      await registerAndReachHome(page, env.baseUrl, {
        code,
        username: `e2e-hist-e-${projectName}`,
        displayName: `Hist Empty ${projectName}`,
        pin: '246813',
      })

      // Via the tab bar (not `page.goto`), like `assertHistoryRow`.
      await page.getByTestId('tab-history').click()
      await expect(page).toHaveURL(/\/history/)
      await expect(page.getByTestId('history-screen')).toBeVisible()

      // No completions → the empty surface, not the list / loading / failure ones.
      await expect(page.getByTestId('query-boundary-empty')).toBeVisible()
      await expect(page.getByTestId('history-list')).toHaveCount(0)
      await expect(page.getByTestId('query-boundary-loading')).toHaveCount(0)
      await expect(page.getByTestId('query-boundary-error')).toHaveCount(0)

      // CTA links to /library and actually gets there when clicked.
      const cta = page.getByTestId('start-workout-empty-cta')
      await expect(cta).toBeVisible()
      await expect(cta).toHaveText(/Start a workout/i)
      await expect(cta).toHaveAttribute('href', '/library')
      await cta.click()
      await expect(page).toHaveURL(/\/library/)
      await expect(page.getByTestId('library-screen')).toBeVisible()
    },
  )

  test(
    'when the ListHistory query fails, /history shows query-boundary-error (a Retry control, ' +
      'structurally distinct from query-boundary-loading); Retry recovers to real data once the ' +
      'failure is lifted',
    async ({ page }, testInfo) => {
      const projectName = testInfo.project.name
      const env = readE2eEnv()
      const [code] = await mintTwoInviteCodes(page, env.baseUrl, env.owner)

      await registerAndReachHome(page, env.baseUrl, {
        code,
        username: `e2e-hist-f-${projectName}`,
        displayName: `Hist Fail ${projectName}`,
        pin: '135790',
      })

      // The rpc transport is a WebSocket at /rpc (see `lib/rpc-client.ts`), so
      // HTTP route interception can't touch a query. Instead intercept the
      // socket the way `exercises.spec.ts` does: proxy every frame to the real
      // server, except kill the socket on the *first* ListHistory request. That
      // fails the in-flight query (the client protocol surfaces a
      // ClientProtocolError → `query-boundary-error`). The client's socket layer
      // then reconnects on its retry schedule with a fresh WebSocket, which
      // re-enters this handler and — the once-only flag now set — proxies
      // normally, so a later Retry re-runs ListHistory over a healthy transport.
      // Auth rides on `GET /auth/me` (HTTP), not this socket, so killing it never
      // unmounts /history or bounces to the login screen.
      let listHistoryFailuresInjected = 0
      let rpcConnections = 0
      await page.routeWebSocket('**/rpc', (ws) => {
        rpcConnections += 1
        const server = ws.connectToServer()
        ws.onMessage((message) => {
          const text =
            typeof message === 'string'
              ? message
              : Buffer.from(message as ArrayBuffer).toString('utf8')
          if (listHistoryFailuresInjected === 0 && text.includes('ListHistory')) {
            listHistoryFailuresInjected += 1
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

      // Reload so the app reconnects over the intercepted socket (the route only
      // catches WebSockets opened after it is installed), then open History.
      await page.reload()
      await expect(page.getByTestId('home-screen')).toBeVisible()
      await page.getByTestId('tab-history').click()
      await expect(page).toHaveURL(/\/history/)
      await expect(page.getByTestId('history-screen')).toBeVisible()

      // Failure surface, structurally distinct from loading, with a Retry control.
      await expect(page.getByTestId('query-boundary-error')).toBeVisible()
      await expect(page.getByRole('button', { name: 'Retry' })).toBeVisible()
      await expect(page.getByTestId('query-boundary-loading')).toHaveCount(0)
      await expect(page.getByTestId('query-boundary-empty')).toHaveCount(0)

      // The client's protocol keeps a `currentError` sticky until its socket
      // reconnects (a fresh WebSocket clears it on open) — so a Retry fired
      // during the ~500ms reconnect window would just re-fail. Wait for the
      // second connection (the reconnect re-enters this route) before retrying;
      // `expect.poll` is an auto-retrying expect, no fixed sleep.
      await expect.poll(() => rpcConnections).toBeGreaterThanOrEqual(2)

      // Retry re-runs ListHistory over the now-recovered socket; the failure
      // clears and the account's real (empty) history renders as a success.
      await page.getByRole('button', { name: 'Retry' }).click()
      await expect(page.getByTestId('query-boundary-empty')).toBeVisible()
      await expect(page.getByTestId('query-boundary-error')).toHaveCount(0)
    },
  )
})
