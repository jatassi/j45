import { mkdtemp, rm } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { NodeContext } from '@effect/platform-node'
import { RpcTest } from '@effect/rpc'
import { SqliteClient } from '@effect/sql-sqlite-node'
import { describe, expect, it } from '@effect/vitest'
import {
  CompletionId,
  Flow,
  HistoryRpcs,
  Participant,
  Pod,
  Round,
  SessionCompletion,
  SessionId,
  SessionRpcs,
  Station,
  Workout,
  type UserId,
  type Username,
} from '@j45/domain'
import * as DateTime from 'effect/DateTime'
import * as Effect from 'effect/Effect'
import * as Either from 'effect/Either'
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
import { HistoryHandlersLive } from '../../src/session/history-handlers.js'
import { LiveSessions } from '../../src/session/live-sessions.js'
import { MigratorLive } from '../../src/sql.js'

const serverDir = path.dirname(fileURLToPath(import.meta.url))

/**
 * The exact `MigratorLive` layer the server entrypoint runs at startup,
 * against an in-memory `@effect/sql-sqlite-node` driver — same pattern as
 * `test/session/handlers.test.ts`.
 */
const SqlTestLive = MigratorLive.pipe(
  Layer.provideMerge(SqliteClient.layer({ filename: ':memory:' })),
  Layer.provideMerge(NodeContext.layer),
)

/**
 * Every service this test drives directly (`UserRepo`/`AuthSessions` to seed
 * accounts and sessions, `CompletionsRepo` to seed completion rows)
 * plus `AuthMiddlewareLive` and `HistoryHandlersLive` themselves — the exact
 * handler layer this task lands, wired to the exact middleware `server.ts`
 * guards `HistoryRpcs` with, sharing one in-memory sqlite connection.
 */
const TestServicesLive = Layer.mergeAll(
  UserRepo.Default,
  AuthSessions.Default,
  CompletionsRepo.Default,
  LiveSessions.Default.pipe(
    Layer.provide(Layer.mergeAll(CompletionsRepo.Default, PlanChanges.Default)),
  ),
  AuthMiddlewareLive.pipe(Layer.provide(Layer.mergeAll(AuthSessions.Default, UserRepo.Default))),
  HistoryHandlersLive.pipe(Layer.provide(CompletionsRepo.Default)),
).pipe(Layer.provideMerge(SqlTestLive))

/**
 * A fresh, file-backed services graph for the restart criterion. Each call
 * builds a structurally-identical but distinct layer instance so Effect's
 * layer memoization does not share `LiveSessions` (or anything else) across
 * the two "server lifetimes".
 */
const makeFileBackedServices = (dbPath: string) => {
  const sqlLive = MigratorLive.pipe(
    Layer.provideMerge(SqliteClient.layer({ filename: dbPath })),
    Layer.provideMerge(NodeContext.layer),
  )
  return Layer.mergeAll(
    UserRepo.Default,
    AuthSessions.Default,
    CompletionsRepo.Default,
    WorkoutsRepo.Default,
    LiveSessions.Default.pipe(
      Layer.provide(Layer.mergeAll(CompletionsRepo.Default, PlanChanges.Default)),
    ),
    AuthMiddlewareLive.pipe(Layer.provide(Layer.mergeAll(AuthSessions.Default, UserRepo.Default))),
    HistoryHandlersLive.pipe(Layer.provide(CompletionsRepo.Default)),
    SessionHandlersLive.pipe(
      Layer.provide(
        Layer.mergeAll(
          WorkoutsRepo.Default,
          LiveSessions.Default.pipe(
            Layer.provide(Layer.mergeAll(CompletionsRepo.Default, PlanChanges.Default)),
          ),
        ),
      ),
    ),
  ).pipe(Layer.provideMerge(sqlLive))
}

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

