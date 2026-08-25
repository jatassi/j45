import { describe, expect, it } from '@effect/vitest'
import type { SessionId } from '@j45/domain'
import * as Effect from 'effect/Effect'
import * as TestClock from 'effect/TestClock'

import { LiveSessions } from '../../src/session/live-sessions.js'
import {
  asOwner,
  FlowLive,
  makeWorkout,
  owner,
  paused,
  running,
  snapshotOf,
  stationNames,
} from './plan-flow-harness.js'

/**
 * The three timer positions where "apply at the next segment boundary" has
 * no meaning: paused, done, and a position the new plan no longer reaches.
 * Observed only where a user can see it — the session snapshot each
 * participant holds, and the history rows the session leaves behind.
 *
 * `makeWorkout(['A', 'B', 'C'])` compiles to ready 5s | A 10s | rest 5s |
 * B 10s | rest 5s | C 10s — six segments over 45s, with work ordinals 0, 1
 * and 2.
 */

describe('a plan change while the session is paused', () => {
  it.scoped('applies at once, with the time left re-derived from the new segment', () =>
    Effect.gen(function* () {
      const { headers, library, sessions } = yield* asOwner
      const created = yield* library.CreateWorkout(
        { workout: makeWorkout(['A', 'B', 'C']) },
        { headers },
      )
      const started = yield* sessions.StartSession({ workoutId: created.id }, { headers })
      const svc = yield* LiveSessions

      // t=7s: the first work (5–15s) is running. The host pauses it with 8s
      // left, so nothing is counting down and no boundary is coming.
      yield* TestClock.adjust('7 seconds')
      yield* sessions.SendSessionCommand({ id: started.id, command: 'pause' }, { headers })
      expect(paused(yield* snapshotOf(svc, started.id))?.remainingMillis).toBe(8000)

      // The host retimes the work to 20s and renames every station.
      yield* library.UpdateWorkout(
        {
          id: created.id,
          workout: makeWorkout(['A2', 'B2', 'C2'], { workSeconds: 20 }),
          updatedAt: created.updatedAt,
        },
        { headers },
      )

      // In force at once: no clock has moved, and none needs to.
      const after = yield* snapshotOf(svc, started.id)
      expect(stationNames(after)).toEqual(['A2', 'B2', 'C2'])
      expect(after.planRevision).toBe(1)
      expect(after.planChangedBy).toBe('Owner')
      // Still on the same work ordinal, still paused — and holding the whole
      // of the segment now in force, not the 8s left of the segment it left.
      expect(paused(after)?.segmentIndex).toBe(1)
      expect(paused(after)?.remainingMillis).toBe(20_000)
    }).pipe(Effect.provide(FlowLive)),
  )

  it.scoped('releases a plan that was already held when the host pauses', () =>
    Effect.gen(function* () {
      const { headers, library, sessions } = yield* asOwner
      const created = yield* library.CreateWorkout(
        { workout: makeWorkout(['A', 'B', 'C']) },
        { headers },
      )
      const started = yield* sessions.StartSession({ workoutId: created.id }, { headers })
      const svc = yield* LiveSessions

      // The edit arrives while the first work is running, so it is held for
      // the next boundary — which the pause then takes away.
      yield* TestClock.adjust('7 seconds')
      yield* library.UpdateWorkout(
        {
          id: created.id,
          workout: makeWorkout(['A2', 'B2', 'C2'], { workSeconds: 20 }),
          updatedAt: created.updatedAt,
        },
        { headers },
      )
      expect((yield* snapshotOf(svc, started.id)).planRevision).toBe(0)

      yield* sessions.SendSessionCommand({ id: started.id, command: 'pause' }, { headers })

      // Everybody is on the new plan while they wait, so the resume finds
      // them there rather than one interval behind it.
      const after = yield* snapshotOf(svc, started.id)
      expect(stationNames(after)).toEqual(['A2', 'B2', 'C2'])
      expect(after.planRevision).toBe(1)
      expect(paused(after)?.segmentIndex).toBe(1)
      expect(paused(after)?.remainingMillis).toBe(20_000)
    }).pipe(Effect.provide(FlowLive)),
  )

  it.scoped('counts down the segment actually in force when the host resumes', () =>
    Effect.gen(function* () {
      const { headers, library, sessions } = yield* asOwner
      const created = yield* library.CreateWorkout(
        { workout: makeWorkout(['A', 'B', 'C']) },
        { headers },
      )
      const started = yield* sessions.StartSession({ workoutId: created.id }, { headers })
      const svc = yield* LiveSessions

      yield* TestClock.adjust('7 seconds')
      yield* sessions.SendSessionCommand({ id: started.id, command: 'pause' }, { headers })
      yield* library.UpdateWorkout(
        {
          id: created.id,
          workout: makeWorkout(['A2', 'B2', 'C2'], { workSeconds: 20 }),
          updatedAt: created.updatedAt,
        },
        { headers },
      )
      yield* sessions.SendSessionCommand({ id: started.id, command: 'resume' }, { headers })

      // 20s from the resume instant — the new work's own duration.
      expect(running(yield* snapshotOf(svc, started.id))?.endsAtMillis).toBe(27_000)

      // And the timer honours it: still working at 26s, resting at 27s.
      yield* TestClock.adjust('19 seconds')
      expect(running(yield* snapshotOf(svc, started.id))?.segmentIndex).toBe(1)
      yield* TestClock.adjust('1 second')
      expect(running(yield* snapshotOf(svc, started.id))?.segmentIndex).toBe(2)
    }).pipe(Effect.provide(FlowLive)),
  )
})

