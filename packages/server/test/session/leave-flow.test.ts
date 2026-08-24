import { NodeContext } from '@effect/platform-node'
import { SqliteClient } from '@effect/sql-sqlite-node'
import { describe, expect, it } from '@effect/vitest'
import {
  compile,
  Flow,
  Participant,
  Pod,
  Round,
  Station,
  UserId,
  Workout,
  WorkoutId,
  type SessionId,
  type SessionState,
  type Username,
} from '@j45/domain'
import * as Chunk from 'effect/Chunk'
import * as DateTime from 'effect/DateTime'
import * as Effect from 'effect/Effect'
import * as Exit from 'effect/Exit'
import * as Fiber from 'effect/Fiber'
import * as Layer from 'effect/Layer'
import * as Schema from 'effect/Schema'
import * as Scope from 'effect/Scope'
import * as Stream from 'effect/Stream'
import * as TestClock from 'effect/TestClock'

import { UserRepo } from '../../src/auth/user-repo.js'
import { CompletionsRepo } from '../../src/session/completions-repo.js'
import { LiveSessions } from '../../src/session/live-sessions.js'
import { MigratorLive } from '../../src/sql.js'

/**
 * Leave-flow integration tests: drive `LiveSessions` under TestClock and assert
 * leave semantics on its own surface — published participants (`snapshot` /
 * `watch`), `list()`, and completion rows via `CompletionsRepo` — rather than
 * the ListHistory read path. Covers mid-session leave, last-leaver end,
 * GC-for-non-departed, pre-progression leave, and leave-then-rejoin stints.
 */

const SqlTestLive = MigratorLive.pipe(
  Layer.provideMerge(SqliteClient.layer({ filename: ':memory:' })),
  Layer.provideMerge(NodeContext.layer),
)

// One shared, memoized `LiveSessions` over its `CompletionsRepo` — the same
// reference for the test body and the registry's writes.
const LiveSessionsLive = LiveSessions.Default.pipe(Layer.provide(CompletionsRepo.Default))

const FlowLive = Layer.mergeAll(LiveSessionsLive, CompletionsRepo.Default, UserRepo.Default).pipe(
  Layer.provideMerge(SqlTestLive),
)

// Same fixture as history-flow / live-sessions: ready 5s → work 10s → rest 5s → work 10s.
const fixtureWorkout = new Workout({
  name: 'Fixture',
  focus: 'cardio',
  pods: [
    new Pod({ name: 'P', stations: [new Station({ name: 'A' }), new Station({ name: 'B' })] }),
  ],
  flow: new Flow({ type: 'laps', rounds: [new Round({ workSeconds: 10, restSeconds: 5 })] }),
})
const compiled = compile(fixtureWorkout)

const uid = (id: string) => Schema.decodeSync(UserId)(id)
const alice = new Participant({ userId: uid('alice'), displayName: 'Alice' })
const bob = new Participant({ userId: uid('bob'), displayName: 'Bob' })

const fixtureWorkoutId = Schema.decodeSync(WorkoutId)('workout-fixture')

const startFixture = (svc: LiveSessions) =>
  svc.start({
    host: alice,
    workoutId: fixtureWorkoutId,
    reflowLaunched: false,
    workoutName: 'Fixture',
    workout: fixtureWorkout,
    compiled,
  })

const seedUser = (id: UserId, displayName = 'Test User') =>
  Effect.gen(function* () {
    const userRepo = yield* UserRepo
    yield* userRepo.insert({
      id,
      username: `${id}-username` as Username,
      displayName,
      role: 'member',
      pinHash: 'irrelevant-for-this-test',
      createdAt: '2020-01-01T00:00:00.000Z',
    })
  })

// A watch that takes the first snapshot then releases: the participant joins
// the add-only roster (and is dropped from presence again on release).
const watchThenLeave = (svc: LiveSessions, id: SessionId, participant: Participant) =>
  Effect.asVoid(Stream.runHead(svc.watch(id, participant)))

const participantIds = (state: SessionState): readonly UserId[] =>
  state.participants.map((p) => p.userId)

// Opens a `watch` in a standalone, manually-closeable scope and pulls its first
// element — same harness as live-sessions for presence / stream assertions.
const openWatch = (svc: LiveSessions, id: SessionId, participant: Participant) =>
  Effect.gen(function* () {
    const scope = yield* Scope.make()
    const pull = yield* Scope.extend(scope)(Stream.toPull(svc.watch(id, participant)))
    const first = yield* pull
    return { scope, pull, first }
  })