const makeWorkout = (name: string) =>
  new Workout({
    name,
    focus: 'cardio',
    pods: [new Pod({ name: 'Pod 1', stations: [new Station({ name: 'Burpee' })] })],
    flow: new Flow({
      type: 'laps',
      rounds: [new Round({ workSeconds: 40, restSeconds: 20 })],
    }),
  })

const makeCompletion = (input: {
  readonly id: string
  readonly sessionId: string
  readonly workoutName: string
  readonly hostUserId: UserId
  readonly startedAt: DateTime.Utc
  readonly endedAt: DateTime.Utc
  readonly extraParticipants?: readonly Participant[]
}) => {
  const host = new Participant({
    userId: input.hostUserId,
    displayName: 'Host',
  })
  const participants = [host, ...(input.extraParticipants ?? [])] as const
  return new SessionCompletion({
    id: Schema.decodeSync(CompletionId)(input.id),
    sessionId: Schema.decodeSync(SessionId)(input.sessionId),
    workoutName: input.workoutName,
    workout: makeWorkout(input.workoutName),
    host,
    participants,
    startedAt: input.startedAt,
    endedAt: input.endedAt,
  })
}

const removeDirRecursive = (dir: string) =>
  Effect.tryPromise({
    try: () => rm(dir, { recursive: true, force: true }),
    catch: (cause) => cause,
  }).pipe(Effect.ignore)

