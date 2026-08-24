import { NodeContext } from '@effect/platform-node'
import { RpcTest } from '@effect/rpc'
import { SqliteClient } from '@effect/sql-sqlite-node'
import { describe, expect, it } from '@effect/vitest'
import {
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
  type SessionId,
  type UserId,
  type Username,
  type WorkoutId,
} from '@j45/domain'
import * as Duration from 'effect/Duration'
import * as Effect from 'effect/Effect'
import * as Either from 'effect/Either'
import * as Exit from 'effect/Exit'
import * as Layer from 'effect/Layer'
import * as Option from 'effect/Option'
import * as Scope from 'effect/Scope'
import * as Stream from 'effect/Stream'

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

/**
 * The exact `MigratorLive` layer the server entrypoint runs at startup,
 * against an in-memory `@effect/sql-sqlite-node` driver — same pattern as
 * `test/library/handlers.test.ts`.
 */
const SqlTestLive = MigratorLive.pipe(
  Layer.provideMerge(SqliteClient.layer({ filename: ':memory:' })),
  Layer.provideMerge(NodeContext.layer),
)

/**
 * Every service this test drives directly (`UserRepo`/`AuthSessions` to
 * seed accounts and sessions, `WorkoutsRepo` to seed fixture workouts,
 * `LiveSessions` for direct snapshot checks) plus `AuthMiddlewareLive` and
 * `SessionHandlersLive` themselves — the exact handler layer this task
 * lands, wired to the exact middleware `server.ts` guards `SessionRpcs`
 * with, sharing one in-memory sqlite connection and one live-session
 * registry.
 */
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
    pods: [new Pod({ name: 'Pod 1', stations: [new Station({ name: 'Rower' })] })],
    flow: new Flow({ type: 'laps', rounds: [new Round({ workSeconds: 40, restSeconds: 20 })] }),
  })

const insertUser = (id: UserId, displayName = 'Test User') =>
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

const cookieHeaders = (token: string) => ({
  cookie: `${SESSION_COOKIE_NAME}=${token}`,
})

/**
 * RpcServer applies stream Interrupt via interruptAsFork, so leave is async
 * relative to Scope.close — poll until `userId` is gone from participants.
 */
const awaitParticipantGone = (liveSessions: LiveSessions, id: SessionId, userId: UserId) =>
  Effect.gen(function* () {
    for (let i = 0; i < 50; i++) {
      const snap = yield* liveSessions.snapshot(id)
      if (!snap.participants.some((participant) => participant.userId === userId)) {
        return snap
      }
      yield* Effect.sleep(Duration.millis(5))
    }
    return yield* liveSessions.snapshot(id)
  })

