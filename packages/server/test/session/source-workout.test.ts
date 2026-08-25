import { NodeContext } from '@effect/platform-node'
import { RpcTest } from '@effect/rpc'
import { SqliteClient } from '@effect/sql-sqlite-node'
import { describe, expect, it } from '@effect/vitest'
import {
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
  WorkoutId,
  type Username,
} from '@j45/domain'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import * as Schema from 'effect/Schema'

import { AuthSessions } from '../../src/auth/auth-sessions.js'
import { SESSION_COOKIE_NAME } from '../../src/auth/cookie.js'
import { AuthMiddlewareLive } from '../../src/auth/middleware.js'
import { UserRepo } from '../../src/auth/user-repo.js'
import { PlanChanges } from '../../src/library/plan-changes.js'
import { WorkoutsRepo } from '../../src/library/workouts-repo.js'
import { CompletionsRepo } from '../../src/session/completions-repo.js'
import { SessionHandlersLive } from '../../src/session/handlers.js'
import { LiveSessions } from '../../src/session/live-sessions.js'
import { MigratorLive } from '../../src/sql.js'
import { lobbyNow } from './plan-flow-harness.js'

/**
 * A live session's link back to the library workout that it started from: the
 * id on every lobby summary, the reverse lookup from that id to the sessions
 * that run it, and the launch-time reflow that tracks nothing.
 *
 * Two seams, both public: `LiveSessions` directly for the registry behaviour,
 * and `SessionRpcs` through `RpcTest.makeClient` for the handler wiring — the
 * same harnesses `test/session/live-sessions.test.ts` and
 * `test/session/start-session-reflow.test.ts` use.
 */
const SqlTestLive = MigratorLive.pipe(
  Layer.provideMerge(SqliteClient.layer({ filename: ':memory:' })),
  Layer.provideMerge(NodeContext.layer),
)

const LiveSessionsLive = LiveSessions.Default.pipe(
  Layer.provide(Layer.mergeAll(CompletionsRepo.Default, PlanChanges.Default)),
)

const TestServicesLive = Layer.mergeAll(
  UserRepo.Default,
  AuthSessions.Default,
  WorkoutsRepo.Default,
  LiveSessionsLive,
  CompletionsRepo.Default,
  AuthMiddlewareLive.pipe(Layer.provide(Layer.mergeAll(AuthSessions.Default, UserRepo.Default))),
  SessionHandlersLive.pipe(Layer.provide(Layer.mergeAll(WorkoutsRepo.Default, LiveSessionsLive))),
).pipe(Layer.provideMerge(SqlTestLive))

const makeWorkout = (name: string) =>
  new Workout({
    name,
    focus: 'cardio',
    pods: [
      new Pod({ name: 'P', stations: [new Station({ name: 'A' }), new Station({ name: 'B' })] }),
    ],
    flow: new Flow({ type: 'laps', rounds: [new Round({ workSeconds: 10, restSeconds: 5 })] }),
  })

const workoutId = (id: string) => Schema.decodeSync(WorkoutId)(id)
const alice = new Participant({
  userId: Schema.decodeSync(UserId)('alice'),
  displayName: 'Alice',
})

/** Starts a session tracking `id`, with no launch-time reflow. */
const startTracking = (svc: LiveSessions, id: WorkoutId, name = 'Fixture') => {
  const workout = makeWorkout(name)
  return svc.start({
    host: alice,
    workoutId: id,
    workoutName: name,
    workout,
    compiled: compile(workout),
    reflowLaunched: false,
  })
}

const insertUser = (id: UserId) =>
  Effect.gen(function* () {
    const userRepo = yield* UserRepo
    yield* userRepo.insert({
      id,
      username: `${id}-username` as Username,
      displayName: 'Test User',
      role: 'member',
      pinHash: 'irrelevant-for-this-test',
      createdAt: '2020-01-01T00:00:00.000Z',
    })
  })

const cookieHeaders = (token: string) => ({ cookie: `${SESSION_COOKIE_NAME}=${token}` })