describe('HistoryHandlersLive', () => {
  it.scoped('ListHistory returns only the caller’s completions, newest-endedAt-first', () =>
    Effect.gen(function* () {
      const userA = 'user-a' as UserId
      const userB = 'user-b' as UserId
      yield* insertUser(userA)
      yield* insertUser(userB)

      const t0 = DateTime.unsafeMake('2020-01-01T00:00:00.000Z')
      const t1 = DateTime.unsafeMake('2020-01-01T00:00:10.000Z')
      const t2 = DateTime.unsafeMake('2020-01-01T00:00:20.000Z')

      const olderA = makeCompletion({
        id: 'completion-a-old',
        sessionId: 'session-old',
        workoutName: 'Older',
        hostUserId: userA,
        startedAt: t0,
        endedAt: t1,
      })
      const newerA = makeCompletion({
        id: 'completion-a-new',
        sessionId: 'session-new',
        workoutName: 'Newer',
        hostUserId: userA,
        startedAt: t1,
        endedAt: t2,
      })
      const onlyB = makeCompletion({
        id: 'completion-b',
        sessionId: 'session-b',
        workoutName: 'B Only',
        hostUserId: userB,
        startedAt: t0,
        endedAt: t2,
      })

      const completionsRepo = yield* CompletionsRepo
      // Insert out of chronological order to prove ORDER BY ended_at DESC.
      yield* completionsRepo.insertAll([
        { userId: userA, completion: newerA },
        { userId: userB, completion: onlyB },
        { userId: userA, completion: olderA },
      ])

      const authSessions = yield* AuthSessions
      const tokenA = yield* authSessions.create(userA)
      const tokenB = yield* authSessions.create(userB)
      const headersA = cookieHeaders(tokenA)
      const headersB = cookieHeaders(tokenB)

      const client = yield* RpcTest.makeClient(HistoryRpcs)

      const listA = yield* client.ListHistory(undefined, { headers: headersA })
      const listB = yield* client.ListHistory(undefined, { headers: headersB })

      expect(listA.map((c) => c.id)).toStrictEqual(['completion-a-new', 'completion-a-old'])
      expect(listA.map((c) => c.workoutName)).toStrictEqual(['Newer', 'Older'])
      expect(listA[0]).toStrictEqual(newerA)
      expect(listA[1]).toStrictEqual(olderA)

      expect(listB).toHaveLength(1)
      expect(listB[0]?.id).toBe('completion-b')
      expect(listB[0]).toStrictEqual(onlyB)
    }).pipe(Effect.provide(TestServicesLive)),
  )

  it.scoped('ListHistory without a valid session cookie fails Unauthorized', () =>
    Effect.gen(function* () {
      const userId = 'user-auth' as UserId
      yield* insertUser(userId)

      const client = yield* RpcTest.makeClient(HistoryRpcs)
      const noHeaders = {}
      const badHeaders = cookieHeaders('not-a-real-token')

      const tagOf = <E extends { readonly _tag: string }>(either: Either.Either<unknown, E>) =>
        Either.isLeft(either) ? either.left._tag : either

      for (const headers of [noHeaders, badHeaders]) {
        const listTag = tagOf(yield* Effect.either(client.ListHistory(undefined, { headers })))
        expect(listTag).toBe('Unauthorized')
      }
    }).pipe(Effect.provide(TestServicesLive)),
  )

  it.scoped(
    'rebuilding the server layer over the same database preserves session_completions while ListActiveSessions returns []',
    () =>
      Effect.gen(function* () {
        const dbDir = yield* Effect.acquireRelease(
          Effect.tryPromise(() => mkdtemp(path.join(serverDir, '.tmp-history-handlers-'))),
          removeDirRecursive,
        )
        const dbPath = path.join(dbDir, 'history.sqlite')

        const userId = 'user-rs' as UserId
        const completionId = 'completion-restart'
        const startedAt = DateTime.unsafeMake('2020-06-01T12:00:00.000Z')
        const endedAt = DateTime.unsafeMake('2020-06-01T12:30:00.000Z')
        const seededCompletion = makeCompletion({
          id: completionId,
          sessionId: 'session-restart',
          workoutName: 'Restart Workout',
          hostUserId: userId,
          startedAt,
          endedAt,
        })

        // First server lifetime: seed durable history + start an in-memory live session.
        yield* Effect.scoped(
          Effect.gen(function* () {
            yield* insertUser(userId, 'Restart User')

            const workoutsRepo = yield* WorkoutsRepo
            const library = yield* workoutsRepo.insert(userId, makeWorkout('Restart Workout'))

            const completionsRepo = yield* CompletionsRepo
            yield* completionsRepo.insertAll([{ userId, completion: seededCompletion }])

            const authSessions = yield* AuthSessions
            const token = yield* authSessions.create(userId)
            const headers = cookieHeaders(token)

            const sessionClient = yield* RpcTest.makeClient(SessionRpcs)
            yield* sessionClient.StartSession({ workoutId: library.id }, { headers })

            const active = yield* sessionClient.ListActiveSessions(undefined, { headers })
            expect(active).toHaveLength(1)

            const historyClient = yield* RpcTest.makeClient(HistoryRpcs)
            const history = yield* historyClient.ListHistory(undefined, { headers })
            expect(history).toHaveLength(1)
            expect(history[0]?.id).toBe(completionId)
          }).pipe(Effect.provide(makeFileBackedServices(dbPath))),
        )

        // Second, independent layer build over the same file — simulates a process restart.
        yield* Effect.scoped(
          Effect.gen(function* () {
            // Fresh auth cookie against the durable user row (sessions table
            // also persists, but a new mint matches a clean process boot).
            const authSessions = yield* AuthSessions
            const token = yield* authSessions.create(userId)
            const headers = cookieHeaders(token)

            const historyClient = yield* RpcTest.makeClient(HistoryRpcs)
            const history = yield* historyClient.ListHistory(undefined, { headers })
            expect(history).toHaveLength(1)
            expect(history[0]).toStrictEqual(seededCompletion)

            const sessionClient = yield* RpcTest.makeClient(SessionRpcs)
            const active = yield* sessionClient.ListActiveSessions(undefined, { headers })
            expect(active).toStrictEqual([])

            // Same truth via the in-memory registry directly.
            const liveSessions = yield* LiveSessions
            expect(yield* liveSessions.list()).toStrictEqual([])
          }).pipe(Effect.provide(makeFileBackedServices(dbPath))),
        )
      }),
  )
})