describe('a plan change that no longer reaches the session position', () => {
  it.scoped('finishes the session rather than replaying a station it has run', () =>
    Effect.gen(function* () {
      const { headers, library, sessions } = yield* asOwner
      const created = yield* library.CreateWorkout(
        { workout: makeWorkout(['A', 'B', 'C']) },
        { headers },
      )
      const started = yield* sessions.StartSession({ workoutId: created.id }, { headers })
      const svc = yield* LiveSessions

      // t=32s: the rest before the third work (ordinal 2), which the host
      // then trims away — the new plan stops at ordinal 1.
      yield* TestClock.adjust('32 seconds')
      yield* library.UpdateWorkout(
        { id: created.id, workout: makeWorkout(['A', 'B']), updatedAt: created.updatedAt },
        { headers },
      )

      // t=35s: the boundary the held plan waited for. There is no work at
      // ordinal 2 to enter, so the session finishes here.
      yield* TestClock.adjust('3 seconds')
      const after = yield* snapshotOf(svc, started.id)
      expect(after.timer._tag).toBe('done')
      // On the plan it actually ran, at the revision it already held: the
      // trimmed plan never came into force, and nobody is told about it.
      expect(stationNames(after)).toEqual(['A', 'B', 'C'])
      expect(after.planRevision).toBe(0)
      expect(after.planChangedBy).toBe(null)
    }).pipe(Effect.provide(FlowLive)),
  )

  it.scoped('leaves a session no different from one that ran to its last segment', () =>
    Effect.gen(function* () {
      const { headers, history, library, sessions } = yield* asOwner
      const trimmed = yield* library.CreateWorkout(
        { workout: makeWorkout(['A', 'B', 'C']) },
        { headers },
      )
      const control = yield* library.CreateWorkout(
        { workout: makeWorkout(['A', 'B', 'C']) },
        { headers },
      )
      const cut = yield* sessions.StartSession({ workoutId: trimmed.id }, { headers })
      const ran = yield* sessions.StartSession({ workoutId: control.id }, { headers })
      const svc = yield* LiveSessions

      // One session is trimmed short of its position at 35s; the other is
      // left alone and reaches its own last rep at 45s.
      yield* TestClock.adjust('32 seconds')
      yield* library.UpdateWorkout(
        { id: trimmed.id, workout: makeWorkout(['A', 'B']), updatedAt: trimmed.updatedAt },
        { headers },
      )
      yield* TestClock.adjust('13 seconds')

      // Nothing a participant can read tells the two apart.
      const cutState = yield* snapshotOf(svc, cut.id)
      const ranState = yield* snapshotOf(svc, ran.id)
      expect(cutState.timer).toEqual(ranState.timer)
      expect(cutState.compiled).toEqual(ranState.compiled)
      expect(cutState.workoutName).toBe(ranState.workoutName)
      expect(cutState.planRevision).toBe(ranState.planRevision)
      expect(cutState.planChangedBy).toBe(ranState.planChangedBy)
      expect(cutState.ended).toBe(ranState.ended)

      // Nor does the record each one leaves behind.
      yield* svc.leaveSession(cut.id, owner)
      yield* svc.leaveSession(ran.id, owner)
      const rows = yield* history.ListHistory(undefined, { headers })
      const rowFor = (id: SessionId) => rows.find((row) => row.sessionId === id)
      expect(rows).toHaveLength(2)
      expect(rowFor(cut.id)?.workout).toEqual(rowFor(ran.id)?.workout)
      expect(rowFor(cut.id)?.progress).toEqual(rowFor(ran.id)?.progress)
      // The whole of the plan it was running: five of six segments entered.
      expect(rowFor(cut.id)?.progress?.segmentsCompleted).toBe(5)
      expect(rowFor(cut.id)?.progress?.totalSegments).toBe(6)
    }).pipe(Effect.provide(FlowLive)),
  )

  it.scoped('finishes a paused session at once, without waiting for a resume', () =>
    Effect.gen(function* () {
      const { headers, library, sessions } = yield* asOwner
      const created = yield* library.CreateWorkout(
        { workout: makeWorkout(['A', 'B', 'C']) },
        { headers },
      )
      const started = yield* sessions.StartSession({ workoutId: created.id }, { headers })
      const svc = yield* LiveSessions

      yield* TestClock.adjust('40 seconds')
      yield* sessions.SendSessionCommand({ id: started.id, command: 'pause' }, { headers })
      expect(paused(yield* snapshotOf(svc, started.id))?.segmentIndex).toBe(5)

      yield* library.UpdateWorkout(
        { id: created.id, workout: makeWorkout(['A', 'B']), updatedAt: created.updatedAt },
        { headers },
      )

      const after = yield* snapshotOf(svc, started.id)
      expect(after.timer._tag).toBe('done')
      expect(stationNames(after)).toEqual(['A', 'B', 'C'])
      expect(after.planRevision).toBe(0)
    }).pipe(Effect.provide(FlowLive)),
  )
})

