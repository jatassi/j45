import { NodeContext } from '@effect/platform-node'
import { RpcTest } from '@effect/rpc'
import { SqliteClient } from '@effect/sql-sqlite-node'
import {
  Flow,
  HistoryRpcs,
  LibraryRpcs,
  Participant,
  Pod,
  Round,
  SessionRpcs,
  Station,
  UserId,
  Workout,
  type SessionId,
  type SessionNotFound,
  type SessionState,
  type SessionSummary,
  type Username,
} from '@j45/domain'
import * as Effect from 'effect/Effect'
import type * as Exit from 'effect/Exit'
import * as Layer from 'effect/Layer'
import * as Option from 'effect/Option'
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
/** The owner as a session participant — who `holdWatch` watches as. */
export const ownerParticipant = new Participant({ userId: owner, displayName: 'Owner' })
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

/** How long one round works and rests, in seconds. Defaults: 10 and 5. */
export type Timing = { readonly workSeconds?: number; readonly restSeconds?: number }

/**
 * One pod of the named stations, one round, under the workout name `name`.
 * `['A', 'B']` at the default timing compiles to ready 5s, work A 10s, rest
 * 5s, work B 10s. A `restSeconds` of `0` emits no rest segments at all,
 * which is how a test moves the segment indices without moving the work
 * ordinals.
 */
export const makeWorkout = (
  stations: readonly [string, ...string[]],
  timing: Timing = {},
  name = 'Plan',
) =>
  new Workout({
    name,
    focus: 'cardio',
    pods: [
      new Pod({
        name: 'P',
        stations: [
          new Station({ name: stations[0] }),
          ...stations.slice(1).map((station) => new Station({ name: station })),
        ],
      }),
    ],
    flow: new Flow({
      type: 'laps',
      rounds: [
        new Round({ workSeconds: timing.workSeconds ?? 10, restSeconds: timing.restSeconds ?? 5 }),
      ],
    }),
  })

/** The station names of a snapshot's work segments, in run order. */
export const stationNames = (state: SessionState): readonly string[] =>
  state.compiled.segments.flatMap((segment) =>
    segment._tag === 'work' ? [segment.work.station.name] : [],
  )

/** The running timer of a snapshot, or `undefined` if it is not running. */
export const running = (state: SessionState) =>
  state.timer._tag === 'running' ? state.timer : undefined

/** The paused timer of a snapshot, or `undefined` if it is not paused. */
export const paused = (state: SessionState) =>
  state.timer._tag === 'paused' ? state.timer : undefined

/** The snapshot of one session, by id. */
export const snapshotOf = (svc: LiveSessions, id: SessionId) => svc.snapshot(id)

/**
 * Holds one watcher on the session for the rest of the test scope.
 *
 * A session nobody watches is collected after the 60s abandon window. The
 * leading `READY_SECONDS` countdown puts a whole workout past that window, so
 * a test that walks one from start to end must watch it — which is what a
 * participant does anyway.
 */
export const holdWatch = (svc: LiveSessions, id: SessionId, participant = ownerParticipant) =>
  Effect.forkScoped(Stream.runDrain(svc.watch(id, participant)).pipe(Effect.ignore))

/**
 * The lobby as it stands, read off the feed itself.
 *
 * The feed's first element is the current set, so one element is the whole
 * answer. There is no unary listing to ask instead — the feed is the single
 * path to this data, and a test must read it the way a caller does.
 */
export const lobbyNow = (svc: LiveSessions): Effect.Effect<readonly SessionSummary[]> =>
  Effect.map(
    Stream.runHead(svc.lobby()),
    Option.getOrElse((): readonly SessionSummary[] => []),
  )

/** Drains queued snapshots until one satisfies `predicate`, and returns it. */
export const latestWith = (
  queue: Queue.Dequeue<Exit.Exit<SessionState, Option.Option<SessionNotFound>>>,
  predicate: (state: SessionState) => boolean,
): Effect.Effect<SessionState> =>
  // A stream that ends or fails before the predicate holds is a defect here:
  // the session is still live and the test is still waiting on it.
  Effect.flatMap(Effect.orDie(Effect.flatten(Queue.take(queue))), (state) =>
    predicate(state) ? Effect.succeed(state) : latestWith(queue, predicate),
  )
