import { NodeContext } from '@effect/platform-node'
import { RpcTest } from '@effect/rpc'
import { SqliteClient } from '@effect/sql-sqlite-node'
import { describe, expect, it } from '@effect/vitest'
import {
  applyReflow,
  compile,
  Flow,
  HistoryRpcs,
  Participant,
  Pod,
  Reflow,
  ReflowPod,
  Round,
  SessionRpcs,
  Station,
  UserId,
  Workout,
  type SessionId,
  type Username,
} from '@j45/domain'
import * as DateTime from 'effect/DateTime'
import * as Effect from 'effect/Effect'
import * as Either from 'effect/Either'
import * as Layer from 'effect/Layer'
import * as Schema from 'effect/Schema'
import * as Stream from 'effect/Stream'
import * as TestClock from 'effect/TestClock'

import { AuthSessions } from '../../src/auth/auth-sessions.js'
import { SESSION_COOKIE_NAME } from '../../src/auth/cookie.js'
import { AuthMiddlewareLive } from '../../src/auth/middleware.js'
import { UserRepo } from '../../src/auth/user-repo.js'
import { WorkoutsRepo } from '../../src/library/workouts-repo.js'
import { CompletionsRepo } from '../../src/session/completions-repo.js'
import { SessionHandlersLive } from '../../src/session/handlers.js'
import { HistoryHandlersLive } from '../../src/session/history-handlers.js'
import { LiveSessions } from '../../src/session/live-sessions.js'
import { MigratorLive } from '../../src/sql.js'

/**
 * End-to-end history flows: drive real sessions through LiveSessions /
 * SessionHandlers under TestClock, then assert through the ListHistory
 * handler — proving the write seam and the read path agree on the wire shape.
 */

const SqlTestLive = MigratorLive.pipe(
  Layer.provideMerge(SqliteClient.layer({ filename: ':memory:' })),
  Layer.provideMerge(NodeContext.layer),
)

// One shared, memoized `LiveSessions` built over its `CompletionsRepo` — the
// same reference wherever the test body, SessionHandlers, and HistoryHandlers
// need it, so they drive one registry and one connection.
const LiveSessionsLive = LiveSessions.Default.pipe(Layer.provide(CompletionsRepo.Default))

/**
 * Full stack: LiveSessions + CompletionsRepo (write), SessionHandlers (StartSession
 * for reflow), HistoryHandlers + Auth (ListHistory read), UserRepo / AuthSessions /
 * WorkoutsRepo for seeding.
 */
const FlowLive = Layer.mergeAll(
  UserRepo.Default,
  AuthSessions.Default,
  WorkoutsRepo.Default,
  LiveSessionsLive,
  CompletionsRepo.Default,
  AuthMiddlewareLive.pipe(Layer.provide(Layer.mergeAll(AuthSessions.Default, UserRepo.Default))),
  HistoryHandlersLive.pipe(Layer.provide(CompletionsRepo.Default)),
  SessionHandlersLive.pipe(Layer.provide(Layer.mergeAll(WorkoutsRepo.Default, LiveSessionsLive))),
).pipe(Layer.provideMerge(SqlTestLive))

// Same fixture as session-history / live-sessions: ready 5s → work 10s → rest 5s → work 10s.
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

const startFixture = (svc: LiveSessions) =>
  svc.start({ host: alice, workoutName: 'Fixture', workout: fixtureWorkout, compiled })

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

const cookieHeaders = (token: string) => ({ cookie: `${SESSION_COOKIE_NAME}=${token}` })

// A watch that takes the first snapshot then releases: the participant joins
// the add-only roster (and is dropped from presence again on release).
const watchThenLeave = (svc: LiveSessions, id: SessionId, participant: Participant) =>
  Effect.asVoid(Stream.runHead(svc.watch(id, participant)))

const participantIdsSorted = (record: { readonly participants: readonly Participant[] }) =>
  record.participants.map((p) => p.userId).sort()

const listHistoryFor = (userId: UserId) =>
  Effect.gen(function* () {
    const authSessions = yield* AuthSessions
    const headers = cookieHeaders(yield* authSessions.create(userId))
    const client = yield* RpcTest.makeClient(HistoryRpcs)
    return yield* client.ListHistory(undefined, { headers })
  })

