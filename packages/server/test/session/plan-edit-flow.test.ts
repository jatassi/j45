import { describe, expect, it } from '@effect/vitest'
import {
  Participant,
  Reflow,
  ReflowPod,
  ReflowRequest,
  type SessionState,
  type WorkContext,
  type Workout,
} from '@j45/domain'
import * as Effect from 'effect/Effect'
import * as Queue from 'effect/Queue'
import * as Stream from 'effect/Stream'
import * as TestClock from 'effect/TestClock'

import { LiveSessions } from '../../src/session/live-sessions.js'
import {
  asOwner,
  bobId,
  caraId,
  FlowLive,
  latestWith,
  makeWorkout,
  running,
  seedUser,
  snapshotOf,
  stationNames,
} from './plan-flow-harness.js'

/**
 * Editing the content of a library workout that live sessions run, observed
 * only where a user can see it: the session snapshot each participant holds.
 * The notification seam between the library handlers and `LiveSessions` is
 * deliberately never touched here — it is implementation.
 *
 * Every test drives the clock with `TestClock`, so a segment boundary is an
 * exact instant rather than a wall-clock guess.
 */

const bob = new Participant({ userId: bobId, displayName: 'Bob' })
const cara = new Participant({ userId: caraId, displayName: 'Cara' })

/** The station names of a stored workout, in order. */
const stationsOf = (workout: Workout): readonly string[] =>
  workout.pods.flatMap((pod) => pod.stations.map((station) => station.name))

/** The work in focus for a snapshot: a work segment's own, a rest's next. */
const workInFocus = (state: SessionState): WorkContext | undefined => {
  const timer = state.timer
  if (timer._tag !== 'running' && timer._tag !== 'paused') {
    return undefined
  }
  const segment = state.compiled.segments.at(timer.segmentIndex)
  if (segment === undefined || segment._tag === 'ready') {
    return undefined
  }
  return segment._tag === 'work' ? segment.work : segment.nextWork
}

