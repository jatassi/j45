import { describe, expect, it } from '@effect/vitest'
import {
  Flow,
  Participant,
  Pod,
  Reflow,
  ReflowPod,
  ReflowRequest,
  Round,
  Station,
  Workout,
  type SessionId,
} from '@j45/domain'
import * as Effect from 'effect/Effect'
import * as Exit from 'effect/Exit'
import * as Queue from 'effect/Queue'
import * as Stream from 'effect/Stream'
import * as TestClock from 'effect/TestClock'

import { LiveSessions } from '../../src/session/live-sessions.js'
import { asOwner, bobId, FlowLive, headersFor, seedUser } from './plan-flow-harness.js'

/**
 * Deleting a library workout that live sessions run, observed only where a
 * user can see it: the sessions the lobby still lists, and the history rows
 * each participant keeps. The notification seam between the library handlers
 * and `LiveSessions` is deliberately never touched here — it is
 * implementation.
 */

/** One pod of two stations, one round of 10s work and 5s rest. */
const makeWorkout = (name: string) =>
  new Workout({
    name,
    focus: 'cardio',
    pods: [
      new Pod({ name: 'P', stations: [new Station({ name: 'A' }), new Station({ name: 'B' })] }),
    ],
    flow: new Flow({ type: 'laps', rounds: [new Round({ workSeconds: 10, restSeconds: 5 })] }),
  })

const bob = new Participant({ userId: bobId, displayName: 'Bob' })

/** The station names of a stored workout, in order. */
const stationsOf = (workout: Workout): readonly string[] =>
  workout.pods.flatMap((pod) => pod.stations.map((station) => station.name))

/** Whether the lobby still lists a session. */
const isLive = (svc: LiveSessions, id: SessionId) =>
  Effect.map(svc.list(), (rows) => rows.some((row) => row.id === id))

