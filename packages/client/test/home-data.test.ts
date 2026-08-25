// @vitest-environment jsdom
import {
  CompletionId,
  Flow,
  LibraryWorkout,
  Participant,
  Pod,
  Round,
  SessionCompletion,
  SessionId,
  SessionSummary,
  Station,
  UserId,
  Workout,
  WorkoutId,
} from '@j45/domain'
import * as DateTime from 'effect/DateTime'
import * as Schema from 'effect/Schema'
import { describe, expect, it } from 'vitest'

import { listHistoryAtom, pickHero, recentRows, startWorkoutAtom } from '@/lib/home'

const seededAt = DateTime.unsafeMake('2026-01-01T00:00:00.000Z')

const makeWorkout = (name: string): Workout =>
  new Workout({
    name,
    focus: 'cardio',
    pods: [new Pod({ name: 'Pod 1', stations: [new Station({ name: 'Burpee' })] })],
    flow: new Flow({
      type: 'laps',
      rounds: [new Round({ workSeconds: 40, restSeconds: 20 })],
    }),
  })

const makeLibraryWorkout = (id: string, name: string): LibraryWorkout =>
  new LibraryWorkout({
    id: Schema.decodeSync(WorkoutId)(id),
    workout: makeWorkout(name),
    createdAt: seededAt,
    updatedAt: seededAt,
  })

type SessionParts = {
  readonly id: string
  readonly workoutId: string
  readonly workoutName: string
  readonly startedAt: DateTime.Utc
}

const makeSession = (parts: SessionParts): SessionSummary =>
  new SessionSummary({
    id: Schema.decodeSync(SessionId)(parts.id),
    workoutId: Schema.decodeSync(WorkoutId)(parts.workoutId),
    hostDisplayName: 'Jordan',
    workoutName: parts.workoutName,
    startedAt: parts.startedAt,
    participantCount: 2,
  })

const alice = new Participant({
  userId: Schema.decodeSync(UserId)('user-alice'),
  displayName: 'Alice',
})

/**
 * A completion record. `sourceWorkoutId` is the identity Home joins on;
 * omitting it models a record written before identity existed. `workoutName`
 * is deliberately free to disagree with the library — the point of the join.
 */
const makeCompletion = (
  id: string,
  workoutName: string,
  sourceWorkoutId?: string,
): SessionCompletion =>
  new SessionCompletion({
    id: Schema.decodeSync(CompletionId)(id),
    sessionId: Schema.decodeSync(SessionId)(`session-for-${id}`),
    workoutName,
    workout: makeWorkout(workoutName),
    host: alice,
    participants: [alice],
    startedAt: seededAt,
    endedAt: seededAt,
    ...(sourceWorkoutId === undefined
      ? {}
      : { sourceWorkoutId: Schema.decodeSync(WorkoutId)(sourceWorkoutId) }),
  })

const athletica = makeLibraryWorkout('workout-athletica', 'Athletica')
const ironCircuit = makeLibraryWorkout('workout-iron', 'Iron Circuit')
const ladderDay = makeLibraryWorkout('workout-ladder', 'Ladder Day')
const library = [athletica, ironCircuit, ladderDay] as const

describe('home data helpers — module exports', () => {
  it('exports startWorkoutAtom and listHistoryAtom as module-scoped rpc atoms', () => {
    expect(startWorkoutAtom).toBeDefined()
    expect(listHistoryAtom).toBeDefined()
  })
})

