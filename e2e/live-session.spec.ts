import { expect, test } from '@playwright/test'

import { expectNoGlassOverlapsTheCountdown } from './support/countdown-glass.js'
import {
  APEX_STATION_1,
  APEX_STATION_2,
  assertApexOnHistory,
  assertBMatchesAPhase,
  assertBothNextUp,
  assertBothPhase,
  clickSessionControl,
  instrumentAudioBeeps,
  instrumentWakeLock,
  joinSessionFromLobby,
  leaveSessionWithConfirm,
  mintTwoInviteCodes,
  planChangeNotice,
  readBeepCount,
  readStripStates,
  readTabLiveCount,
  readWakeLockAcquired,
  readWakeLockReleaseCount,
  registerAndReachLibrary,
  RENAMED_STATION,
  skipSessionToDone,
  startApexSession,
} from './support/live-session.js'
import { readE2eEnv } from './support/state.js'

test.describe('live session (chromium only — two logged-in browser contexts)', () => {
  test(
    'A starts Apex; B joins the same segment; phase/data-phase/next-up sync; B pause ' +
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
          page.getByTestId('player-progress-arc').getByTestId('session-count'),
        ).toBeVisible()
        await expect(page.getByTestId('session-next-up')).toContainText(APEX_STATION_1)

        const card = pageB.getByTestId(`session-card-${sessionId}`)
        await expect(card).toBeVisible({ timeout: 10_000 })
        // The names are read off the card around the link, not off the link.
        // Home gives the newest live session the hero slot and lists the rest
        // as compact rows; `session-card-<id>` is the link in both, but the
        // hero's link carries only its Join now label and writes the host and
        // the workout on `home-hero` outside it. Live sessions are
        // server-wide, so which shape this session lands in depends on what
        // other scenarios are running, and only the enclosing card holds the
        // names in either one.
        const named = pageB
          .getByTestId('home-hero')
          .filter({ has: card })
          .or(pageB.locator('li').filter({ has: card }))
        await expect(named).toContainText(displayA)
        await expect(named).toContainText('Apex')

        await joinSessionFromLobby(pageB, env.baseUrl, sessionId)

        // Land both players on the first work segment. Ready is only 5s and B's
        // join burns variable wall-clock, so rather than snapshot A mid ready→work
        // transition (or race a skip against the server's authoritative phase),
        // ride A's natural ready→work auto-advance first — 15s comfortably clears
        // the 5s ready window — then compare the two screens on a stable phase.
        await expect(page.getByTestId('session-phase')).toHaveText('Work', { timeout: 15_000 })

        // Both players now share the stable work segment.
        await assertBMatchesAPhase(page, pageB)
        await expect(
          pageB.getByTestId('player-progress-arc').getByTestId('session-count'),
        ).toBeVisible()

        await assertBothPhase([page, pageB], { data: 'work', label: 'Work' })

        // Next-up names following work; no detail line (Apex stations have no `detail`).
        await assertBothNextUp(page, pageB, APEX_STATION_2)
        await expect(page.getByTestId('session-exercise-detail')).toHaveCount(0)

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
        // Both phones read the same Progress strip: the same bars, cells and
        // round dots in the same states. This is the position agreement the
        // context line used to prove.
        const stripOnRest = await readStripStates(page)
        expect(stripOnRest.length).toBeGreaterThan(0)
        await expect.poll(() => readStripStates(pageB)).toEqual(stripOnRest)

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

        // End the session before the browsers close, so that its row does not
        // stay in every account's lobby until the 60-second collector removes
        // it.
        await leaveSessionWithConfirm(pageB)
        await expect(pageB.getByTestId('home-screen')).toBeVisible()
        await leaveSessionWithConfirm(page)
        await expect(page.getByTestId('home-screen')).toBeVisible()
      } finally {
        await contextB.close()
      }
    },
  )
  test(
    'host edits Apex while a second user runs it: the save prompts that the workout is live, ' +
      'the participant keeps the old plan through the interval, and the next segment boundary ' +
      'brings the plan-changed notice together with the new station',
    async ({ page, browser, browserName }) => {
      test.skip(
        browserName !== 'chromium',
        'live-session e2e is chromium-only (two logged-in browser contexts; not webkit).',
      )
      test.setTimeout(120_000)

      const env = readE2eEnv()
      const [codeA, codeB] = await mintTwoInviteCodes(page, env.baseUrl, env.owner)

      const displayA = 'Live Editor A'
      await registerAndReachLibrary(page, env.baseUrl, {
        code: codeA,
        username: 'e2e-ls3-a',
        displayName: displayA,
        pin: '9753',
      })

      const contextB = await browser.newContext()
      const pageB = await contextB.newPage()
      try {
        await registerAndReachLibrary(pageB, env.baseUrl, {
          code: codeB,
          username: 'e2e-ls3-b',
          displayName: 'Live Editor B',
          pin: '9753',
        })

        const sessionId = await startApexSession(page)

        await joinSessionFromLobby(pageB, env.baseUrl, sessionId)

        // The ready segment is 5 seconds. Wait for its automatic advance
        // instead of a race against it. Both users are then in the first work
        // interval, which Apex makes 4 minutes long. That is time enough for
        // the host to leave, edit and save inside it.
        await expect(page.getByTestId('session-phase')).toHaveText('Work', { timeout: 15_000 })
        await assertBMatchesAPhase(page, pageB)
        await expect(pageB.getByTestId('session-next-up')).toContainText(APEX_STATION_2)

        // The player has no route to the editor. The host must leave first.
        // The session continues, because B still watches it.
        await leaveSessionWithConfirm(page)
        await expect(page.getByTestId('home-screen')).toBeVisible()
        // The lobby row is also what tells the host's editor that this workout
        // is live. Wait for the row before you open the editor.
        await expect(page.getByTestId(`session-card-${sessionId}`)).toBeVisible({ timeout: 10_000 })

        await page.getByTestId('tab-library').click()
        await page.locator('a[data-testid^="workout-card-"]').filter({ hasText: 'Apex' }).click()
        await expect(page.getByTestId('workout-detail-screen')).toBeVisible()
        await page.getByTestId('edit-button').click()
        await expect(page.getByTestId('workout-editor-screen')).toBeVisible()

        const stations = page.getByTestId('pod-editor').first().getByTestId('station-name-input')
        await expect(stations).toHaveCount(8)
        await expect(stations.nth(1)).toHaveValue(new RegExp(APEX_STATION_2))
        await expect(page.getByTestId('editor-summary')).toBeVisible()
        await stations.nth(1).fill(RENAMED_STATION)
        await expect(page.getByTestId('editor-save')).toBeEnabled()

        // One live session runs this workout. The save thus stops at the
        // confirm, and it writes nothing until the host accepts it.
        await page.getByTestId('editor-save').click()
        const savePrompt = page.getByTestId('live-save-dialog')
        await expect(savePrompt).toBeVisible()
        await expect(savePrompt).toContainText('This workout is live')
        await expect(savePrompt).toContainText('1 live session')
        await page.getByTestId('live-save-confirm').click()

        await expect(page.getByTestId('workout-detail-screen')).toBeVisible()
        await expect(page.getByTestId('station-name').nth(1)).toHaveText(RENAMED_STATION)

        // The host joins the session again. A join republishes the snapshot to
        // all participants. When B shows the host in its participant list, B
        // has read a snapshot that the server made after the save. No wait
        // guesses at that point.
        //
        // That snapshot still carries the plan B started with, because the
        // edit waits for the boundary. It raises no notice either: the notice
        // follows the revision, not the republish.
        await page.getByTestId('tab-home').click()
        await page.getByTestId(`session-card-${sessionId}`).click()
        await expect(page.getByTestId('session-screen')).toBeVisible()
        await expect(pageB.getByTestId('session-participants')).toContainText(displayA)

        await expect(pageB.getByTestId('session-phase')).toHaveText('Work')
        await expect(pageB.getByTestId('session-next-up')).toContainText(APEX_STATION_2)
        await expect(planChangeNotice(pageB)).toHaveCount(0)

        // The next segment releases the held plan. The notice follows the
        // snapshot's revision, so it arrives with the new station. One notice
        // is on screen, and the republish before it raised none.
        await clickSessionControl(pageB, 'session-skip')
        const notice = planChangeNotice(pageB)
        await expect(notice).toHaveCount(1)
        await expect(notice).toContainText(`${displayA} updated this workout.`)

        // Both users get the same new plan at the same position.
        for (const p of [page, pageB]) {
          await expect(p.getByTestId('session-screen')).toHaveAttribute('data-phase', 'rest')
          await expect(p.getByTestId('session-next-up')).toHaveText(RENAMED_STATION)
          await expect(p.getByTestId('session-exercise-name')).toHaveText(RENAMED_STATION)
        }

        // End the session before the browsers close. A session that stays live
        // keeps its row in every account's lobby until the 60-second collector
        // removes it, and other scenarios read that lobby.
        await leaveSessionWithConfirm(pageB)
        await expect(pageB.getByTestId('home-screen')).toBeVisible()
        await leaveSessionWithConfirm(page)
        await expect(page.getByTestId('home-screen')).toBeVisible()
      } finally {
        await contextB.close()
      }
    },
  )

  test(
    'B sits on Library while A starts a session: the tab bar count on B rises with no navigation, ' +
      'and the indicator says what it counts',
    async ({ page, browser, browserName }) => {
      test.skip(
        browserName !== 'chromium',
        'live-session e2e is chromium-only (two logged-in browser contexts; not webkit).',
      )
      test.setTimeout(60_000)

      const env = readE2eEnv()
      const [codeA, codeB] = await mintTwoInviteCodes(page, env.baseUrl, env.owner)

      await registerAndReachLibrary(page, env.baseUrl, {
        code: codeA,
        username: 'e2e-ls4-a',
        displayName: 'Live Count A',
        pin: '6420',
      })

      const contextB = await browser.newContext()
      const pageB = await contextB.newPage()
      try {
        await registerAndReachLibrary(pageB, env.baseUrl, {
          code: codeB,
          username: 'e2e-ls4-b',
          displayName: 'Live Count B',
          pin: '6420',
        })

        // B leaves home for a route that lists no live sessions at all. From
        // here the tab bar is the only thing that can tell B anything.
        await pageB.getByTestId('tab-library').click()
        await expect(pageB.getByTestId('library-screen')).toBeVisible()

        // Live sessions are server-wide, so other scenarios can add rows.
        // Read the count first and compare with it, never with zero.
        const before = await readTabLiveCount(pageB)

        await startApexSession(page)

        // Other scenarios retire rows as well as add them, and one retired
        // inside this window would cancel A's own before the poll could catch
        // it. The poll therefore holds the highest count it has seen rather
        // than the count at the instant it looks: the claim is that the number
        // rose when A started, not that it stayed risen.
        let highest = before
        await expect
          .poll(
            async () => {
              highest = Math.max(highest, await readTabLiveCount(pageB))
              return highest
            },
            { timeout: 20_000 },
          )
          .toBeGreaterThanOrEqual(before + 1)

        // B did not navigate. The chrome already on screen learned by itself.
        await expect(pageB.getByTestId('library-screen')).toBeVisible()

        // The indicator names what it counts, and it lives inside the Home
        // tab: the only place it can take B is home, never into a session.
        const indicator = pageB.getByTestId('tab-home').getByTestId('tab-live-count')
        await expect(indicator).toBeVisible()
        await expect(indicator).toHaveAttribute('aria-label', /^\d+ live sessions?$/)

        // End the session before the browsers close, so that its row does not
        // stay in every account's lobby until the 60-second collector removes
        // it.
        await leaveSessionWithConfirm(page)
        await expect(page.getByTestId('home-screen')).toBeVisible()
      } finally {
        await contextB.close()
      }
    },
  )

  test(
    'no glass surface overlaps the live Session countdown: the refracting control dock stays ' +
      'clear of the digits on a small, a standard and a large phone',
    async ({ page, browserName }) => {
      test.skip(
        browserName !== 'chromium',
        'live-session e2e is chromium-only (two logged-in browser contexts; not webkit).',
      )
      test.setTimeout(60_000)

      const env = readE2eEnv()
      const [codeA] = await mintTwoInviteCodes(page, env.baseUrl, env.owner)
      await registerAndReachLibrary(page, env.baseUrl, {
        code: codeA,
        username: 'e2e-ls5-a',
        displayName: 'Live Glass A',
        pin: '6420',
      })

      // One client, not two. The measurement is of one screen's own layout,
      // so a second Participant would add cost and tell it nothing.
      await page.setViewportSize({ width: 390, height: 844 })
      await startApexSession(page)
      await expect(page.getByTestId('player-progress-arc')).toBeVisible()
      await expect(page.getByTestId('session-count')).toBeVisible()

      // This screen, not only the manual timer. The live Session's control
      // dock takes the refract tier, so its composited slice becomes the
      // visible refraction, and this is the one screen where a repaint of the
      // digits could be seen. The manual timer caps its dock at the CSS tier.
      await expectNoGlassOverlapsTheCountdown(page)
      await page.setViewportSize({ width: 360, height: 640 })
      await expectNoGlassOverlapsTheCountdown(page)
      // A large phone as well: the arc's pixel ceiling binds here, and this
      // screen's ceiling is the higher of the two, so it is the only screen
      // whose largest arc this can measure.
      await page.setViewportSize({ width: 430, height: 932 })
      await expectNoGlassOverlapsTheCountdown(page)

      // End the session before the browser closes, so that its row does not
      // stay in every account's lobby until the 60-second collector removes it.
      await leaveSessionWithConfirm(page)
      await expect(page.getByTestId('home-screen')).toBeVisible()
    },
  )
})
