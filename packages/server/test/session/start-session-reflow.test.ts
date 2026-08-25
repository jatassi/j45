import { NodeContext } from '@effect/platform-node'
import { RpcTest } from '@effect/rpc'
import { SqliteClient } from '@effect/sql-sqlite-node'
import { describe, expect, it } from '@effect/vitest'
import {
  applyReflow,
  compile,
  Flow,
  Pod,
  Reflow,
  ReflowPod,
  ReflowRequest,
  Round,
  SessionRpcs,
  Station,
  Workout,
  type UserId,
  type Username,
} from '@j45/domain'
import * as Duration from 'effect/Duration'
import * as Effect from 'effect/Effect'
import * as Either from 'effect/Either'
import * as Layer from 'effect/Layer'
import * as TestClock from 'effect/TestClock'

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
 * `StartSession` under a launch-time reflow — what the spec compiles to, the
 * specs it refuses, and the version precondition that keeps a spec from
 * resolving against a plan that changed underneath. Same seam
 * `test/session/handlers.test.ts` drives the rest of `SessionRpcs` from
 * (`RpcTest.makeClient` over `MigratorLive` on in-memory sqlite, through the
 * real `AuthMiddlewareLive`); its own file because reflow is a topic of its
 * own and `handlers.test.ts` sits at this repo's per-file line budget.
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

const makeWorkout = (name: string) =>
  new Workout({
    name,
    focus: 'cardio',
    pods: [new Pod({ name: 'Pod 1', stations: [new Station({ name: 'Rower' })] })],
    flow: new Flow({ type: 'laps', rounds: [new Round({ workSeconds: 40, restSeconds: 20 })] }),
  })

/** Three stations across two pods, so a regroup visibly changes what runs. */
const staleSource = new Workout({
  name: 'Stale Reflow Source',
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

/** Three stations again, all different — the same indices, other exercises. */
const staleSourceRewritten = new Workout({
  name: staleSource.name,
  focus: staleSource.focus,
  pods: [
    new Pod({
      name: 'Rewritten',
      stations: [
        new Station({ name: 'Burpee' }),
        new Station({ name: 'Row' }),
        new Station({ name: 'Lunge' }),
      ],
    }),
  ],
  flow: staleSource.flow,
})

describe('StartSession with a reflow', () => {
  it.scoped('compiles the reflowed workout and leaves the library row unchanged', () =>
    Effect.gen(function* () {
      const ownerId = 'owner-g' as UserId
      yield* insertUser(ownerId)
      // Multi-station source so a regroup visibly changes compile output.
      const source = new Workout({
        name: 'Reflow Source',
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
      const client = yield* RpcTest.makeClient(SessionRpcs)
      const summary = yield* client.StartSession(
        {
          workoutId: library.id,
          reflow: new ReflowRequest({ spec: reflow, sourceUpdatedAt: library.updatedAt }),
        },
        { headers },
      )
      const snap = yield* (yield* LiveSessions).snapshot(summary.id)
      expect(snap.compiled.segments).toEqual(compile(reflowed.right).segments)
      expect(snap.compiled.segments).not.toEqual(compile(source).segments)
      // Library row is untouched — reflow is session-local only.
      const stored = yield* workoutsRepo.getOwned(library.id, ownerId)
      expect(stored.workout).toEqual(source)
      expect(stored.createdAt).toEqual(library.createdAt)
      expect(stored.updatedAt).toEqual(library.updatedAt)
    }).pipe(Effect.provide(TestServicesLive)),
  )

  it.scoped('an out-of-range or duplicated station index fails ReflowInvalid', () =>
    Effect.gen(function* () {
      const ownerId = 'owner-h' as UserId
      yield* insertUser(ownerId)
      const workoutsRepo = yield* WorkoutsRepo
      const library = yield* workoutsRepo.insert(ownerId, makeWorkout('Invalid Reflow Source'))
      const authSessions = yield* AuthSessions
      const headers = cookieHeaders(yield* authSessions.create(ownerId))
      const client = yield* RpcTest.makeClient(SessionRpcs)
      for (const reflow of [
        new Reflow({
          pods: [new ReflowPod({ name: 'Bad', stations: [0, 99] })],
          flowType: 'sets',
        }),
        new Reflow({
          pods: [new ReflowPod({ name: 'Dup', stations: [0, 0] })],
          flowType: 'laps',
        }),
      ]) {
        const attempt = yield* Effect.either(
          client.StartSession(
            {
              workoutId: library.id,
              reflow: new ReflowRequest({ spec: reflow, sourceUpdatedAt: library.updatedAt }),
            },
            { headers },
          ),
        )
        expect(Either.isLeft(attempt)).toBe(true)
        if (Either.isLeft(attempt)) {
          expect(attempt.left._tag).toBe('ReflowInvalid')
        }
      }
    }).pipe(Effect.provide(TestServicesLive)),
  )
  it.scoped(
    'a spec built against an older version of the source fails ReflowInvalid rather than starting a session over different stations',
    () =>
      Effect.gen(function* () {
        const ownerId = 'owner-sr' as UserId
        yield* insertUser(ownerId)
        const workoutsRepo = yield* WorkoutsRepo
        const library = yield* workoutsRepo.insert(ownerId, staleSource)

        // The spec the launch screen built from the copy it had on screen.
        const spec = new Reflow({
          pods: [new ReflowPod({ name: 'All', stations: [2, 0, 1] })],
          flowType: 'laps',
        })

        // Another device rewrites the plan underneath. The indices still
        // resolve — they just resolve to entirely different stations now,
        // which is exactly what makes this failure mode silent.
        yield* TestClock.adjust(Duration.seconds(5))
        yield* workoutsRepo.update({
          id: library.id,
          ownerId,
          workout: staleSourceRewritten,
          expectedUpdatedAt: library.updatedAt,
        })

        const authSessions = yield* AuthSessions
        const headers = cookieHeaders(yield* authSessions.create(ownerId))
        const client = yield* RpcTest.makeClient(SessionRpcs)
        const attempt = yield* Effect.either(
          client.StartSession(
            {
              workoutId: library.id,
              reflow: new ReflowRequest({ spec, sourceUpdatedAt: library.updatedAt }),
            },
            { headers },
          ),
        )

        expect(Either.isLeft(attempt)).toBe(true)
        if (Either.isLeft(attempt)) {
          expect(attempt.left._tag).toBe('ReflowInvalid')
        }
        // Nothing was started over the wrong stations.
        expect(yield* lobbyNow(yield* LiveSessions)).toHaveLength(0)
      }).pipe(Effect.provide(TestServicesLive)),
  )
})