describe('deleting a workout that live sessions run', () => {
  it.scoped('ends every session that tracks the deleted workout, and no other', () =>
    Effect.gen(function* () {
      const { headers, library, sessions } = yield* asOwner
      yield* seedUser(bob.userId, 'Bob')
      const doomed = yield* library.CreateWorkout({ workout: makeWorkout('Doomed') }, { headers })
      const other = yield* library.CreateWorkout({ workout: makeWorkout('Other') }, { headers })

      const first = yield* sessions.StartSession({ workoutId: doomed.id }, { headers })
      const second = yield* sessions.StartSession({ workoutId: doomed.id }, { headers })
      const elsewhere = yield* sessions.StartSession({ workoutId: other.id }, { headers })

      yield* library.DeleteWorkout({ id: doomed.id }, { headers })

      const svc = yield* LiveSessions
      expect(yield* isLive(svc, first.id)).toBe(false)
      expect(yield* isLive(svc, second.id)).toBe(false)
      expect(yield* isLive(svc, elsewhere.id)).toBe(true)

      // A session that ended is gone, not merely hidden from the lobby.
      expect(Exit.isFailure(yield* Effect.exit(svc.snapshot(first.id)))).toBe(true)
    }).pipe(Effect.provide(FlowLive)),
  )

  it.scoped('a session launched with a reflow overlay tracks nothing, so it survives', () =>
    Effect.gen(function* () {
      const { headers, library, sessions } = yield* asOwner
      const created = yield* library.CreateWorkout({ workout: makeWorkout('Doomed') }, { headers })
      const overlaid = yield* sessions.StartSession(
        {
          workoutId: created.id,
          reflow: new ReflowRequest({
            spec: new Reflow({
              pods: [new ReflowPod({ name: 'Only', stations: [0] })],
              flowType: 'laps',
            }),
            sourceUpdatedAt: created.updatedAt,
          }),
        },
        { headers },
      )

      yield* library.DeleteWorkout({ id: created.id }, { headers })

      // Its compiled plan was never in the library, so the library row going
      // away takes nothing from it.
      expect(yield* isLive(yield* LiveSessions, overlaid.id)).toBe(true)
    }).pipe(Effect.provide(FlowLive)),
  )

  it.scoped('a participant already watching is told the session ended, and that a plan went', () =>
    Effect.gen(function* () {
      const { headers, library, sessions } = yield* asOwner
      yield* seedUser(bob.userId, 'Bob')
      const created = yield* library.CreateWorkout({ workout: makeWorkout('Doomed') }, { headers })
      const started = yield* sessions.StartSession({ workoutId: created.id }, { headers })

      const svc = yield* LiveSessions
      // One open subscription, drained element by element.
      const queue = yield* Stream.toQueueOfElements(svc.watch(started.id, bob))
      const nextSnapshot = Effect.flatten(Queue.take(queue))
      const before = yield* nextSnapshot
      // A live session is not an ended one.
      expect(before.ended).toBe(null)

      yield* library.DeleteWorkout({ id: created.id }, { headers })

      // Delivered on the subscription the watcher already had. A deleted
      // plan is not the same ending as a session that simply stopped, and
      // the snapshot says which one this is.
      const last = yield* nextSnapshot
      expect(last.ended).toBe('plan-deleted')

      // And it is the last thing the watcher gets: the stream is over.
      expect(Exit.isFailure(yield* Effect.exit(nextSnapshot))).toBe(true)
    }).pipe(Effect.provide(FlowLive)),
  )

  it.scoped('a session that had progressed still records the work its people did', () =>
    Effect.gen(function* () {
      const { headers, history, library, sessions } = yield* asOwner
      yield* seedUser(bob.userId, 'Bob')
      const created = yield* library.CreateWorkout({ workout: makeWorkout('Doomed') }, { headers })
      const started = yield* sessions.StartSession({ workoutId: created.id }, { headers })

      const svc = yield* LiveSessions
      // Bob joins, so the session has two people to record, not one.
      yield* Stream.toQueueOfElements(svc.watch(started.id, bob))

      // Ready is 5s, so 10s puts the timer in the first work interval.
      yield* TestClock.adjust('10 seconds')
      yield* library.DeleteWorkout({ id: created.id }, { headers })

      // Everybody who was ever in the session keeps a row of their own.
      const bobHeaders = yield* headersFor(bob.userId)
      expect(yield* history.ListHistory(undefined, { headers: bobHeaders })).toHaveLength(1)

      const rows = yield* history.ListHistory(undefined, { headers })
      expect(rows).toHaveLength(1)
      const row = rows[0]
      if (row === undefined) {
        return
      }
      // Written from the plan the session last held, which the deleted
      // library row never owned: the name and the stations are still there.
      expect(row.workoutName).toBe('Doomed')
      expect(stationsOf(row.workout)).toEqual(['A', 'B'])
      expect(row.sessionId).toBe(started.id)
      // Ready, work A, rest, work B — four segments, one of them entered.
      expect(row.progress?.segmentsCompleted).toBe(1)
      expect(row.progress?.totalSegments).toBe(4)
    }).pipe(Effect.provide(FlowLive)),
  )

  it.scoped('a session still in the ready segment records nothing, as today', () =>
    Effect.gen(function* () {
      const { headers, history, library, sessions } = yield* asOwner
      const created = yield* library.CreateWorkout({ workout: makeWorkout('Doomed') }, { headers })
      const started = yield* sessions.StartSession({ workoutId: created.id }, { headers })

      // No clock movement: the timer never left the ready segment.
      yield* library.DeleteWorkout({ id: created.id }, { headers })

      expect(yield* isLive(yield* LiveSessions, started.id)).toBe(false)
      expect(yield* history.ListHistory(undefined, { headers })).toEqual([])
    }).pipe(Effect.provide(FlowLive)),
  )

  it.scoped('deleting a workout with no live session behaves exactly as before', () =>
    Effect.gen(function* () {
      const { headers, library } = yield* asOwner
      const created = yield* library.CreateWorkout({ workout: makeWorkout('Alone') }, { headers })

      yield* library.DeleteWorkout({ id: created.id }, { headers })

      const gone = yield* Effect.exit(library.GetWorkout({ id: created.id }, { headers }))
      expect(Exit.isFailure(gone)).toBe(true)
      expect(yield* (yield* LiveSessions).list()).toEqual([])
    }).pipe(Effect.provide(FlowLive)),
  )
})
