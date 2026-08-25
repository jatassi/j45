import { NodeContext } from '@effect/platform-node'
import { RpcTest } from '@effect/rpc'
import { SqliteClient } from '@effect/sql-sqlite-node'
import { HistoryRpcs, LibraryRpcs, SessionRpcs, UserId, type Username } from '@j45/domain'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import * as Schema from 'effect/Schema'

import { AuthSessions } from '../../src/auth/auth-sessions.js'
import { SESSION_COOKIE_NAME } from '../../src/auth/cookie.js'
import { AuthMiddlewareLive } from '../../src/auth/middleware.js'
import { UserRepo } from '../../src/auth/user-repo.js'
import { LibraryHandlersLive } from '../../src/library/handlers.js'
import { PlanChanges } from '../../src/library/plan-changes.js'
import { WorkoutsRepo } from '../../src/library/workouts-repo.js'
import { CompletionsRepo } from '../../src/session/completions-repo.js'
import { SessionHandlersLive } from '../../src/session/handlers.js'
import { HistoryHandlersLive } from '../../src/session/history-handlers.js'
import { LiveSessions } from '../../src/session/live-sessions.js'
import { MigratorLive } from '../../src/sql.js'

/**
 * The shared mount for the plan-change flow tests: the library handlers and
 * the session handlers over one in-memory database, wired to each other
 * exactly as `server.ts` wires them, plus the history read path over the
 * same connection. One test can then drive a workout mutation as a unary rpc
 * and read the result on a session snapshot, or in the rows a session left.
 *
 * A test never touches the notification seam between the two. That seam is
 * implementation.
 */

const SqlTestLive = MigratorLive.pipe(
  Layer.provideMerge(SqliteClient.layer({ filename: ':memory:' })),
  Layer.provideMerge(NodeContext.layer),
)

// One memoized `PlanChanges`: the library handlers publish into it and
// `LiveSessions` consumes from it.
const LiveSessionsLive = LiveSessions.Default.pipe(
  Layer.provide(Layer.mergeAll(CompletionsRepo.Default, PlanChanges.Default)),
)

export const FlowLive = Layer.mergeAll(
  UserRepo.Default,
  CompletionsRepo.Default,
  AuthSessions.Default,
  WorkoutsRepo.Default,
  PlanChanges.Default,
  LiveSessionsLive,
  AuthMiddlewareLive.pipe(Layer.provide(Layer.mergeAll(AuthSessions.Default, UserRepo.Default))),
  LibraryHandlersLive.pipe(
    Layer.provide(Layer.mergeAll(WorkoutsRepo.Default, PlanChanges.Default)),
  ),
  SessionHandlersLive.pipe(Layer.provide(Layer.mergeAll(WorkoutsRepo.Default, LiveSessionsLive))),
  HistoryHandlersLive.pipe(Layer.provide(CompletionsRepo.Default)),
).pipe(Layer.provideMerge(SqlTestLive))

/** A branded `UserId` from a plain string. */
export const uid = (id: string) => Schema.decodeSync(UserId)(id)

/** The workout owner every flow test signs in as, and two guests to join. */
export const owner = uid('owner')
export const bobId = uid('bob')
export const caraId = uid('cara')

export const seedUser = (id: UserId, displayName = 'Test User') =>
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

/** Request headers that sign a call in as one already-seeded user. */
export const headersFor = (id: UserId) =>
  Effect.gen(function* () {
    const authSessions = yield* AuthSessions
    const token = yield* authSessions.create(id)
    return { cookie: `${SESSION_COOKIE_NAME}=${token}` }
  })

/** The owner's request headers, plus a client for each rpc group under test. */
export const asOwner = Effect.gen(function* () {
  yield* seedUser(owner, 'Owner')
  const headers = yield* headersFor(owner)
  const library = yield* RpcTest.makeClient(LibraryRpcs)
  const sessions = yield* RpcTest.makeClient(SessionRpcs)
  const history = yield* RpcTest.makeClient(HistoryRpcs)
  return { headers, history, library, sessions } as const
})