describe('SessionHandlersLive', () => {
  it.scoped('StartSession with another user’s or an unknown workout id fails WorkoutNotFound', () =>
    Effect.gen(function* () {
      const ownerA = 'owner-a' as UserId
      const ownerB = 'owner-b' as UserId
      yield* insertUser(ownerA)
      yield* insertUser(ownerB)

      const workoutsRepo = yield* WorkoutsRepo
      const bWorkout = yield* workoutsRepo.insert(ownerB, makeWorkout('Owner B’s Workout'))

      const authSessions = yield* AuthSessions
      const tokenA = yield* authSessions.create(ownerA)
      const headers = cookieHeaders(tokenA)

      const client = yield* RpcTest.makeClient(SessionRpcs)
      // Valid reflow — ownership/existence short-circuits before reflow validation.
      const reflow = new ReflowRequest({
        spec: new Reflow({
          pods: [new ReflowPod({ name: 'Any', stations: [0] })],
          flowType: 'laps',
        }),
        sourceUpdatedAt: bWorkout.updatedAt,
      })
      const absentId = '00000000-0000-4000-8000-000000000099' as WorkoutId
      for (const payload of [
        { workoutId: bWorkout.id },
        { workoutId: bWorkout.id, reflow },
        { workoutId: absentId },
        { workoutId: absentId, reflow },
      ] as const) {
        const attempt = yield* Effect.either(client.StartSession(payload, { headers }))
        expect(Either.isLeft(attempt)).toBe(true)
        if (Either.isLeft(attempt)) {
          expect(attempt.left._tag).toBe('WorkoutNotFound')
        }
      }
    }).pipe(Effect.provide(TestServicesLive)),
  )

  it.scoped(
    'WatchSession and SendSessionCommand against an unknown SessionId fail SessionNotFound',
    () =>
      Effect.gen(function* () {
        const ownerId = 'owner-c' as UserId
        yield* insertUser(ownerId)

        const authSessions = yield* AuthSessions
        const token = yield* authSessions.create(ownerId)
        const headers = cookieHeaders(token)

        const client = yield* RpcTest.makeClient(SessionRpcs)
        const unknownId = '00000000-0000-4000-8000-000000000001' as SessionId

        const watchAttempt = yield* Effect.either(
          Stream.runHead(client.WatchSession({ id: unknownId }, { headers })),
        )
        expect(Either.isLeft(watchAttempt)).toBe(true)
        if (Either.isLeft(watchAttempt)) {
          expect(watchAttempt.left._tag).toBe('SessionNotFound')
        }

        const commandAttempt = yield* Effect.either(
          client.SendSessionCommand({ id: unknownId, command: 'pause' }, { headers }),
        )
        expect(Either.isLeft(commandAttempt)).toBe(true)
        if (Either.isLeft(commandAttempt)) {
          expect(commandAttempt.left._tag).toBe('SessionNotFound')
        }
      }).pipe(Effect.provide(TestServicesLive)),
  )

  it.scoped('every SessionRpcs member without a valid session cookie fails Unauthorized', () =>
    Effect.gen(function* () {
      const ownerId = 'owner-d' as UserId
      yield* insertUser(ownerId)

      const workoutsRepo = yield* WorkoutsRepo
      const workout = yield* workoutsRepo.insert(ownerId, makeWorkout('Auth Fixture'))

      const client = yield* RpcTest.makeClient(SessionRpcs)
      const sessionId = '00000000-0000-4000-8000-000000000002' as SessionId
      const noHeaders = {}
      const badHeaders = cookieHeaders('not-a-real-token')

      const tagOf = <E extends { readonly _tag: string }>(either: Either.Either<unknown, E>) =>
        Either.isLeft(either) ? either.left._tag : either

      for (const headers of [noHeaders, badHeaders]) {
        const startTag = tagOf(
          yield* Effect.either(client.StartSession({ workoutId: workout.id }, { headers })),
        )
        const listTag = tagOf(
          yield* Effect.either(client.ListActiveSessions(undefined, { headers })),
        )
        const watchTag = tagOf(
          yield* Effect.either(Stream.runHead(client.WatchSession({ id: sessionId }, { headers }))),
        )
        const commandTag = tagOf(
          yield* Effect.either(
            client.SendSessionCommand({ id: sessionId, command: 'pause' }, { headers }),
          ),
        )

        expect(startTag).toBe('Unauthorized')
        expect(listTag).toBe('Unauthorized')
        expect(watchTag).toBe('Unauthorized')
        expect(commandTag).toBe('Unauthorized')
      }
    }).pipe(Effect.provide(TestServicesLive)),
  )

  // `scopedLive`: RpcServer stream Interrupt is applied via interruptAsFork
  // (real async), so leave only settles after the live runtime schedules the
  // interrupted request fiber's finalizers — TestClock cannot drive that.
  it.scopedLive(
    'WatchSession subscription adds the caller to participants and release removes them',
    () =>
      Effect.gen(function* () {
        const hostId = 'host-e' as UserId
        const guestId = 'guest-e' as UserId
        yield* insertUser(hostId, 'Host User')
        yield* insertUser(guestId, 'Guest User')

        const workoutsRepo = yield* WorkoutsRepo
        const workout = yield* workoutsRepo.insert(hostId, makeWorkout('Presence Fixture'))

        const authSessions = yield* AuthSessions
        const hostToken = yield* authSessions.create(hostId)
        const guestToken = yield* authSessions.create(guestId)
        const hostHeaders = cookieHeaders(hostToken)
        const guestHeaders = cookieHeaders(guestToken)

        const client = yield* RpcTest.makeClient(SessionRpcs)
        const summary = yield* client.StartSession(
          { workoutId: workout.id },
          { headers: hostHeaders },
        )

        // Host watches first so the participant list starts with the host.
        // Mailbox form keeps the stream open until the owning scope closes —
        // the same acquire/release lifecycle a real rpc socket would use.
        const hostScope = yield* Scope.make()
        const hostMailbox = yield* Scope.extend(hostScope)(
          client.WatchSession({ id: summary.id }, { headers: hostHeaders, asMailbox: true }),
        )
        const hostFirst = yield* hostMailbox.take
        expect(hostFirst.participants).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ userId: hostId, displayName: 'Host User' }),
          ]),
        )

        // Guest joins: first emission must already list them.
        const guestScope = yield* Scope.make()
        const guestMailbox = yield* Scope.extend(guestScope)(
          client.WatchSession({ id: summary.id }, { headers: guestHeaders, asMailbox: true }),
        )
        const guestFirst = yield* guestMailbox.take
        expect(guestFirst.participants).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ userId: guestId, displayName: 'Guest User' }),
          ]),
        )

        // Releasing the guest subscription removes them; host remains.
        yield* Scope.close(guestScope, Exit.void)
        const liveSessions = yield* LiveSessions
        const afterLeave = yield* awaitParticipantGone(liveSessions, summary.id, guestId)
        expect(afterLeave.participants.map((p) => p.userId)).toEqual([hostId])
        expect(afterLeave.participants.map((p) => p.displayName)).toEqual(['Host User'])

        yield* Scope.close(hostScope, Exit.void)
      }).pipe(Effect.provide(TestServicesLive)),
  )

  it.scoped(
    'session serves its own compiled copy — updating/deleting the source workout leaves segments unchanged',
    () =>
      Effect.gen(function* () {
        const ownerId = 'owner-f' as UserId
        yield* insertUser(ownerId, 'Owner F')

        const workoutsRepo = yield* WorkoutsRepo
        const original = makeWorkout('Snapshot Source')
        const library = yield* workoutsRepo.insert(ownerId, original)
        const expectedCompiled = compile(original)

        const authSessions = yield* AuthSessions
        const token = yield* authSessions.create(ownerId)
        const headers = cookieHeaders(token)

        const client = yield* RpcTest.makeClient(SessionRpcs)
        const summary = yield* client.StartSession({ workoutId: library.id }, { headers })

        const liveSessions = yield* LiveSessions
        const before = yield* liveSessions.snapshot(summary.id)
        expect(before.compiled.segments).toEqual(expectedCompiled.segments)

        // Mutate and then delete the library row the session was started from.
        const replacement = new Workout({
          name: 'Totally Different',
          focus: 'strength',
          pods: [
            new Pod({
              name: 'Pod X',
              stations: [new Station({ name: 'Bike' }), new Station({ name: 'Ski' })],
            }),
          ],
          flow: new Flow({
            type: 'sets',
            rounds: [new Round({ workSeconds: 45, restSeconds: 15 })],
          }),
        })
        yield* workoutsRepo.update({
          id: library.id,
          ownerId,
          workout: replacement,
          expectedUpdatedAt: library.updatedAt,
        })
        yield* workoutsRepo.delete(library.id, ownerId)

        // Session still serves the compile taken at StartSession.
        const after = yield* liveSessions.snapshot(summary.id)
        expect(after.compiled.segments).toEqual(expectedCompiled.segments)
        expect(after.compiled.segments).not.toEqual(compile(replacement).segments)
        expect(after.workoutName).toBe('Snapshot Source')

        // Same truth via a fresh WatchSession pull.
        const first = yield* Stream.runHead(client.WatchSession({ id: summary.id }, { headers }))
        expect(Option.isSome(first)).toBe(true)
        if (Option.isSome(first)) {
          expect(first.value.compiled.segments).toEqual(expectedCompiled.segments)
        }
      }).pipe(Effect.provide(TestServicesLive)),
  )
})
