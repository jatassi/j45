// @vitest-environment jsdom
import { SessionId, SessionSummary } from '@j45/domain'
import { cleanup, screen } from '@testing-library/react'
import * as Schema from 'effect/Schema'
import { afterEach, describe, expect, it } from 'vitest'

import { defaultHandlers, liveSession, renderHomeScreen } from './home-harness'
import { makeLobby } from './lobby-feed'

afterEach(() => {
  cleanup()
})

/**
 * Home and the tab bar together, as the tab layout mounts them.
 *
 * This suite exists for the two claims no single-component test can make:
 * that the count agrees with the list home shows at the same moment, and that
 * the indicator joins the subscription home already holds instead of opening
 * a second one that could answer differently.
 */

/** A second live row, so a published change moves both the count and the list. */
const secondSession = new SessionSummary({
  id: Schema.decodeSync(SessionId)('session-live-2'),
  workoutId: liveSession.workoutId,
  hostDisplayName: 'Sam',
  workoutName: liveSession.workoutName,
  startedAt: liveSession.startedAt,
  participantCount: 3,
})

/** How many live-session links home shows right now. */
const homeSessionCards = (): number =>
  document.querySelectorAll('[data-testid^="session-card-"]').length

describe('tab-bar count against the home list', () => {
  it('reads one subscription with home, and its count matches the rows home lists', async () => {
    const lobby = makeLobby([liveSession])
    let subscriptions = 0
    renderHomeScreen(
      defaultHandlers({
        WatchActiveSessions: () => {
          subscriptions += 1
          return lobby.handler()
        },
      }),
      { withTabBar: true },
    )

    const indicator = await screen.findByTestId('tab-live-count')
    expect(indicator.textContent).toBe('1')
    expect(homeSessionCards()).toBe(1)

    await lobby.publish([liveSession, secondSession])
    expect(screen.getByTestId('tab-live-count').textContent).toBe('2')
    expect(homeSessionCards()).toBe(2)

    // One atom, one subscription. A second one could answer differently, and
    // the count would then contradict the list on the same screen.
    expect(subscriptions).toBe(1)
  })
})
