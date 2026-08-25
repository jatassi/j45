import { describe, expect, it } from '@effect/vitest'
import { Workout, type Focus, type SessionCompletion } from '@j45/domain'
import * as Effect from 'effect/Effect'
import * as TestClock from 'effect/TestClock'

import { LiveSessions } from '../../src/session/live-sessions.js'
import { asOwner, FlowLive, makeWorkout, owner, paused, snapshotOf } from './plan-flow-harness.js'

/**
 * One rule, read where a user reads it: a completion records the last plan
 * applied while the timer was still live, and the progress on that row is
 * measured against that same plan.
 *
 * Every assertion here comes off `ListHistory`. The row is the whole point of
 * the feature, so nothing reaches into the handle to reach it.
 *
 * `makeWorkout(['A', 'B', 'C'])` compiles to ready 5s | A 10s | rest 5s |
 * B 10s | rest 5s | C 10s — six segments over 45s, with work ordinals 0, 1
 * and 2.
 */

/** The same workout under a new focus and note — the fields no segment reads. */
const withFocusAndNote = (workout: Workout, focus: Focus, note: string): Workout =>
  new Workout({
    name: workout.name,
    focus,
    note,
    pods: workout.pods,
    flow: workout.flow,
  })

/** The station names of the plan that one completion row recorded. */
const recordedStations = (row: SessionCompletion | undefined) =>
  row?.workout.pods.flatMap((pod) => pod.stations.map((station) => station.name))

describe('a completion of a session whose plan changed while the timer ran', () => {
  it.scoped('records the name the workout carried when the timer was last live', () =>
    Effect.gen(function* () {
      const { headers, history, library, sessions } = yield* asOwner
      const created = yield* library.CreateWorkout(
        { workout: makeWorkout(['A', 'B', 'C']) },
        { headers },
      )
      const started = yield* sessions.StartSession({ workoutId: created.id }, { headers })
      const svc = yield* LiveSessions

      yield* TestClock.adjust('7 seconds')
      yield* library.RenameWorkout({ id: created.id, name: 'Renamed' }, { headers })
      yield* svc.leaveSession(started.id, owner)

      const rows = yield* history.ListHistory(undefined, { headers })
      expect(rows[0]?.workoutName).toBe('Renamed')
      // One row holds one name: the stored plan carries the new name too.
      expect(rows[0]?.workout.name).toBe('Renamed')
    }).pipe(Effect.provide(FlowLive)),
  )

  it.scoped('records the edited plan, with its total segments counted afresh', () =>
    Effect.gen(function* () {
      const { headers, history, library, sessions } = yield* asOwner
      const created = yield* library.CreateWorkout(
        { workout: makeWorkout(['A', 'B', 'C']) },
        { headers },
      )
      const started = yield* sessions.StartSession({ workoutId: created.id }, { headers })
      const svc = yield* LiveSessions

      // The edit lands at the 15s boundary: four stations instead of three,
      // so the plan in force from then on holds eight segments, not six.
      yield* TestClock.adjust('7 seconds')
      yield* library.UpdateWorkout(
        {
          id: created.id,
          workout: makeWorkout(['A', 'B', 'C', 'D'], {}, 'Longer'),
          updatedAt: created.updatedAt,
        },
        { headers },
      )
      yield* TestClock.adjust('9 seconds')
      yield* svc.leaveSession(started.id, owner)

      const rows = yield* history.ListHistory(undefined, { headers })
      expect(rows).toHaveLength(1)
      expect(rows[0]?.workoutName).toBe('Longer')
      expect(recordedStations(rows[0])).toEqual(['A', 'B', 'C', 'D'])
      expect(rows[0]?.progress?.totalSegments).toBe(8)
      // Still the same work, so still the segment the remap put them in.
      expect(rows[0]?.progress?.segmentsCompleted).toBe(2)
    }).pipe(Effect.provide(FlowLive)),
  )
})

describe('a completion of a session edited only where no segment reads', () => {
  it.scoped('records the corrected focus and note beside the corrected name', () =>
    Effect.gen(function* () {
      const { headers, history, library, sessions } = yield* asOwner
      const created = yield* library.CreateWorkout(
        { workout: makeWorkout(['A', 'B', 'C']) },
        { headers },
      )
      const started = yield* sessions.StartSession({ workoutId: created.id }, { headers })
      const svc = yield* LiveSessions

      // Focus and note live on the stored plan and in no compiled segment,
      // so this edit compiles to exactly the plan already in force. Nothing
      // anybody runs changed — and the row still has to hold one plan.
      yield* TestClock.adjust('7 seconds')
      yield* library.UpdateWorkout(
        {
          id: created.id,
          workout: withFocusAndNote(
            makeWorkout(['A', 'B', 'C'], {}, 'Corrected'),
            'strength',
            'Bring a mat',
          ),
          updatedAt: created.updatedAt,
        },
        { headers },
      )

      // No notice: nothing anyone runs has changed.
      expect((yield* snapshotOf(svc, started.id)).planRevision).toBe(0)

      yield* svc.leaveSession(started.id, owner)
      const rows = yield* history.ListHistory(undefined, { headers })
      expect(rows[0]?.workoutName).toBe('Corrected')
      expect(rows[0]?.workout.name).toBe('Corrected')
      // One row, one version of the plan — never the new name beside the old
      // focus and the old note.
      expect(rows[0]?.workout.focus).toBe('strength')
      expect(rows[0]?.workout.note).toBe('Bring a mat')
      expect(recordedStations(rows[0])).toEqual(['A', 'B', 'C'])
    }).pipe(Effect.provide(FlowLive)),
  )
})