describe('leave flows via LiveSessions (TestClock)', () => {
  it.effect(
    'non-host leave mid-session writes one completion, drops the leaver from published participants, and keeps the other watcher’s stream alive',
    () =>
      Effect.gen(function* () {
        yield* seedUser(alice.userId, 'Alice')
        yield* seedUser(bob.userId, 'Bob')
        const svc = yield* LiveSessions
        const completionsRepo = yield* CompletionsRepo
        const { id } = yield* startFixture(svc)

        // Both watching: progressed two-participant session.
        const aliceW = yield* openWatch(svc, id, alice)
        const bobW = yield* openWatch(svc, id, bob)
        const bothIds = participantIds(yield* svc.snapshot(id))
        expect(bothIds).toHaveLength(2)
        expect(bothIds).toContain(alice.userId)
        expect(bothIds).toContain(bob.userId)

        // Advance so the ticker crosses into work — session is progressed.
        yield* TestClock.adjust('5 seconds')
        const stateAtLeave = yield* svc.snapshot(id)
        expect(stateAtLeave.timer._tag).toBe('running')
        if (stateAtLeave.timer._tag === 'running') {
          expect(stateAtLeave.timer.segmentIndex).toBe(1)
        }

        yield* svc.leaveSession(id, bob.userId)

        // Exactly one completion for the leaver: personal endedAt and progress
        // match the timer position at leave time (t=5s, segment 1 of 4).
        const bobRows = yield* completionsRepo.listForUser(bob.userId)
        expect(bobRows).toHaveLength(1)
        const bobRow = bobRows[0]
        if (bobRow === undefined) {
          throw new Error('expected bob’s leave completion')
        }
        expect(DateTime.toEpochMillis(bobRow.endedAt)).toBe(5000)
        expect(bobRow.progress?.segmentsCompleted).toBe(1)
        expect(bobRow.progress?.totalSegments).toBe(4)
        // Still-watching host has no row yet.
        expect(yield* completionsRepo.listForUser(alice.userId)).toHaveLength(0)

        // Leaver removed from published participants; session still live.
        expect(participantIds(yield* svc.snapshot(id))).toEqual([alice.userId])
        expect(yield* svc.list()).toHaveLength(1)
        // Bob’s stream was detached.
        expect(Exit.isFailure(yield* Effect.exit(bobW.pull))).toBe(true)

        // Alice’s watch keeps emitting after the leave — drain any buffered
        // join/segment updates, then a pause she can still observe (stream must
        // not complete/error when bob left).
        yield* svc.command(id, 'pause')
        let sawPausedAlone = false
        for (let i = 0; i < 10; i++) {
          const next = yield* aliceW.pull
          const last = Chunk.last(next)
          if (
            last._tag === 'Some' &&
            last.value.timer._tag === 'paused' &&
            participantIds(last.value).length === 1 &&
            participantIds(last.value)[0] === alice.userId
          ) {
            sawPausedAlone = true
            break
          }
        }
        expect(sawPausedAlone).toBe(true)

        yield* Scope.close(aliceW.scope, Exit.void)
        yield* Scope.close(bobW.scope, Exit.void)
      }).pipe(Effect.provide(FlowLive)),
  )

  it.scoped(
    'last participant leaving ends the session immediately when the whole roster has departed',
    () =>
      Effect.gen(function* () {
        yield* seedUser(alice.userId, 'Alice')
        yield* seedUser(bob.userId, 'Bob')
        const svc = yield* LiveSessions
        const completionsRepo = yield* CompletionsRepo
        const { id } = yield* startFixture(svc)

        // In-flight watches whose streams should complete when the session ends.
        const aliceCollect = yield* Stream.runCollect(svc.watch(id, alice)).pipe(
          Effect.exit,
          Effect.forkScoped,
        )
        const bobCollect = yield* Stream.runCollect(svc.watch(id, bob)).pipe(
          Effect.exit,
          Effect.forkScoped,
        )

        // Wait until both joins have landed on the published participant list.
        yield* Effect.gen(function* () {
          for (let i = 0; i < 50; i++) {
            if ((yield* svc.snapshot(id)).participants.length >= 2) {
              return
            }
            yield* Effect.yieldNow()
          }
          throw new Error('expected both participants to join before leave')
        })

        // Progress past ready.
        yield* TestClock.adjust('5 seconds')
        expect(yield* svc.list()).toHaveLength(1)

        // Both explicitly leave — every roster member departs.
        yield* svc.leaveSession(id, bob.userId)
        expect(yield* svc.list()).toHaveLength(1)
        // Bob’s watch stream completes rather than hanging (join returns).
        yield* Fiber.join(bobCollect)

        yield* svc.leaveSession(id, alice.userId)

        // On the last leave: session gone immediately (no GC wait).
        expect(yield* svc.list()).toHaveLength(0)
        expect(Exit.isFailure(yield* Effect.exit(svc.snapshot(id)))).toBe(true)

        // Alice’s in-flight watch completes rather than hanging (join returns).
        yield* Fiber.join(aliceCollect)

        // Each participant has exactly one completion — no duplicates.
        const aliceRows = yield* completionsRepo.listForUser(alice.userId)
        const bobRows = yield* completionsRepo.listForUser(bob.userId)
        expect(aliceRows).toHaveLength(1)
        expect(bobRows).toHaveLength(1)
        const aliceRow = aliceRows[0]
        const bobRow = bobRows[0]
        if (aliceRow === undefined || bobRow === undefined) {
          throw new Error('expected one completion each')
        }
        expect(aliceRow.id).not.toBe(bobRow.id)
        expect(DateTime.toEpochMillis(aliceRow.endedAt)).toBe(5000)
        expect(DateTime.toEpochMillis(bobRow.endedAt)).toBe(5000)
        expect(aliceRow.progress?.segmentsCompleted).toBe(1)
        expect(bobRow.progress?.segmentsCompleted).toBe(1)
      }).pipe(Effect.provide(FlowLive)),
  )

  it.effect(
    'non-departed participant still gets a row at session end via GC after presence drops without leaveSession',
    () =>
      Effect.gen(function* () {
        yield* seedUser(alice.userId, 'Alice')
        yield* seedUser(bob.userId, 'Bob')
        const svc = yield* LiveSessions
        const completionsRepo = yield* CompletionsRepo
        const { id } = yield* startFixture(svc)

        // Both join; progress; pause so only the abandonment clock runs.
        const aliceW = yield* openWatch(svc, id, alice)
        const bobW = yield* openWatch(svc, id, bob)
        yield* TestClock.adjust('5 seconds')
        yield* svc.command(id, 'pause')

        // Bob departs explicitly — one leave-time row, unrostered.
        yield* svc.leaveSession(id, bob.userId)
        expect(yield* completionsRepo.listForUser(bob.userId)).toHaveLength(1)
        expect(yield* completionsRepo.listForUser(alice.userId)).toHaveLength(0)

        // Alice’s subscription drops without leaveSession — presence → 0, but she
        // remains on the roster (not departed), so the session does not end yet.
        yield* Scope.close(aliceW.scope, Exit.void)
        yield* Scope.close(bobW.scope, Exit.void)
        expect(yield* svc.list()).toHaveLength(1)
        expect(participantIds(yield* svc.snapshot(id))).toEqual([])

        // 59s idle: still live, still no row for the non-departed participant.
        yield* TestClock.adjust('59 seconds')
        expect(yield* svc.list()).toHaveLength(1)
        expect(yield* completionsRepo.listForUser(alice.userId)).toHaveLength(0)

        // Crossing 60s GCs; endSession writes alice’s single row at GC time.
        yield* TestClock.adjust('1 seconds')
        expect(yield* svc.list()).toHaveLength(0)

        const aliceRows = yield* completionsRepo.listForUser(alice.userId)
        expect(aliceRows).toHaveLength(1)
        const aliceRow = aliceRows[0]
        if (aliceRow === undefined) {
          throw new Error('expected alice’s GC completion')
        }
        // Presence hit zero at t=5s (after pause/leave/releases); GC at +60s.
        expect(DateTime.toEpochMillis(aliceRow.endedAt)).toBe(65_000)
        // Final timer position at end: paused on segment 1 of 4.
        expect(aliceRow.progress?.segmentsCompleted).toBe(1)
        expect(aliceRow.progress?.totalSegments).toBe(4)

        // Bob still has exactly the one leave-time row — no duplicate at GC.
        const bobRowsAfterGc = yield* completionsRepo.listForUser(bob.userId)
        expect(bobRowsAfterGc).toHaveLength(1)
        const bobLeaveRow = bobRowsAfterGc[0]
        if (bobLeaveRow === undefined) {
          throw new Error('expected bob’s leave-time row')
        }
        expect(DateTime.toEpochMillis(bobLeaveRow.endedAt)).toBe(5000)
      }).pipe(Effect.provide(FlowLive)),
  )

  it.effect(
    'leave before progression writes nothing; leave-then-rejoin yields two completion rows for two stints',
    () =>
      Effect.gen(function* () {
        yield* seedUser(alice.userId, 'Alice')
        yield* seedUser(bob.userId, 'Bob')
        const svc = yield* LiveSessions
        const completionsRepo = yield* CompletionsRepo

        // --- (a) Leave during ready: no completion for the leaver -------------
        {
          const { id } = yield* startFixture(svc)
          yield* watchThenLeave(svc, id, bob)
          yield* svc.leaveSession(id, bob.userId)
          expect(yield* completionsRepo.listForUser(bob.userId)).toHaveLength(0)
          // Host leaves to clear the registry before the next scenario.
          yield* svc.leaveSession(id, alice.userId)
          expect(yield* svc.list()).toHaveLength(0)
          expect(yield* completionsRepo.listForUser(alice.userId)).toHaveLength(0)
        }

        // --- (b) Leave mid-session, rejoin, then session ends → two stints ----
        {
          const { id } = yield* startFixture(svc)
          // Progress first, then bob joins and leaves — first-stint row.
          yield* TestClock.adjust('5 seconds')
          yield* watchThenLeave(svc, id, bob)
          yield* svc.leaveSession(id, bob.userId)
          const afterFirstLeave = yield* completionsRepo.listForUser(bob.userId)
          expect(afterFirstLeave).toHaveLength(1)
          const firstLeaveRow = afterFirstLeave[0]
          if (firstLeaveRow === undefined) {
            throw new Error('expected bob’s first-stint row')
          }
          expect(DateTime.toEpochMillis(firstLeaveRow.endedAt)).toBe(5000)
          expect(firstLeaveRow.progress?.segmentsCompleted).toBe(1)
          // Unrostered: not in published participants.
          expect(participantIds(yield* svc.snapshot(id))).not.toContain(bob.userId)

          // Re-watch: reappears in published participants (and roster).
          const rejoin = yield* openWatch(svc, id, bob)
          expect(participantIds(yield* svc.snapshot(id))).toContain(bob.userId)
          const rejoinFirst = Chunk.last(rejoin.first)
          expect(rejoinFirst._tag).toBe('Some')
          if (rejoinFirst._tag === 'Some') {
            expect(participantIds(rejoinFirst.value)).toContain(bob.userId)
          }

          // Release without leaveSession so presence can idle; pause so only GC
          // runs. Session end writes bob a second-stint row (still rostered).
          yield* Scope.close(rejoin.scope, Exit.void)
          yield* svc.command(id, 'pause')
          yield* TestClock.adjust('60 seconds')
          expect(yield* svc.list()).toHaveLength(0)

          const bobRows = yield* completionsRepo.listForUser(bob.userId)
          expect(bobRows).toHaveLength(2)
          // Newest-first: second stint at GC end, first stint at leave time.
          const [secondStint, firstStint] = bobRows
          if (secondStint === undefined || firstStint === undefined) {
            throw new Error('expected two stint rows')
          }
          expect(DateTime.toEpochMillis(firstStint.endedAt)).toBe(5000)
          expect(firstStint.progress?.segmentsCompleted).toBe(1)
          // Presence dropped at rejoin release (still ~t=5s); GC +60s.
          expect(DateTime.toEpochMillis(secondStint.endedAt)).toBe(65_000)
          expect(secondStint.progress?.segmentsCompleted).toBe(1)
          expect(secondStint.id).not.toBe(firstStint.id)

          // Host also got a GC row (never left; still on roster).
          expect(yield* completionsRepo.listForUser(alice.userId)).toHaveLength(1)
        }
      }).pipe(Effect.provide(FlowLive)),
  )
})
