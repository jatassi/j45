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
    'a progressed, then quit, session writes one completion per ever-participant (host + a watcher who left)',
    () =>
      Effect.gen(function* () {
        yield* seedUser(alice.userId, 'Alice')
        yield* seedUser(bob.userId, 'Bob')
        const svc = yield* LiveSessions
        const completionsRepo = yield* CompletionsRepo
        const { id } = yield* startFixture(svc)

        // bob watches, then leaves — he stays an ever-participant (the roster is
        // add-only) even though presence drops him.
        yield* watchThenLeave(svc, id, bob)
        expect((yield* svc.snapshot(id)).participants.map((p) => p.userId)).not.toContain(
          bob.userId,
        )

        // Cross into segment 1: the session has now progressed. Quit at t=5s.
        yield* TestClock.adjust('5 seconds')
        yield* svc.command(id, 'quit')

        const aliceRecords = yield* completionsRepo.listForUser(alice.userId)
        const bobRecords = yield* completionsRepo.listForUser(bob.userId)
        expect(aliceRecords).toHaveLength(1)
        expect(bobRecords).toHaveLength(1)

        for (const record of [aliceRecords[0], bobRecords[0]]) {
          if (record === undefined) {
            throw new Error('expected a record')
          }
          expect(record.workoutName).toBe('Fixture')
          expect(record.workout).toEqual(fixtureWorkout)
          expect(record.host).toEqual(alice)
          expect(participantIdsSorted(record)).toEqual([alice.userId, bob.userId])
          // Span comes from the test clock: started at epoch 0, ended at 5s.
          expect(DateTime.toEpochMillis(record.startedAt)).toBe(0)
          expect(DateTime.toEpochMillis(record.endedAt)).toBe(5000)
        }
        // Distinct records — a fresh id each, filed under different users.
        expect(aliceRecords[0]?.id).not.toBe(bobRecords[0]?.id)
      }).pipe(Effect.provide(LiveLive)),
  )

  it.effect('a session quit while still in the ready segment writes no completions', () =>
    Effect.gen(function* () {
      yield* seedUser(alice.userId, 'Alice')
      yield* seedUser(bob.userId, 'Bob')
      const svc = yield* LiveSessions
      const completionsRepo = yield* CompletionsRepo
      const { id } = yield* startFixture(svc)

      // bob joins the roster, but the timer never leaves the ready segment.
      yield* watchThenLeave(svc, id, bob)
      yield* svc.command(id, 'quit')

      expect(yield* completionsRepo.listForUser(alice.userId)).toHaveLength(0)
      expect(yield* completionsRepo.listForUser(bob.userId)).toHaveLength(0)
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

  it.effect('a failing insert still removes the session and completes the ended Deferred', () =>
    Effect.gen(function* () {
      const svc = yield* LiveSessions
      const { id } = yield* startFixture(svc)

      // Progress before subscribing so ending attempts the (doomed) insert, and
      // the subscriber's first element is the already-progressed snapshot — the
      // next pull can only be the ended interrupt.
      yield* svc.command(id, 'skip')
      const scope = yield* Scope.make()
      const pull = yield* Scope.extend(scope)(Stream.toPull(svc.watch(id, bob)))
      yield* pull
      yield* svc.command(id, 'quit')

      // The insert failed, but the ended Deferred still fired: the stream ends.
      expect(Exit.isFailure(yield* Effect.exit(pull))).toBe(true)
      yield* Scope.close(scope, Exit.void)

      // And the session is gone from the registry despite the write failing.
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
      const summary = yield* client.StartSession({ workoutId: library.id, reflow }, { headers })

      // Progress past the ready segment, then quit so a completion is written.
      const svc = yield* LiveSessions
      yield* svc.command(summary.id, 'skip')
      yield* svc.command(summary.id, 'quit')

      const records = yield* (yield* CompletionsRepo).listForUser(ownerId)
      expect(records).toHaveLength(1)
      // The recorded snapshot is the reflowed workout — the spec's grouping,
      // not the stored plan's.
      expect(records[0]?.workout).toEqual(reflowed.right)
      expect(records[0]?.workout).not.toEqual(source)
    }).pipe(Effect.provide(HandlerLive)),
  )
})
