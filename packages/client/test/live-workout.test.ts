// @vitest-environment jsdom
import { SessionId, SessionSummary, WorkoutId } from '@j45/domain'
import * as DateTime from 'effect/DateTime'
import * as Schema from 'effect/Schema'
import { describe, expect, it } from 'vitest'

import {
  liveDeleteWarning,
  liveSaveWarning,
  liveSessionCount,
  liveSessionPhrase,
} from '@/lib/live-workout'

const startedAt = DateTime.unsafeMake('2026-01-01T00:00:00.000Z')
const athletica = Schema.decodeSync(WorkoutId)('workout-athletica')
const ladder = Schema.decodeSync(WorkoutId)('workout-ladder')

const summaryOf = (id: string, workoutId: WorkoutId) =>
  new SessionSummary({
    id: Schema.decodeSync(SessionId)(id),
    workoutId,
    hostDisplayName: 'Alex',
    workoutName: 'Athletica',
    startedAt,
    participantCount: 2,
  })

describe('liveSessionCount', () => {
  it('counts only the lobby rows whose workoutId matches', () => {
    const sessions = [
      summaryOf('session-a', athletica),
      summaryOf('session-b', ladder),
      summaryOf('session-c', athletica),
    ]
    expect(liveSessionCount(sessions, athletica)).toBe(2)
    expect(liveSessionCount(sessions, ladder)).toBe(1)
  })

  it('is 0 for a workout no session runs, and for an empty lobby', () => {
    expect(liveSessionCount([summaryOf('session-a', ladder)], athletica)).toBe(0)
    expect(liveSessionCount([], athletica)).toBe(0)
  })
})

describe('liveSessionPhrase', () => {
  it('agrees the noun with the count', () => {
    expect(liveSessionPhrase(1)).toBe('1 live session')
    expect(liveSessionPhrase(2)).toBe('2 live sessions')
  })
})

describe('the prompt wording', () => {
  it('states the number of sessions the save changes', () => {
    expect(liveSaveWarning(1)).toContain('1 live session')
    expect(liveSaveWarning(3)).toContain('3 live sessions')
  })

  it('warns the delete stops the sessions and cannot be undone', () => {
    const text = liveDeleteWarning(2)
    expect(text).toContain('2 live sessions')
    expect(text).toContain('stop')
    expect(text).toContain('cannot undo')
  })
})
