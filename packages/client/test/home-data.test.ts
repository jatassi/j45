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

import {
  listHistoryAtom,
  pickHero,
  recentRows,
  resolveWorkoutByName,
  startWorkoutAtom,
} from '@/lib/home'

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

const makeCompletion = (id: string, workoutName: string): SessionCompletion =>
  new SessionCompletion({
    id: Schema.decodeSync(CompletionId)(id),
    sessionId: Schema.decodeSync(SessionId)(`session-for-${id}`),
    workoutName,
    workout: makeWorkout(workoutName),
    host: alice,
    participants: [alice],
    startedAt: seededAt,
    endedAt: seededAt,
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

describe('resolveWorkoutByName', () => {
  it('matches case-insensitively and trims whitespace on both sides', () => {
    expect(resolveWorkoutByName('athletica', library)).toBe(athletica)
    expect(resolveWorkoutByName('  IRON CIRCUIT  ', library)).toBe(ironCircuit)
    expect(resolveWorkoutByName('Ladder Day', library)).toBe(ladderDay)
  })

  it('returns undefined when no library workout matches the name', () => {
    expect(resolveWorkoutByName('Deleted Workout', library)).toBeUndefined()
    expect(resolveWorkoutByName('', library)).toBeUndefined()
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
    const history = [makeCompletion('c-1', 'Athletica')]

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
      makeCompletion('c-head', 'Iron Circuit'),
      makeCompletion('c-older', 'Athletica'),
    ]

    const pick = pickHero([], history, library)

    expect(pick).toEqual({ _tag: 'start-last', workout: ironCircuit })
  })

  it('falls through to browse when history head does not resolve (renamed/deleted workout)', () => {
    const history = [makeCompletion('c-gone', 'Deleted Workout')]

    const pick = pickHero([], history, library)

    expect(pick).toEqual({ _tag: 'browse', workout: athletica })
  })

  it('picks browse with the first library workout when sessions and history are empty', () => {
    const pick = pickHero([], [], library)

    expect(pick).toEqual({ _tag: 'browse', workout: athletica })
  })

  it('picks browse with workout: undefined on an empty library without throwing', () => {
    const history = [makeCompletion('c-1', 'Anything')]

    expect(() => pickHero([], history, [])).not.toThrow()
    expect(pickHero([], history, [])).toEqual({ _tag: 'browse', workout: undefined })
    expect(pickHero([], [], [])).toEqual({ _tag: 'browse', workout: undefined })
  })
})

describe('recentRows', () => {
  it('returns distinct name-resolved history workouts in history order', () => {
    const history = [
      makeCompletion('c-1', 'Iron Circuit'),
      makeCompletion('c-2', 'iron circuit'), // same library workout, different casing
      makeCompletion('c-3', 'Ladder Day'),
      makeCompletion('c-4', 'Athletica'),
    ]

    const rows = recentRows(history, library, 3)

    expect(rows).toEqual([ironCircuit, ladderDay, athletica])
  })

  it('skips unresolvable history entries and pads remaining slots from the library without duplicates', () => {
    const history = [makeCompletion('c-1', 'Iron Circuit'), makeCompletion('c-2', 'Gone Workout')]

    // count=4: history contributes Iron Circuit only; pad with Athletica, Ladder Day
    // (library order, skipping Iron Circuit already present).
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