describe('a live session and its source workout', () => {
  it.effect('every lobby summary carries the id of the workout it was started from', () =>
    Effect.gen(function* () {
      const svc = yield* LiveSessions
      const first = workoutId('workout-1')
      const second = workoutId('workout-2')

      const started = yield* startTracking(svc, first, 'First')
      yield* startTracking(svc, second, 'Second')

      expect(started.workoutId).toBe(first)
      const listed = yield* lobbyNow(svc)
      expect(new Set(listed.map((summary) => summary.workoutId))).toEqual(new Set([first, second]))
    }).pipe(Effect.provide(LiveSessionsLive.pipe(Layer.provideMerge(SqlTestLive)))),
  )

  it.effect('several sessions on one workout all enumerate from that workout’s id', () =>
    Effect.gen(function* () {
      const svc = yield* LiveSessions
      const shared = workoutId('workout-shared')
      const other = workoutId('workout-other')

      const one = yield* startTracking(svc, shared, 'Shared')
      const two = yield* startTracking(svc, shared, 'Shared')
      const unrelated = yield* startTracking(svc, other, 'Other')

      const found = yield* svc.sessionsOfWorkout(shared)
      expect(new Set(found.tracking.map((summary) => summary.id))).toEqual(
        new Set([one.id, two.id]),
      )
      expect(found.tracking.map((summary) => summary.id)).not.toContain(unrelated.id)
      expect(found.reflowLaunched).toEqual([])

      expect(yield* svc.sessionsOfWorkout(workoutId('workout-none'))).toEqual({
        tracking: [],
        reflowLaunched: [],
      })
    }).pipe(Effect.provide(LiveSessionsLive.pipe(Layer.provideMerge(SqlTestLive)))),
  )

  it.effect('a reflow-launched session holds its source id but tracks nothing', () =>
    Effect.gen(function* () {
      const svc = yield* LiveSessions
      const source = workoutId('workout-reflowed')
      const workout = makeWorkout('Reflowed')

      const summary = yield* svc.start({
        host: alice,
        workoutId: source,
        workoutName: 'Reflowed',
        workout,
        compiled: compile(workout),
        reflowLaunched: true,
      })
      const plain = yield* startTracking(svc, source, 'Reflowed')

      // Both started from the same workout, and the lookup tells them apart.
      expect(summary.workoutId).toBe(source)
      const found = yield* svc.sessionsOfWorkout(source)
      expect(found.tracking.map((each) => each.id)).toEqual([plain.id])
      expect(found.reflowLaunched.map((each) => each.id)).toEqual([summary.id])
    }).pipe(Effect.provide(LiveSessionsLive.pipe(Layer.provideMerge(SqlTestLive)))),
  )

  it.scoped('StartSession tracks the launched workout, and a reflow launch does not', () =>
    Effect.gen(function* () {
      const owner = 'ownersrc' as UserId
      yield* insertUser(owner)
      const workoutsRepo = yield* WorkoutsRepo
      const plain = yield* workoutsRepo.insert(owner, makeWorkout('Plain'))
      const overlaid = yield* workoutsRepo.insert(owner, makeWorkout('Overlaid'))

      const authSessions = yield* AuthSessions
      const headers = cookieHeaders(yield* authSessions.create(owner))
      const client = yield* RpcTest.makeClient(SessionRpcs)

      const plainSummary = yield* client.StartSession({ workoutId: plain.id }, { headers })
      const reflowSummary = yield* client.StartSession(
        {
          workoutId: overlaid.id,
          reflow: new ReflowRequest({
            spec: new Reflow({
              pods: [new ReflowPod({ name: 'Only', stations: [0] })],
              flowType: 'laps',
            }),
            sourceUpdatedAt: overlaid.updatedAt,
          }),
        },
        { headers },
      )

      expect(plainSummary.workoutId).toBe(plain.id)
      expect(reflowSummary.workoutId).toBe(overlaid.id)

      const liveSessions = yield* LiveSessions
      const fromPlain = yield* liveSessions.sessionsOfWorkout(plain.id)
      expect(fromPlain.tracking.map((each) => each.id)).toEqual([plainSummary.id])
      const fromOverlaid = yield* liveSessions.sessionsOfWorkout(overlaid.id)
      expect(fromOverlaid.tracking).toEqual([])
      expect(fromOverlaid.reflowLaunched.map((each) => each.id)).toEqual([reflowSummary.id])
    }).pipe(Effect.provide(TestServicesLive)),
  )
})