describe('pickHero priority', () => {
  it('picks live when sessions are non-empty, even if history and library would pick start-last', () => {
    const older = makeSession({
      id: 'session-older',
      workoutId: 'workout-athletica',
      workoutName: 'Athletica',
      startedAt: DateTime.unsafeMake('2026-03-01T09:00:00.000Z'),
    })
    const newer = makeSession({
      id: 'session-newer',
      workoutId: 'workout-iron',
      workoutName: 'Iron Circuit',
      startedAt: DateTime.unsafeMake('2026-03-01T10:00:00.000Z'),
    })
    const history = [makeCompletion('c-1', 'Athletica', 'workout-athletica')]

    const pick = pickHero([older, newer], history, library)

    expect(pick._tag).toBe('live')
    if (pick._tag !== 'live') {
      throw new Error(`expected live pick, got ${pick._tag}`)
    }
    expect(pick.session).toBe(newer)
    expect(pick.extras).toEqual([older])
    expect(pick.workout).toBe(ironCircuit)
  })

  it('picks live with optional workout omitted when the session workout is not in the library', () => {
    const session = makeSession({
      id: 'session-orphan',
      workoutId: 'workout-gone',
      workoutName: 'Renamed Away',
      startedAt: DateTime.unsafeMake('2026-03-01T10:00:00.000Z'),
    })

    const pick = pickHero([session], [], library)

    expect(pick).toEqual({
      _tag: 'live',
      session,
      extras: [],
    })
  })

  it('attaches no library workout to another user’s session that shares a workout name', () => {
    const foreign = makeSession({
      id: 'session-foreign',
      // Another user's own copy of a same-named workout — a different id.
      workoutId: 'workout-their-iron',
      workoutName: 'Iron Circuit',
      startedAt: DateTime.unsafeMake('2026-03-01T10:00:00.000Z'),
    })

    const pick = pickHero([foreign], [], library)

    expect(pick).toEqual({ _tag: 'live', session: foreign, extras: [] })
  })

  it('picks start-last over browse when there are no live sessions and history head resolves', () => {
    const history = [
      makeCompletion('c-head', 'Iron Circuit', 'workout-iron'),
      makeCompletion('c-older', 'Athletica', 'workout-athletica'),
    ]

    const pick = pickHero([], history, library)

    expect(pick).toEqual({ _tag: 'start-last', workout: ironCircuit })
  })

  it('still resolves a completion of a workout that has since been renamed', () => {
    // The record keeps the name as run; the library entry has moved on.
    const history = [makeCompletion('c-renamed', 'Iron Circuit', 'workout-ladder')]

    expect(pickHero([], history, library)).toEqual({ _tag: 'start-last', workout: ladderDay })
  })

  it('picks the workout the record names by identity when two library workouts share a name', () => {
    const twin = makeLibraryWorkout('workout-iron-copy', 'Iron Circuit')
    const shared = [ironCircuit, twin] as const
    // Head-of-library `ironCircuit` is what a name match would have returned.
    const history = [makeCompletion('c-twin', 'Iron Circuit', 'workout-iron-copy')]

    expect(pickHero([], history, shared)).toEqual({ _tag: 'start-last', workout: twin })
  })

  it('walks past a completion of another user’s plan to the newest one that is the caller’s own', () => {
    const history = [
      // Newest: a session on a friend's plan — their id, a name the caller
      // also has. Resolving it would offer the caller's own copy as though it
      // were the workout just done.
      makeCompletion('c-foreign', 'Iron Circuit', 'workout-their-iron'),
      makeCompletion('c-mine', 'Athletica', 'workout-athletica'),
    ]

    expect(pickHero([], history, library)).toEqual({ _tag: 'start-last', workout: athletica })
  })

  it('walks past records that carry no identity at all', () => {
    const history = [
      // Written before completions carried identity — no honest join key.
      makeCompletion('c-legacy', 'Iron Circuit'),
      makeCompletion('c-mine', 'Ladder Day', 'workout-ladder'),
    ]

    expect(pickHero([], history, library)).toEqual({ _tag: 'start-last', workout: ladderDay })
  })

  it('falls through to browse when no completion in the history resolves', () => {
    const history = [
      makeCompletion('c-deleted', 'Deleted Workout', 'workout-deleted'),
      makeCompletion('c-legacy', 'Athletica'),
    ]

    const pick = pickHero([], history, library)

    expect(pick).toEqual({ _tag: 'browse', workout: athletica })
  })

  it('picks browse with the first library workout when sessions and history are empty', () => {
    const pick = pickHero([], [], library)

    expect(pick).toEqual({ _tag: 'browse', workout: athletica })
  })

  it('picks browse with workout: undefined on an empty library without throwing', () => {
    const history = [makeCompletion('c-1', 'Anything', 'workout-athletica')]

    expect(() => pickHero([], history, [])).not.toThrow()
    expect(pickHero([], history, [])).toEqual({ _tag: 'browse', workout: undefined })
    expect(pickHero([], [], [])).toEqual({ _tag: 'browse', workout: undefined })
  })
})

describe('recentRows', () => {
  it('returns distinct identity-resolved history workouts in history order', () => {
    const history = [
      makeCompletion('c-1', 'Iron Circuit', 'workout-iron'),
      // Same library workout under the name it had at the time.
      makeCompletion('c-2', 'Iron Circuit (old)', 'workout-iron'),
      makeCompletion('c-3', 'Ladder Day', 'workout-ladder'),
      makeCompletion('c-4', 'Athletica', 'workout-athletica'),
    ]

    const rows = recentRows(history, library, 3)

    expect(rows).toEqual([ironCircuit, ladderDay, athletica])
  })

  it('rows the workout the record identifies, not the first library entry sharing its name', () => {
    const twin = makeLibraryWorkout('workout-iron-copy', 'Iron Circuit')
    const shared = [ironCircuit, twin] as const
    const history = [makeCompletion('c-twin', 'Iron Circuit', 'workout-iron-copy')]

    expect(recentRows(history, shared, 1)).toEqual([twin])
  })

  it('skips a deleted workout, another user’s workout, and a record with no identity, then pads from the library', () => {
    const history = [
      makeCompletion('c-1', 'Iron Circuit', 'workout-iron'),
      makeCompletion('c-2', 'Gone Workout', 'workout-deleted'),
      // A friend's plan whose name collides with the caller's own copy.
      makeCompletion('c-3', 'Athletica', 'workout-their-athletica'),
      // Written before completions carried identity.
      makeCompletion('c-4', 'Ladder Day'),
    ]

    // count=4: history contributes Iron Circuit only; padding fills the rest
    // from the library in order, skipping what is already present.
    const rows = recentRows(history, library, 4)

    expect(rows).toEqual([ironCircuit, athletica, ladderDay])
    expect(new Set(rows.map((row) => row.id)).size).toBe(rows.length)
  })

  it('returns only library workouts (in library order) when history is empty', () => {
    expect(recentRows([], library, 2)).toEqual([athletica, ironCircuit])
  })

  it('returns an empty list when both history and library are empty', () => {
    expect(recentRows([], [], 5)).toEqual([])
  })
})
