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
import * as Queue from 'effect/Queue'
import * as Stream from 'effect/Stream'
import * as TestClock from 'effect/TestClock'

import { LiveSessions } from '../../src/session/live-sessions.js'
import { asOwner, bobId, FlowLive, lobbyNow, seedUser } from './plan-flow-harness.js'

/**
 * Renaming a library workout, observed only where a user can see it: the
 * session snapshot each participant holds, and the lobby listing. The
 * notification seam between the library handlers and `LiveSessions` is
 * deliberately never touched here — it is implementation.
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

/** The lobby row for one session, by id. */
const lobbyRow = (svc: LiveSessions, id: SessionId) =>
  Effect.map(lobbyNow(svc), (rows) => rows.find((row) => row.id === id))

describe('renaming a workout and its live sessions', () => {
  it.scoped('every session on the renamed workout shows the new name, in snapshot and lobby', () =>
    Effect.gen(function* () {
      const { headers, library, sessions } = yield* asOwner
      const renamed = yield* library.CreateWorkout({ workout: makeWorkout('Old') }, { headers })
      const untouched = yield* library.CreateWorkout({ workout: makeWorkout('Other') }, { headers })

      const first = yield* sessions.StartSession({ workoutId: renamed.id }, { headers })
      const second = yield* sessions.StartSession({ workoutId: renamed.id }, { headers })
      const elsewhere = yield* sessions.StartSession({ workoutId: untouched.id }, { headers })

      yield* library.RenameWorkout({ id: renamed.id, name: 'New' }, { headers })

      const svc = yield* LiveSessions
      // Both sessions on the renamed workout, and only those.
      expect((yield* svc.snapshot(first.id)).workoutName).toBe('New')
      expect((yield* svc.snapshot(second.id)).workoutName).toBe('New')
      expect((yield* svc.snapshot(elsewhere.id)).workoutName).toBe('Other')

      expect((yield* lobbyRow(svc, first.id))?.workoutName).toBe('New')
      expect((yield* lobbyRow(svc, second.id))?.workoutName).toBe('New')
      expect((yield* lobbyRow(svc, elsewhere.id))?.workoutName).toBe('Other')
    }).pipe(Effect.provide(FlowLive)),
  )

  it.scoped('a participant already watching receives the new name without reconnecting', () =>
    Effect.gen(function* () {
      const { headers, library, sessions } = yield* asOwner
      yield* seedUser(bob.userId, 'Bob')
      const created = yield* library.CreateWorkout({ workout: makeWorkout('Old') }, { headers })
      const started = yield* sessions.StartSession({ workoutId: created.id }, { headers })

      const svc = yield* LiveSessions
      // One open subscription, drained element by element: the snapshot the
      // watcher already holds, then the next one the server sends it.
      const queue = yield* Stream.toQueueOfElements(svc.watch(started.id, bob))
      const nextSnapshot = Effect.flatten(Queue.take(queue))
      const before = yield* nextSnapshot
      expect(before.workoutName).toBe('Old')

      yield* library.RenameWorkout({ id: created.id, name: 'New' }, { headers })

      // Delivered on the subscription the watcher already had — no reconnect.
      const after = yield* nextSnapshot
      expect(after.workoutName).toBe('New')

      // A rename raises no plan-changed notice: nothing else about the
      // session moves — same timer, same plan, same participants.
      expect(after.timer).toEqual(before.timer)
      expect(after.compiled).toEqual(before.compiled)
      expect(after.participants).toEqual(before.participants)
    }).pipe(Effect.provide(FlowLive)),
  )

  it.scoped('a session launched with a reflow overlay tracks nothing, so the rename skips it', () =>
    Effect.gen(function* () {
      const { headers, library, sessions } = yield* asOwner
      const created = yield* library.CreateWorkout({ workout: makeWorkout('Old') }, { headers })
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

      yield* library.RenameWorkout({ id: created.id, name: 'New' }, { headers })

      const svc = yield* LiveSessions
      expect((yield* svc.snapshot(overlaid.id)).workoutName).toBe('Old')
    }).pipe(Effect.provide(FlowLive)),
  )

  it.scoped('a session whose timer is done keeps the name it finished under', () =>
    Effect.gen(function* () {
      const { headers, library, sessions } = yield* asOwner
      const created = yield* library.CreateWorkout({ workout: makeWorkout('Old') }, { headers })
      const started = yield* sessions.StartSession({ workoutId: created.id }, { headers })

      const svc = yield* LiveSessions
      // Ready 5s, work 10s, rest 5s, work 10s — 30s runs the timer to done.
      yield* TestClock.adjust('30 seconds')
      expect((yield* svc.snapshot(started.id)).timer._tag).toBe('done')

      yield* library.RenameWorkout({ id: created.id, name: 'New' }, { headers })

      // The plan freezes at done, so a later rename never reaches the
      // session — and never reaches the completion row it will write.
      expect((yield* svc.snapshot(started.id)).workoutName).toBe('Old')
    }).pipe(Effect.provide(FlowLive)),
  )

  it.scoped('renaming a workout with no live session behaves exactly as before', () =>
    Effect.gen(function* () {
      const { headers, library } = yield* asOwner
      const created = yield* library.CreateWorkout({ workout: makeWorkout('Old') }, { headers })

      const result = yield* library.RenameWorkout({ id: created.id, name: 'New' }, { headers })

      expect(result.workout.name).toBe('New')
      expect((yield* library.GetWorkout({ id: created.id }, { headers })).workout.name).toBe('New')
      expect(yield* lobbyNow(yield* LiveSessions)).toEqual([])
    }).pipe(Effect.provide(FlowLive)),
  )
})