describe('history flows via ListHistory (TestClock)', () => {
  it.scoped(
    'host starts, ticker crosses into work, second user joins then leaves mid-session, host leaves last — both ListHistory records hold workoutName, as-run snapshot, host, startedAt, endedAt, and timer-position progress',
    () =>
      Effect.gen(function* () {
        yield* seedUser(alice.userId, 'Alice')
        yield* seedUser(bob.userId, 'Bob')
        const svc = yield* LiveSessions
        const { id } = yield* startFixture(svc)

        // Sequence matters: advance first so the ticker crosses into work, THEN
        // bob joins the roster and leaves mid-session, THEN the host leaves last.
        yield* TestClock.adjust('5 seconds')
        yield* watchThenLeave(svc, id, bob)
        yield* svc.leaveSession(id, bob.userId)
        expect((yield* svc.snapshot(id)).participants.map((p) => p.userId)).not.toContain(
          bob.userId,
        )
        // The host, the last ever-participant, leaves — ending the session.
        yield* svc.leaveSession(id, alice.userId)

        const aliceHistory = yield* listHistoryFor(alice.userId)
        const bobHistory = yield* listHistoryFor(bob.userId)
        expect(aliceHistory).toHaveLength(1)
        expect(bobHistory).toHaveLength(1)

        const aliceRecord = aliceHistory[0]
        const bobRecord = bobHistory[0]
        if (aliceRecord === undefined || bobRecord === undefined) {
          throw new Error('expected a ListHistory record')
        }
        for (const record of [aliceRecord, bobRecord]) {
          expect(record.workoutName).toBe('Fixture')
          expect(record.workout).toEqual(fixtureWorkout)
          expect(record.host).toEqual(alice)
          // Span from the test clock: started at epoch 0, personal end at 5s.
          expect(DateTime.toEpochMillis(record.startedAt)).toBe(0)
          expect(DateTime.toEpochMillis(record.endedAt)).toBe(5000)
          // Progress rides the wire: furthest segment entered is 1 of 4.
          expect(record.progress?.segmentsCompleted).toBe(1)
          expect(record.progress?.totalSegments).toBe(4)
        }
        // Per-leaver participants: bob left first (both rostered), alice last.
        expect(participantIdsSorted(bobRecord)).toEqual([alice.userId, bob.userId])
        expect(participantIdsSorted(aliceRecord)).toEqual([alice.userId])
        // Distinct records — a fresh id each, filed under different users.
        expect(aliceRecord.id).not.toBe(bobRecord.id)
      }).pipe(Effect.provide(FlowLive)),
  )

  it.scoped(
    'leaving during ready writes no records for anyone; a progressed session GC’d after 60 idle seconds writes them',
    () =>
      Effect.gen(function* () {
        yield* seedUser(alice.userId, 'Alice')
        yield* seedUser(bob.userId, 'Bob')
        const svc = yield* LiveSessions

        // (a) Leave while still in the ready segment — ListHistory empty for both.
        {
          const { id } = yield* startFixture(svc)
          yield* watchThenLeave(svc, id, bob)
          yield* svc.leaveSession(id, bob.userId)
          yield* svc.leaveSession(id, alice.userId)

          expect(yield* listHistoryFor(alice.userId)).toHaveLength(0)
          expect(yield* listHistoryFor(bob.userId)).toHaveLength(0)
        }

        // (b) Progress past ready, abandon with no subscribers for 60 idle
        // TestClock seconds — GC writes completions; ListHistory shows them.
        {
          const { id } = yield* startFixture(svc)
          yield* watchThenLeave(svc, id, bob)
          yield* svc.command(id, 'skip')
          yield* svc.command(id, 'pause')

          // 59s of abandonment: still live, nothing on the read path yet.
          yield* TestClock.adjust('59 seconds')
          expect(yield* svc.list()).toHaveLength(1)
          expect(yield* listHistoryFor(alice.userId)).toHaveLength(0)

          // Crossing 60s GCs the session; ListHistory then holds the records.
          yield* TestClock.adjust('1 seconds')
          expect(yield* svc.list()).toHaveLength(0)

          const aliceHistory = yield* listHistoryFor(alice.userId)
          const bobHistory = yield* listHistoryFor(bob.userId)
          expect(aliceHistory).toHaveLength(1)
          expect(bobHistory).toHaveLength(1)
          const aliceRecord = aliceHistory[0]
          const bobRecord = bobHistory[0]
          if (aliceRecord === undefined || bobRecord === undefined) {
            throw new Error('expected ListHistory records for both participants')
          }
          expect(aliceRecord.workoutName).toBe('Fixture')
          expect(bobRecord.workoutName).toBe('Fixture')
          expect(participantIdsSorted(aliceRecord)).toEqual([alice.userId, bob.userId])
          expect(participantIdsSorted(bobRecord)).toEqual([alice.userId, bob.userId])
        }
      }).pipe(Effect.provide(FlowLive)),
  )

  it.scoped(
    'a reflowed start records the reflowed Workout — the spec’s grouping, not the stored plan’s',
    () =>
      Effect.gen(function* () {
        const ownerId = uid('owner-rf')
        yield* seedUser(ownerId)
        // Multi-station source so a regroup visibly changes the workout.
        const source = new Workout({
          name: 'Reflow Snapshot Source',
          focus: 'hybrid',
          pods: [
            new Pod({
              name: 'Upper',
              stations: [new Station({ name: 'Push-up' }), new Station({ name: 'Sit-up' })],
            }),
            new Pod({ name: 'Lower', stations: [new Station({ name: 'Squat' })] }),
          ],
          flow: new Flow({
            type: 'sets',
            rounds: [new Round({ workSeconds: 40, restSeconds: 20 })],
          }),
        })
        const reflow = new Reflow({
          pods: [new ReflowPod({ name: 'All', stations: [2, 0, 1] })],
          flowType: 'laps',
        })
        const reflowed = applyReflow(source, reflow)
        if (Either.isLeft(reflowed)) {
          throw new Error('expected Right')
        }

        const workoutsRepo = yield* WorkoutsRepo
        const library = yield* workoutsRepo.insert(ownerId, source)
        const authSessions = yield* AuthSessions
        const headers = cookieHeaders(yield* authSessions.create(ownerId))
        const sessionClient = yield* RpcTest.makeClient(SessionRpcs)
        const summary = yield* sessionClient.StartSession(
          { workoutId: library.id, reflow },
          { headers },
        )

        // Progress past ready, then the host (sole ever-participant) leaves, so
        // a completion is written and the session ends.
        const svc = yield* LiveSessions
        yield* svc.command(summary.id, 'skip')
        yield* svc.leaveSession(summary.id, ownerId)

        const history = yield* listHistoryFor(ownerId)
        expect(history).toHaveLength(1)
        // Wire-shape snapshot is the reflowed workout — not the stored plan.
        expect(history[0]?.workout).toEqual(reflowed.right)
        expect(history[0]?.workout).not.toEqual(source)
      }).pipe(Effect.provide(FlowLive)),
  )
})
