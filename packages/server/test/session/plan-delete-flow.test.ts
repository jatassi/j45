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
import {
  asOwner,
  bobId,
  FlowLive,
  headersFor,
  latestWith,
  lobbyNow,
  seedUser,
} from './plan-flow-harness.js'

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
  Effect.map(lobbyNow(svc), (rows) => rows.some((row) => row.id === id))

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

  it.scoped('ends a session launched with a reflow overlay as well', () =>
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

      // A reflow overlay exempts a session from a *content* change, which can
      // never apply to a plan the library never held. A delete is not a
      // content change: the source is gone, so there is nothing left to
      // follow. The host is told the session stops, and it does.
      expect(yield* isLive(yield* LiveSessions, overlaid.id)).toBe(false)
    }).pipe(Effect.provide(FlowLive)),
  )

  it.scoped('leaves a reflow-launched session of another workout alone', () =>
    Effect.gen(function* () {
      const { headers, library, sessions } = yield* asOwner
      const doomed = yield* library.CreateWorkout({ workout: makeWorkout('Doomed') }, { headers })
      const other = yield* library.CreateWorkout({ workout: makeWorkout('Other') }, { headers })
      const overlaid = yield* sessions.StartSession(
        {
          workoutId: other.id,
          reflow: new ReflowRequest({
            spec: new Reflow({
              pods: [new ReflowPod({ name: 'Only', stations: [0] })],
              flowType: 'laps',
            }),
            sourceUpdatedAt: other.updatedAt,
          }),
        },
        { headers },
      )

      yield* library.DeleteWorkout({ id: doomed.id }, { headers })

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

  it.scoped('ends a session whose timer already finished as an ordinary close', () =>
    Effect.gen(function* () {
      const { headers, library, sessions } = yield* asOwner
      yield* seedUser(bob.userId, 'Bob')
      const created = yield* library.CreateWorkout({ workout: makeWorkout('Doomed') }, { headers })
      const started = yield* sessions.StartSession({ workoutId: created.id }, { headers })

      const svc = yield* LiveSessions
      const queue = yield* Stream.toQueueOfElements(svc.watch(started.id, bob))
      const nextSnapshot = Effect.flatten(Queue.take(queue))
      yield* nextSnapshot

      // ready 30s | A 10s | rest 5s | B 10s — the last rep ends at 55s, and
      // Bob is sitting on the finished screen.
      yield* TestClock.adjust('56 seconds')
      yield* latestWith(queue, (state) => state.timer._tag === 'done')

      yield* library.DeleteWorkout({ id: created.id }, { headers })

      // The session still ends. Only the reason changes: Bob completed the
      // workout, so nothing was taken from him, and a plan-deleted notice
      // would tell him his session was cut short when it was not.
      const last = yield* latestWith(queue, (state) => state.ended !== null)
      expect(last.ended).toBe('closed')
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

      // Ready is 30s, so 35s puts the timer in the first work interval.
      yield* TestClock.adjust('35 seconds')
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
      expect(yield* lobbyNow(yield* LiveSessions)).toEqual([])
    }).pipe(Effect.provide(FlowLive)),
  )
})