describe('editing a workout that live sessions run', () => {
  it.scoped('the edit waits for the next segment boundary, then re-anchors the deadline', () =>
    Effect.gen(function* () {
      const { headers, library, sessions } = yield* asOwner
      const created = yield* library.CreateWorkout(
        { workout: makeWorkout(['A', 'B']) },
        { headers },
      )
      const started = yield* sessions.StartSession({ workoutId: created.id }, { headers })
      const svc = yield* LiveSessions

      // t=7s: ready (0–5s) is over, the first work runs until 15s.
      yield* TestClock.adjust('7 seconds')
      const midWork = yield* snapshotOf(svc, started.id)
      expect(running(midWork)?.segmentIndex).toBe(1)
      expect(running(midWork)?.endsAtMillis).toBe(15_000)

      // The host renames both stations and stretches the rest to 8s.
      yield* library.UpdateWorkout(
        {
          id: created.id,
          workout: makeWorkout(['A2', 'B2'], { restSeconds: 8 }),
          updatedAt: created.updatedAt,
        },
        { headers },
      )

      // Nothing is yanked mid-interval: the current segment is untouched.
      const during = yield* snapshotOf(svc, started.id)
      expect(stationNames(during)).toEqual(['A', 'B'])
      expect(running(during)?.segmentIndex).toBe(1)
      expect(running(during)?.endsAtMillis).toBe(15_000)

      // t=15s: the work ends. The new plan takes over at that boundary.
      yield* TestClock.adjust('8 seconds')
      const after = yield* snapshotOf(svc, started.id)
      expect(stationNames(after)).toEqual(['A2', 'B2'])
      // The rest before work 1, at the new plan's own 8s duration, anchored
      // on the boundary instant — not chained off the old 5s deadline.
      expect(running(after)?.segmentIndex).toBe(2)
      expect(running(after)?.endsAtMillis).toBe(23_000)
    }).pipe(Effect.provide(FlowLive)),
  )

  it.scoped('the participant keeps their work ordinal when the segment indices move', () =>
    Effect.gen(function* () {
      const { headers, library, sessions } = yield* asOwner
      // ready 5s | A 10s | rest 5s | B 10s | rest 5s | C 10s — six segments.
      const created = yield* library.CreateWorkout(
        { workout: makeWorkout(['A', 'B', 'C']) },
        { headers },
      )
      const started = yield* sessions.StartSession({ workoutId: created.id }, { headers })
      const svc = yield* LiveSessions

      // t=32s: the rest before the third work (ordinal 2), which ends at 35s.
      yield* TestClock.adjust('32 seconds')
      expect(workInFocus(yield* snapshotOf(svc, started.id))?.workIndex).toBe(2)

      // The host drops every rest and doubles the work — the third station
      // moves from segment 5 to segment 3, and keeps ordinal 2.
      yield* library.UpdateWorkout(
        {
          id: created.id,
          workout: makeWorkout(['A', 'B', 'C2'], { workSeconds: 20, restSeconds: 0 }),
          updatedAt: created.updatedAt,
        },
        { headers },
      )

      yield* TestClock.adjust('3 seconds')
      const after = yield* snapshotOf(svc, started.id)
      // Same distance into the plan, on the station now at that distance —
      // never back to a station this participant already finished.
      expect(workInFocus(after)?.workIndex).toBe(2)
      expect(workInFocus(after)?.station.name).toBe('C2')
      expect(running(after)?.segmentIndex).toBe(3)
      // The countdown matches the segment actually in force: the new 20s
      // work, from the boundary — not the old plan's 10s.
      expect(running(after)?.endsAtMillis).toBe(55_000)
    }).pipe(Effect.provide(FlowLive)),
  )

  it.scoped('the revision counter rises only when a change actually lands', () =>
    Effect.gen(function* () {
      const { headers, library, sessions } = yield* asOwner
      yield* seedUser(bob.userId, 'Bob')
      const created = yield* library.CreateWorkout(
        { workout: makeWorkout(['A', 'B']) },
        { headers },
      )
      const started = yield* sessions.StartSession({ workoutId: created.id }, { headers })
      const svc = yield* LiveSessions
      const revision = Effect.map(snapshotOf(svc, started.id), (state) => state.planRevision)

      expect(yield* revision).toBe(0)

      // A join republishes the snapshot. It is not a plan change.
      const queue = yield* Stream.toQueueOfElements(svc.watch(started.id, bob))
      const nextSnapshot = Effect.flatten(Queue.take(queue))
      expect((yield* nextSnapshot).planRevision).toBe(0)

      // A rename republishes the snapshot too, and raises no notice.
      yield* library.RenameWorkout({ id: created.id, name: 'Renamed' }, { headers })
      expect((yield* nextSnapshot).planRevision).toBe(0)

      // A content edit raises the notice — but only once it is in force.
      const edited = yield* library.UpdateWorkout(
        { id: created.id, workout: makeWorkout(['A2', 'B2']), updatedAt: created.updatedAt },
        { headers },
      )
      yield* TestClock.adjust('4 seconds')
      expect(yield* revision).toBe(0)

      yield* TestClock.adjust('2 seconds')
      const applied = yield* snapshotOf(svc, started.id)
      expect(applied.planRevision).toBe(1)
      // Named for the notice: whoever saved the edit.
      expect(applied.planChangedBy).toBe('Owner')

      // A leave republishes the snapshot. Still one change, still one notice.
      yield* svc.leaveSession(started.id, bob.userId)
      expect(yield* revision).toBe(1)

      // A second edit is a second notice, once it lands at the next boundary.
      yield* library.UpdateWorkout(
        { id: created.id, workout: makeWorkout(['A3', 'B3']), updatedAt: edited.updatedAt },
        { headers },
      )
      yield* TestClock.adjust('20 seconds')
      expect(yield* revision).toBe(2)
    }).pipe(Effect.provide(FlowLive)),
  )

  it.scoped('a session launched with a reflow overlay is unaffected by the edit', () =>
    Effect.gen(function* () {
      const { headers, library, sessions } = yield* asOwner
      const created = yield* library.CreateWorkout(
        { workout: makeWorkout(['A', 'B']) },
        { headers },
      )
      // The overlay runs one station of the source. That plan was never in
      // the library, and a reflow spec is positional, so re-applying it to an
      // edited workout would silently yield a different station.
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
      const tracking = yield* sessions.StartSession({ workoutId: created.id }, { headers })

      yield* library.UpdateWorkout(
        { id: created.id, workout: makeWorkout(['A2', 'B2']), updatedAt: created.updatedAt },
        { headers },
      )
      yield* TestClock.adjust('10 seconds')

      const svc = yield* LiveSessions
      const overlay = yield* snapshotOf(svc, overlaid.id)
      expect(stationNames(overlay)).toEqual(['A'])
      expect(overlay.planRevision).toBe(0)
      // The session that does track the same workout took the edit, so this
      // is an exemption rather than a change that never arrived.
      expect(stationNames(yield* snapshotOf(svc, tracking.id))).toEqual(['A2', 'B2'])
    }).pipe(Effect.provide(FlowLive)),
  )

  it.scoped('every participant takes the change at the same point, reconnect included', () =>
    Effect.gen(function* () {
      const { headers, library, sessions } = yield* asOwner
      yield* seedUser(bob.userId, 'Bob')
      yield* seedUser(cara.userId, 'Cara')
      const created = yield* library.CreateWorkout(
        { workout: makeWorkout(['A', 'B']) },
        { headers },
      )
      const started = yield* sessions.StartSession({ workoutId: created.id }, { headers })
      const svc = yield* LiveSessions

      const forBob = yield* Stream.toQueueOfElements(svc.watch(started.id, bob))
      const forCara = yield* Stream.toQueueOfElements(svc.watch(started.id, cara))
      // Drain to the snapshot each of them holds right now.
      yield* Stream.runCollect(Stream.fromQueue(forBob).pipe(Stream.take(1)))
      yield* Stream.runCollect(Stream.fromQueue(forCara).pipe(Stream.take(1)))

      yield* library.UpdateWorkout(
        { id: created.id, workout: makeWorkout(['A2', 'B2']), updatedAt: created.updatedAt },
        { headers },
      )
      yield* TestClock.adjust('6 seconds')

      // Both phones land on one plan at one revision — they never disagree.
      const bobState = yield* latestWith(forBob, (state) => state.planRevision === 1)
      const caraState = yield* latestWith(forCara, (state) => state.planRevision === 1)
      expect(stationNames(bobState)).toEqual(['A2', 'B2'])
      expect(caraState.compiled).toEqual(bobState.compiled)
      expect(caraState.timer).toEqual(bobState.timer)

      // A participant reconnecting gets the current plan in the fresh
      // snapshot, not the plan the session started on.
      const rejoined = yield* Stream.runHead(svc.watch(started.id, bob))
      expect(stationNames(yield* rejoined)).toEqual(['A2', 'B2'])
    }).pipe(Effect.provide(FlowLive)),
  )

  it.scoped('editing a workout with no live session behaves exactly as before', () =>
    Effect.gen(function* () {
      const { headers, library } = yield* asOwner
      const created = yield* library.CreateWorkout(
        { workout: makeWorkout(['A', 'B']) },
        { headers },
      )

      const updated = yield* library.UpdateWorkout(
        { id: created.id, workout: makeWorkout(['A2', 'B2']), updatedAt: created.updatedAt },
        { headers },
      )

      expect(stationsOf(updated.workout)).toEqual(['A2', 'B2'])
      const read = yield* library.GetWorkout({ id: created.id }, { headers })
      expect(stationsOf(read.workout)).toEqual(['A2', 'B2'])
      expect(yield* (yield* LiveSessions).list()).toEqual([])
    }).pipe(Effect.provide(FlowLive)),
  )

  it.scoped('a save that only renames the workout applies at once and raises no notice', () =>
    Effect.gen(function* () {
      const { headers, library, sessions } = yield* asOwner
      const created = yield* library.CreateWorkout(
        { workout: makeWorkout(['A', 'B']) },
        { headers },
      )
      const started = yield* sessions.StartSession({ workoutId: created.id }, { headers })
      const svc = yield* LiveSessions

      yield* TestClock.adjust('7 seconds')
      const before = yield* snapshotOf(svc, started.id)

      // The editor saves the whole workout, so a name typed there arrives as
      // a content save. It compiles to the plan already in force, so it is a
      // rename and nothing more.
      yield* library.UpdateWorkout(
        {
          id: created.id,
          workout: makeWorkout(['A', 'B'], {}, 'Renamed'),
          updatedAt: created.updatedAt,
        },
        { headers },
      )

      const after = yield* snapshotOf(svc, started.id)
      expect(after.workoutName).toBe('Renamed')
      // At once, with no interval touched and no notice raised.
      expect(after.timer).toEqual(before.timer)
      expect(after.compiled).toEqual(before.compiled)
      expect(after.planRevision).toBe(0)

      // And the boundary that follows holds nothing back either.
      yield* TestClock.adjust('10 seconds')
      expect((yield* snapshotOf(svc, started.id)).planRevision).toBe(0)
    }).pipe(Effect.provide(FlowLive)),
  )

  it.scoped('saving content the host did not change raises no notice', () =>
    Effect.gen(function* () {
      const { headers, library, sessions } = yield* asOwner
      const created = yield* library.CreateWorkout(
        { workout: makeWorkout(['A', 'B']) },
        { headers },
      )
      const started = yield* sessions.StartSession({ workoutId: created.id }, { headers })
      const svc = yield* LiveSessions

      yield* library.UpdateWorkout(
        { id: created.id, workout: makeWorkout(['A', 'B']), updatedAt: created.updatedAt },
        { headers },
      )
      yield* TestClock.adjust('20 seconds')

      // The revision counts changes, not saves.
      expect((yield* snapshotOf(svc, started.id)).planRevision).toBe(0)
    }).pipe(Effect.provide(FlowLive)),
  )
})