describe('a completion of a session that a deleted workout ended', () => {
  it.scoped('records the last plan the session held, not the plan it started on', () =>
    Effect.gen(function* () {
      const { headers, history, library, sessions } = yield* asOwner
      const created = yield* library.CreateWorkout(
        { workout: makeWorkout(['A', 'B', 'C']) },
        { headers },
      )
      const started = yield* sessions.StartSession({ workoutId: created.id }, { headers })

      // An edit lands at the 15s boundary, and then the row goes altogether.
      yield* TestClock.adjust('7 seconds')
      yield* library.UpdateWorkout(
        {
          id: created.id,
          workout: makeWorkout(['A2', 'B2', 'C2'], {}, 'Second'),
          updatedAt: created.updatedAt,
        },
        { headers },
      )
      yield* TestClock.adjust('9 seconds')
      yield* library.DeleteWorkout({ id: created.id }, { headers })

      const rows = yield* history.ListHistory(undefined, { headers })
      expect(rows).toHaveLength(1)
      expect(rows[0]?.sessionId).toBe(started.id)
      expect(rows[0]?.workoutName).toBe('Second')
      expect(recordedStations(rows[0])).toEqual(['A2', 'B2', 'C2'])
      expect(rows[0]?.progress?.totalSegments).toBe(6)
    }).pipe(Effect.provide(FlowLive)),
  )
})

describe('a completion of a session changed after the timer reached done', () => {
  it.scoped('records the name and the plan as of done, not the later change', () =>
    Effect.gen(function* () {
      const { headers, history, library, sessions } = yield* asOwner
      const created = yield* library.CreateWorkout(
        { workout: makeWorkout(['A', 'B']) },
        { headers },
      )
      const started = yield* sessions.StartSession({ workoutId: created.id }, { headers })
      const svc = yield* LiveSessions

      // ready 5s | A 10s | rest 5s | B 10s — the last rep ends at 30s.
      yield* TestClock.adjust('31 seconds')
      yield* library.RenameWorkout({ id: created.id, name: 'Renamed After' }, { headers })
      yield* svc.leaveSession(started.id, owner)

      const rows = yield* history.ListHistory(undefined, { headers })
      expect(rows[0]?.workoutName).toBe('Plan')
      expect(rows[0]?.workout.name).toBe('Plan')
      expect(rows[0]?.progress?.segmentsCompleted).toBe(3)
      expect(rows[0]?.progress?.totalSegments).toBe(4)
    }).pipe(Effect.provide(FlowLive)),
  )
})

describe('a completion measured against a plan shorter than the position it held', () => {
  it.scoped('records the segment of the plan in force, never a segment it lacks', () =>
    Effect.gen(function* () {
      const { headers, history, library, sessions } = yield* asOwner
      const created = yield* library.CreateWorkout(
        { workout: makeWorkout(['A', 'B', 'C']) },
        { headers },
      )
      const started = yield* sessions.StartSession({ workoutId: created.id }, { headers })
      const svc = yield* LiveSessions

      // t=40s: the last work, segment 5 of six. The host then takes the rests
      // out, so the plan in force holds four segments and the last of them is
      // segment 3. A position carried across would name a segment that the
      // recorded plan does not have.
      yield* TestClock.adjust('40 seconds')
      yield* sessions.SendSessionCommand({ id: started.id, command: 'pause' }, { headers })
      expect(paused(yield* snapshotOf(svc, started.id))?.segmentIndex).toBe(5)

      yield* library.UpdateWorkout(
        {
          id: created.id,
          workout: makeWorkout(['A', 'B', 'C'], { restSeconds: 0 }),
          updatedAt: created.updatedAt,
        },
        { headers },
      )
      yield* svc.leaveSession(started.id, owner)

      const rows = yield* history.ListHistory(undefined, { headers })
      expect(rows[0]?.progress?.totalSegments).toBe(4)
      expect(rows[0]?.progress?.segmentsCompleted).toBe(3)
    }).pipe(Effect.provide(FlowLive)),
  )
})

describe('a completion of a session that a shorter plan exhausted', () => {
  it.scoped('records how far the session got, not the whole of the plan it ran', () =>
    Effect.gen(function* () {
      const { headers, history, library, sessions } = yield* asOwner
      const created = yield* library.CreateWorkout(
        { workout: makeWorkout(['A', 'B', 'C']) },
        { headers },
      )
      const started = yield* sessions.StartSession({ workoutId: created.id }, { headers })
      const svc = yield* LiveSessions

      // t=22s: the second work, ordinal 1, segment 3 of six. The host trims
      // the plan to one station, so ordinal 1 no longer exists and the
      // session finishes where it stands.
      yield* TestClock.adjust('22 seconds')
      yield* sessions.SendSessionCommand({ id: started.id, command: 'pause' }, { headers })
      yield* library.UpdateWorkout(
        { id: created.id, workout: makeWorkout(['A']), updatedAt: created.updatedAt },
        { headers },
      )
      expect((yield* snapshotOf(svc, started.id)).timer._tag).toBe('done')

      yield* svc.leaveSession(started.id, owner)

      const rows = yield* history.ListHistory(undefined, { headers })
      // The plan it ran, and the point in it that the session truly reached —
      // not the last segment of a plan whose end was taken away.
      expect(recordedStations(rows[0])).toEqual(['A', 'B', 'C'])
      expect(rows[0]?.progress?.totalSegments).toBe(6)
      expect(rows[0]?.progress?.segmentsCompleted).toBe(3)
    }).pipe(Effect.provide(FlowLive)),
  )
})
