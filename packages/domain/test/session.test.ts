import { describe, it } from '@effect/vitest'
import * as DateTime from 'effect/DateTime'
import * as Effect from 'effect/Effect'
import * as Schema from 'effect/Schema'
import { expect } from 'vitest'

import { UserId } from '../src/auth.js'
import { WorkoutId } from '../src/library.js'
import {
  CompiledWorkout,
  ReadySegment,
  RestSegment,
  WorkContext,
  WorkSegment,
} from '../src/segments.js'
import {
  Participant,
  SessionCommand,
  SessionId,
  SessionState,
  SessionSummary,
} from '../src/session.js'
import { TimerRunning } from '../src/timer.js'
import { Station } from '../src/workout.js'

const station = new Station({ name: 'Burpee' })
const workContext = (workIndex: number) =>
  new WorkContext({ station, podIndex: 0, podName: 'Pod 1', stationInPod: 1, round: 1, workIndex })

// ready(5s), work(10s), rest(5s), work(10s) — minimal compiled fixture.
const segments = [
  new ReadySegment({ durationMillis: 5000 }),
  new WorkSegment({ durationMillis: 10_000, work: workContext(0) }),
  new RestSegment({ durationMillis: 5000, nextWork: workContext(1) }),
  new WorkSegment({ durationMillis: 10_000, work: workContext(1) }),
] as const

const compiled = new CompiledWorkout({
  segments,
  workTotal: 2,
  totalDurationMillis: 30_000,
})

describe('SessionState', () => {
  it.effect('round-trips through encode/decode', () =>
    Effect.gen(function* () {
      const host = new Participant({
        userId: Schema.decodeSync(UserId)('user-1'),
        displayName: 'Alex',
      })
      const original = new SessionState({
        id: Schema.decodeSync(SessionId)('session-1'),
        host,
        workoutName: 'Athletica',
        compiled,
        timer: new TimerRunning({ segmentIndex: 1, endsAtMillis: 12_345 }),
        serverNow: 10_000,
        participants: [host],
        planRevision: 2,
        planChangedBy: 'Alex',
        ended: null,
      })

      const encoded = yield* Schema.encode(SessionState)(original)
      const decoded = yield* Schema.decodeUnknown(SessionState)(encoded)

      expect(decoded).toStrictEqual(original)
    }),
  )
})

describe('SessionSummary', () => {
  it.effect('round-trips through encode/decode', () =>
    Effect.gen(function* () {
      const original = new SessionSummary({
        id: Schema.decodeSync(SessionId)('session-1'),
        workoutId: Schema.decodeSync(WorkoutId)('workout-1'),
        hostDisplayName: 'Alex',
        workoutName: 'Athletica',
        startedAt: yield* DateTime.now,
        participantCount: 3,
      })

      const encoded = yield* Schema.encode(SessionSummary)(original)
      const decoded = yield* Schema.decodeUnknown(SessionSummary)(encoded)

      expect(decoded).toStrictEqual(original)
    }),
  )
})

describe('SessionCommand', () => {
  it.effect('rejects an unknown literal', () =>
    Effect.gen(function* () {
      const result = yield* Effect.either(Schema.decodeUnknown(SessionCommand)('bogus'))
      expect(result._tag).toBe('Left')
    }),
  )
})
