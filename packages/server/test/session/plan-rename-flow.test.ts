import { NodeContext } from '@effect/platform-node'
import { RpcTest } from '@effect/rpc'
import { SqliteClient } from '@effect/sql-sqlite-node'
import { describe, expect, it } from '@effect/vitest'
import {
  Flow,
  LibraryRpcs,
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
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import * as Queue from 'effect/Queue'
import * as Schema from 'effect/Schema'
import * as Stream from 'effect/Stream'

import { AuthSessions } from '../../src/auth/auth-sessions.js'
import { SESSION_COOKIE_NAME } from '../../src/auth/cookie.js'
import { AuthMiddlewareLive } from '../../src/auth/middleware.js'
import { UserRepo } from '../../src/auth/user-repo.js'
import { LibraryHandlersLive } from '../../src/library/handlers.js'
import { PlanChanges } from '../../src/library/plan-changes.js'
import { WorkoutsRepo } from '../../src/library/workouts-repo.js'
import { CompletionsRepo } from '../../src/session/completions-repo.js'
import { SessionHandlersLive } from '../../src/session/handlers.js'
import { LiveSessions } from '../../src/session/live-sessions.js'
import { MigratorLive } from '../../src/sql.js'

/**
 * Renaming a library workout, observed only where a user can see it: the
 * session snapshot each participant holds, and the lobby listing. The
 * notification seam between the library handlers and `LiveSessions` is
 * deliberately never touched here — it is implementation.
 */

const SqlTestLive = MigratorLive.pipe(
  Layer.provideMerge(SqliteClient.layer({ filename: ':memory:' })),
  Layer.provideMerge(NodeContext.layer),
)

// One memoized `PlanChanges`: the library handlers publish into it and
// `LiveSessions` consumes from it, exactly as `server.ts` wires them.
const LiveSessionsLive = LiveSessions.Default.pipe(
  Layer.provide(Layer.mergeAll(CompletionsRepo.Default, PlanChanges.Default)),
)

const FlowLive = Layer.mergeAll(
  UserRepo.Default,
  AuthSessions.Default,
  WorkoutsRepo.Default,
  PlanChanges.Default,
  LiveSessionsLive,
  AuthMiddlewareLive.pipe(Layer.provide(Layer.mergeAll(AuthSessions.Default, UserRepo.Default))),
  LibraryHandlersLive.pipe(
    Layer.provide(Layer.mergeAll(WorkoutsRepo.Default, PlanChanges.Default)),
  ),
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

const uid = (id: string) => Schema.decodeSync(UserId)(id)
const owner = uid('owner')
const bob = new Participant({ userId: uid('bob'), displayName: 'Bob' })

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

/** The owner's request headers, plus a client for each rpc group under test. */
const asOwner = Effect.gen(function* () {
  yield* seedUser(owner, 'Owner')
  const authSessions = yield* AuthSessions
  const headers = cookieHeaders(yield* authSessions.create(owner))
  const library = yield* RpcTest.makeClient(LibraryRpcs)
  const sessions = yield* RpcTest.makeClient(SessionRpcs)
  return { headers, library, sessions } as const
})

/** The lobby row for one session, by id. */
const lobbyRow = (svc: LiveSessions, id: SessionId) =>
  Effect.map(svc.list(), (rows) => rows.find((row) => row.id === id))

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

  it.scoped('renaming a workout with no live session behaves exactly as before', () =>
    Effect.gen(function* () {
      const { headers, library } = yield* asOwner
      const created = yield* library.CreateWorkout({ workout: makeWorkout('Old') }, { headers })

      const result = yield* library.RenameWorkout({ id: created.id, name: 'New' }, { headers })

      expect(result.workout.name).toBe('New')
      expect((yield* library.GetWorkout({ id: created.id }, { headers })).workout.name).toBe('New')
      expect(yield* (yield* LiveSessions).list()).toEqual([])
    }).pipe(Effect.provide(FlowLive)),
  )
})