describe('a plan change after the timer is done', () => {
  it.scoped('never reaches the session and raises no notice', () =>
    Effect.gen(function* () {
      const { headers, library, sessions } = yield* asOwner
      const created = yield* library.CreateWorkout(
        { workout: makeWorkout(['A', 'B']) },
        { headers },
      )
      const started = yield* sessions.StartSession({ workoutId: created.id }, { headers })
      const svc = yield* LiveSessions

      // ready 5s | A 10s | rest 5s | B 10s — the last rep ends at 30s.
      yield* TestClock.adjust('31 seconds')
      const finished = yield* snapshotOf(svc, started.id)
      expect(finished.timer._tag).toBe('done')

      yield* library.UpdateWorkout(
        {
          id: created.id,
          workout: makeWorkout(['A2', 'B2', 'C2']),
          updatedAt: created.updatedAt,
        },
        { headers },
      )

      // The plan is frozen: the stations, the name and the revision all
      // stand where the last rep left them, so nothing is announced.
      const after = yield* snapshotOf(svc, started.id)
      expect(stationNames(after)).toEqual(['A', 'B'])
      expect(after.workoutName).toBe(finished.workoutName)
      expect(after.planRevision).toBe(0)
      expect(after.planChangedBy).toBe(null)
      expect(after.timer).toEqual(finished.timer)

      // And it stays frozen: nothing was held back for a later boundary.
      // (Under the 60s idle collector, which would end an unwatched session.)
      yield* TestClock.adjust('20 seconds')
      expect(stationNames(yield* snapshotOf(svc, started.id))).toEqual(['A', 'B'])
    }).pipe(Effect.provide(FlowLive)),
  )

  it.scoped('leaves the record of the plan that was in force while it ran', () =>
    Effect.gen(function* () {
      const { headers, history, library, sessions } = yield* asOwner
      const created = yield* library.CreateWorkout(
        { workout: makeWorkout(['A', 'B']) },
        { headers },
      )
      const started = yield* sessions.StartSession({ workoutId: created.id }, { headers })
      const svc = yield* LiveSessions

      yield* TestClock.adjust('31 seconds')
      yield* library.UpdateWorkout(
        { id: created.id, workout: makeWorkout(['A2', 'B2', 'C2']), updatedAt: created.updatedAt },
        { headers },
      )
      yield* svc.leaveSession(started.id, owner)

      const rows = yield* history.ListHistory(undefined, { headers })
      expect(rows).toHaveLength(1)
      // The edit came after the last rep, so it is not in the record.
      expect(rows[0]?.workout.pods[0]?.stations.map((station) => station.name)).toEqual(['A', 'B'])
      expect(rows[0]?.progress?.totalSegments).toBe(4)
    }).pipe(Effect.provide(FlowLive)),
  )
})
