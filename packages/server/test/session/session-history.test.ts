import { NodeContext } from '@effect/platform-node'
import { RpcTest } from '@effect/rpc'
import { SqliteClient } from '@effect/sql-sqlite-node'
import { describe, expect, it } from '@effect/vitest'
import {
  applyReflow,
  compile,
  Flow,
  Participant,
  Pod,
  Reflow,
  ReflowPod,
  ReflowRequest,
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
import * as Exit from 'effect/Exit'
import * as Layer from 'effect/Layer'
import * as Schema from 'effect/Schema'
import * as Scope from 'effect/Scope'
import * as Stream from 'effect/Stream'
import * as TestClock from 'effect/TestClock'

import { AuthSessions } from '../../src/auth/auth-sessions.js'
import { SESSION_COOKIE_NAME } from '../../src/auth/cookie.js'
import { AuthMiddlewareLive } from '../../src/auth/middleware.js'
import { UserRepo } from '../../src/auth/user-repo.js'
import { WorkoutsRepo } from '../../src/library/workouts-repo.js'
import { CompletionsRepo } from '../../src/session/completions-repo.js'
import { SessionHandlersLive } from '../../src/session/handlers.js'
import { LiveSessions } from '../../src/session/live-sessions.js'
import { MigratorLive } from '../../src/sql.js'

/**
 * The record-at-endSession behaviour of `LiveSessions` and the reflow snapshot
 * threaded by `StartSession`. These integration tests drive the live-session
 * registry over a real (migrated, in-memory) `CompletionsRepo` and assert via
 * `CompletionsRepo.listForUser` — the persistence, not `ListHistory`. They live
 * apart from `live-sessions.test.ts` / `handlers.test.ts` only because those
 * files sit at the max-lines cap.
 */

const SqlTestLive = MigratorLive.pipe(
  Layer.provideMerge(SqliteClient.layer({ filename: ':memory:' })),
  Layer.provideMerge(NodeContext.layer),
)

// One shared, memoized `LiveSessions` built over its `CompletionsRepo` — the
// same reference wherever both the test body and the handler layer need it, so
// they drive one registry and one connection.
const LiveSessionsLive = LiveSessions.Default.pipe(Layer.provide(CompletionsRepo.Default))

/** `LiveSessions` + `CompletionsRepo` + `UserRepo` over one migrated sqlite. */
const LiveLive = Layer.mergeAll(LiveSessionsLive, CompletionsRepo.Default, UserRepo.Default).pipe(
  Layer.provideMerge(SqlTestLive),
)

/**
 * The full `StartSession` stack (auth + workouts + live sessions + completions)
 * — for exercising reflow through the real handler.
 */
const HandlerLive = Layer.mergeAll(
  UserRepo.Default,
  AuthSessions.Default,
  WorkoutsRepo.Default,
  LiveSessionsLive,
  CompletionsRepo.Default,
  AuthMiddlewareLive.pipe(Layer.provide(Layer.mergeAll(AuthSessions.Default, UserRepo.Default))),
  SessionHandlersLive.pipe(Layer.provide(Layer.mergeAll(WorkoutsRepo.Default, LiveSessionsLive))),
).pipe(Layer.provideMerge(SqlTestLive))

/**
 * `LiveSessions` over a `CompletionsRepo` whose sqlite has no migrations run,
 * so `session_completions` does not exist and every `insertAll` fails
 * `SqlError` — the doomed-write case.
 */
const FailingLive = LiveSessions.Default.pipe(
  Layer.provide(
    CompletionsRepo.Default.pipe(
      Layer.provide(
        SqliteClient.layer({ filename: ':memory:' }).pipe(Layer.provide(NodeContext.layer)),
      ),
    ),
  ),
)

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

describe('session-history recording', () => {
  it.effect(
    'a progressed leaver is written one completion immediately — personal endedAt, timer-position progress, roster-at-leave participants',
    () =>
      Effect.gen(function* () {
        yield* seedUser(alice.userId, 'Alice')
        yield* seedUser(bob.userId, 'Bob')
        const svc = yield* LiveSessions
        const completionsRepo = yield* CompletionsRepo
        const { id } = yield* startFixture(svc)

        // bob joins the roster (add-only) so he is an ever-participant.
        yield* watchThenLeave(svc, id, bob)

        // Cross into segment 1: the session has now progressed.
        yield* TestClock.adjust('5 seconds')

        // bob leaves at t=5s — his row is written now, before anyone else leaves,
        // so its participants are the roster at write time (both alice and bob).
        yield* svc.leaveSession(id, bob.userId)
        const bobRecords = yield* completionsRepo.listForUser(bob.userId)
        expect(bobRecords).toHaveLength(1)
        // alice has no row yet — she never left, and no session-wide end fired.
        expect(yield* completionsRepo.listForUser(alice.userId)).toHaveLength(0)

        // alice (the host, the last ever-participant) leaves: the session ends,
        // and her own row is written with the roster at her leave time (just her).
        yield* svc.leaveSession(id, alice.userId)
        const aliceRecords = yield* completionsRepo.listForUser(alice.userId)
        expect(aliceRecords).toHaveLength(1)

        const bobRecord = bobRecords[0]
        const aliceRecord = aliceRecords[0]
        if (bobRecord === undefined || aliceRecord === undefined) {
          throw new Error('expected a record')
        }
        for (const record of [bobRecord, aliceRecord]) {
          expect(record.workoutName).toBe('Fixture')
          expect(record.workout).toEqual(fixtureWorkout)
          expect(record.host).toEqual(alice)
          // Span: started at epoch 0, personal endedAt at the leave time (5s).
          expect(DateTime.toEpochMillis(record.startedAt)).toBe(0)
          expect(DateTime.toEpochMillis(record.endedAt)).toBe(5000)
          // Progress is the published timer position: segment 1 of 4 segments.
          expect(record.progress?.segmentsCompleted).toBe(1)
          expect(record.progress?.totalSegments).toBe(4)
        }
        // Roster at write time: bob left first (both still rostered), alice last.
        expect(participantIdsSorted(bobRecord)).toEqual([alice.userId, bob.userId])
        expect(participantIdsSorted(aliceRecord)).toEqual([alice.userId])
        expect(bobRecord.id).not.toBe(aliceRecord.id)
      }).pipe(Effect.provide(LiveLive)),
  )

  it.effect('a participant leaving before progression is written no completion', () =>
    Effect.gen(function* () {
      yield* seedUser(alice.userId, 'Alice')
      yield* seedUser(bob.userId, 'Bob')
      const svc = yield* LiveSessions
      const completionsRepo = yield* CompletionsRepo
      const { id } = yield* startFixture(svc)

      // bob joins the roster, but the timer never leaves the ready segment;
      // both leaving ends the session with no rows written for anyone.
      yield* watchThenLeave(svc, id, bob)
      yield* svc.leaveSession(id, bob.userId)
      yield* svc.leaveSession(id, alice.userId)

      expect(yield* completionsRepo.listForUser(alice.userId)).toHaveLength(0)
      expect(yield* completionsRepo.listForUser(bob.userId)).toHaveLength(0)
    }).pipe(Effect.provide(LiveLive)),
  )

  it.effect(
    're-watching after leaving restores the user to the roster, so a later progressed end writes them a second-stint row',
    () =>
      Effect.gen(function* () {
        yield* seedUser(alice.userId, 'Alice')
        yield* seedUser(bob.userId, 'Bob')
        const svc = yield* LiveSessions
        const completionsRepo = yield* CompletionsRepo
        const { id } = yield* startFixture(svc)

        // Progress, then bob joins and leaves — his first-stint row is written.
        yield* svc.command(id, 'skip')
        yield* watchThenLeave(svc, id, bob)
        yield* svc.leaveSession(id, bob.userId)
        expect(yield* completionsRepo.listForUser(bob.userId)).toHaveLength(1)

        // He re-watches: the roster re-adds him and his departed flag clears.
        yield* watchThenLeave(svc, id, bob)
        expect(yield* svc.list()).toHaveLength(1)

        // Pause so only the abandonment clock runs; 60 idle seconds GC the
        // session, whose end writes one row per roster member — bob among them
        // again, giving him a second-stint row (two rows, one per stint).
        yield* svc.command(id, 'pause')
        yield* TestClock.adjust('60 seconds')
        expect(yield* svc.list()).toHaveLength(0)
        expect(yield* completionsRepo.listForUser(bob.userId)).toHaveLength(2)
      }).pipe(Effect.provide(LiveLive)),
  )

  it.effect('a progressed session GC’d after 60 idle seconds writes its completions', () =>
    Effect.gen(function* () {
      yield* seedUser(alice.userId, 'Alice')
      yield* seedUser(bob.userId, 'Bob')
      const svc = yield* LiveSessions
      const completionsRepo = yield* CompletionsRepo
      const { id } = yield* startFixture(svc)

      // bob joins the roster then leaves; skip progresses past ready; pause so
      // only the abandonment clock is in play.
      yield* watchThenLeave(svc, id, bob)
      yield* svc.command(id, 'skip')
      yield* svc.command(id, 'pause')

      // 59s of abandonment: still live, nothing written yet.
      yield* TestClock.adjust('59 seconds')
      expect(yield* svc.list()).toHaveLength(1)
      expect(yield* completionsRepo.listForUser(alice.userId)).toHaveLength(0)

      // Crossing 60s GCs the session, which writes the completions on the way out.
      yield* TestClock.adjust('1 seconds')
      expect(yield* svc.list()).toHaveLength(0)
      expect(yield* completionsRepo.listForUser(alice.userId)).toHaveLength(1)
      expect(yield* completionsRepo.listForUser(bob.userId)).toHaveLength(1)
    }).pipe(Effect.provide(LiveLive)),
  )

  it.effect('a failing insert still detaches the leaver and removes the ended session', () =>
    Effect.gen(function* () {
      const svc = yield* LiveSessions
      const { id } = yield* startFixture(svc)

      // Progress before subscribing so leaving attempts the (doomed) insert.
      yield* svc.command(id, 'skip')
      const scope = yield* Scope.make()
      const pull = yield* Scope.extend(scope)(Stream.toPull(svc.watch(id, bob)))
      yield* pull

      // bob leaves: his (doomed) completion write is logged and swallowed, and
      // his stream still ends.
      yield* svc.leaveSession(id, bob.userId)
      expect(Exit.isFailure(yield* Effect.exit(pull))).toBe(true)
      yield* Scope.close(scope, Exit.void)

      // The host leaving empties the roster and ends the session — again with a
      // doomed write — but the registry is still torn down.
      yield* svc.leaveSession(id, alice.userId)
      expect(yield* svc.list()).toHaveLength(0)
      expect(Exit.isFailure(yield* Effect.exit(svc.snapshot(id)))).toBe(true)
    }).pipe(Effect.provide(FailingLive)),
  )

  it.scoped('a session started with a reflow records the reflowed Workout as its snapshot', () =>
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
        flow: new Flow({ type: 'sets', rounds: [new Round({ workSeconds: 40, restSeconds: 20 })] }),
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
      const client = yield* RpcTest.makeClient(SessionRpcs)
      const summary = yield* client.StartSession(
        {
          workoutId: library.id,
          reflow: new ReflowRequest({ spec: reflow, sourceUpdatedAt: library.updatedAt }),
        },
        { headers },
      )

      // Progress past the ready segment, then the host leaves so a completion is
      // written — the host is the sole ever-participant, so this ends the session.
      const svc = yield* LiveSessions
      yield* svc.command(summary.id, 'skip')
      yield* svc.leaveSession(summary.id, ownerId)

      const records = yield* (yield* CompletionsRepo).listForUser(ownerId)
      expect(records).toHaveLength(1)
      // The recorded snapshot is the reflowed workout — the spec's grouping,
      // not the stored plan's.
      expect(records[0]?.workout).toEqual(reflowed.right)
      expect(records[0]?.workout).not.toEqual(source)
    }).pipe(Effect.provide(HandlerLive)),
  )
})
