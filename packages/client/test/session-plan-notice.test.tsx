// @vitest-environment jsdom
import { SessionId, TimerRunning, type SessionState } from '@j45/domain'
import { cleanup, screen, waitFor } from '@testing-library/react'
import * as Effect from 'effect/Effect'
import * as Queue from 'effect/Queue'
import * as Schema from 'effect/Schema'
import * as Stream from 'effect/Stream'
import { toast } from 'sonner'
import { afterEach, describe, expect, it, vi } from 'vitest'

import * as audio from '@/player/audio'

import { makeState, push, renderSession, withPlanRevision } from './session-harness'

vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }),
}))

vi.mock('@/player/audio', () => ({
  audioState: vi.fn(() => 'on'),
  unlockAudio: vi.fn(() => 'on'),
  beepWork: vi.fn(),
  beepRest: vi.fn(),
  beepReady: vi.fn(),
  beepDone: vi.fn(),
  beepCountdown: vi.fn(),
}))

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

/**
 * The transient notice the player raises when a plan change lands: driven by
 * the snapshot's `planRevision`, one notice per rise, and never a sound.
 */

describe('SessionScreen — plan-change notice', () => {
  /** A snapshot mid-work, after `revision` plan changes, the last by `changedBy`. */
  const runningNow = (id: SessionId, revision = 0, changedBy = 'Ann') => {
    const base = makeState(
      id,
      new TimerRunning({ segmentIndex: 1, endsAtMillis: Date.now() + 30_000 }),
      Date.now(),
    )
    return revision === 0 ? base : withPlanRevision(base, revision, changedBy)
  }

  it('raises one notice per applied change, naming who changed it and beeping nothing', async () => {
    const id = 'sess-notice'
    const sessionId = Schema.decodeSync(SessionId)(id)
    const queue = Effect.runSync(Queue.unbounded<SessionState>())
    renderSession(id, { WatchSession: () => Stream.fromQueue(queue) })

    await push(queue, runningNow(sessionId))
    await screen.findByTestId('session-screen')
    expect(toast).not.toHaveBeenCalled()

    await push(queue, runningNow(sessionId, 1, 'Ann'))
    await waitFor(() => {
      expect(toast).toHaveBeenCalledTimes(1)
    })
    const notice = vi.mocked(toast).mock.calls[0]
    expect(notice[0]).toBe('The plan changed')
    expect(notice[1]?.description).toBe('Ann updated this workout.')

    // A join or a leave republishes the snapshot at the same revision. That
    // is not a change, so it raises nothing.
    await push(queue, runningNow(sessionId, 1, 'Ann'))
    expect(toast).toHaveBeenCalledTimes(1)

    // A second change is a second notice.
    await push(queue, runningNow(sessionId, 2, 'Ben'))
    await waitFor(() => {
      expect(toast).toHaveBeenCalledTimes(2)
    })

    // The notice adds no sound of its own. The only beeps are the segment
    // cues that were already there: one for the first work interval, and one
    // for each of the two the applied changes put the participant into. The
    // republish in between is not a new interval, so it stays silent.
    expect(audio.beepWork).toHaveBeenCalledTimes(3)
    expect(audio.beepRest).not.toHaveBeenCalled()
    expect(audio.beepReady).not.toHaveBeenCalled()
    expect(audio.beepDone).not.toHaveBeenCalled()
  })

  it('a participant who joins after a change gets no notice for it', async () => {
    const id = 'sess-late'
    const sessionId = Schema.decodeSync(SessionId)(id)
    const queue = Effect.runSync(Queue.unbounded<SessionState>())
    renderSession(id, { WatchSession: () => Stream.fromQueue(queue) })

    // Their first snapshot already carries three changes — all of them
    // landed before they were here.
    await push(queue, runningNow(sessionId, 3, 'Ann'))
    await screen.findByTestId('session-screen')
    expect(toast).not.toHaveBeenCalled()
  })
})
