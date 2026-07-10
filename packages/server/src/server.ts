import { BunHttpServer } from '@effect/platform-bun'
import * as HttpRouter from '@effect/platform/HttpRouter'
import { RpcSerialization, RpcServer } from '@effect/rpc'
import { J45Rpcs } from '@j45/domain'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'

import { MeHandlerLive } from './auth/account-handlers.js'
import { Accounts } from './auth/accounts.js'
import { AuthSessions } from './auth/auth-sessions.js'
import { PinHashingLive } from './auth/hashing.js'
import { Invites } from './auth/invites.js'
import { AuthMiddlewareLive } from './auth/middleware.js'
import { OwnerHandlersLive } from './auth/owner-handlers.js'
import { PasskeyHandlersLive } from './auth/passkey-handlers.js'
import { PasskeyRoutesLive } from './auth/passkey-routes.js'
import { Passkeys } from './auth/passkeys.js'
import { RateLimiter } from './auth/rate-limiter.js'
import { AuthRoutesLive } from './auth/routes.js'
import { UserRepo } from './auth/user-repo.js'
import { ClientDistDirLive } from './client-dist.js'
import { PortConfig } from './config.js'
import { ExerciseHandlersLive } from './library/exercise-handlers.js'
import { ExercisesRepo } from './library/exercises-repo.js'
import { LibraryHandlersLive } from './library/handlers.js'
import { WorkoutsRepo } from './library/workouts-repo.js'
import { HealthzRouteLive, StaticRouteLive } from './routes.js'
import { RpcHandlersLive } from './rpc-handlers.js'
import { CompletionsRepo } from './session/completions-repo.js'
import { SessionHandlersLive } from './session/handlers.js'
import { HistoryHandlersLive } from './session/history-handlers.js'
import { LiveSessions } from './session/live-sessions.js'
import { SqlLive } from './sql.js'

/** The Bun http server, listening on `PortConfig` (default 3000). */
const BunServerLive = Layer.unwrapEffect(
  Effect.map(PortConfig, (port) => BunHttpServer.layer({ port })),
)

/**
 * `Invites`/`UserRepo`/`AuthSessions`/`RateLimiter`/`PinHashing`/
 * `WorkoutsRepo`/`ExercisesRepo` — the services `Accounts` itself depends
 * on (`WorkoutsRepo`/`ExercisesRepo` seed the workout library and exercise
 * catalog `register` creates inside its transaction), and
 * (`UserRepo`/`AuthSessions`/`RateLimiter`/`PinHashing`) that
 * `AuthRoutesLive` also consumes directly for PIN login. Built once so
 * `Accounts.Default` below receives them as already-built dependencies
 * rather than unrelated `mergeAll` siblings.
 */
const SharedAuthServicesLive = Layer.mergeAll(
  Invites.Default,
  UserRepo.Default,
  AuthSessions.Default,
  RateLimiter.Default,
  WorkoutsRepo.Default,
  ExercisesRepo.Default,
).pipe(Layer.provideMerge(PinHashingLive))

/**
 * Every service `AuthRoutesLive` needs beyond the generic `SqlClient.SqlClient`
 * tag (still an open requirement here — `main.ts`'s `SqlLive` provides it).
 * Named distinctly from the `AuthServicesLive` below (the `J45Rpcs` handlers'
 * dependency set) since the two bundle different, non-overlapping services.
 */
const HttpAuthServicesLive = Accounts.Default.pipe(Layer.provideMerge(SharedAuthServicesLive))

const RpcProtocolLive = RpcServer.layerProtocolWebsocket({ path: '/rpc' }).pipe(
  Layer.provide(RpcSerialization.layerNdjson),
)

/**
 * Every service `AuthMiddlewareLive` or an `AccountRpcs`/`OwnerRpcs`/
 * `LibraryRpcs`/`ExerciseRpcs`/`SessionRpcs`/`HistoryRpcs` handler layer
 * depends on, merged once — `Layer.mergeAll` + `Layer.provide` share one
 * instance of each rather than duplicating it per consumer. `SqlLive` backs
 * the durable ones (`UserRepo`/`Invites`/`Passkeys`/`AuthSessions`/
 * `WorkoutsRepo`/`ExercisesRepo`/`CompletionsRepo`); `LiveSessions` is the
 * in-memory session registry `SessionHandlersLive` drives — it holds no SQL
 * itself but writes a completion row per ever-participant when a progressed
 * session ends, so it is built over `CompletionsRepo` too (also exposed as
 * its own sibling here since `HistoryHandlersLive` needs it directly).
 * `SqlLive` is also the very layer `main.ts` merges to run migrations, and
 * Effect memoizes layers by reference, so this second reference (alongside
 * `PasskeyRoutesProvided`'s below) opens no second database connection.
 */
const AuthServicesLive = Layer.mergeAll(
  UserRepo.Default,
  Invites.Default,
  Passkeys.Default,
  AuthSessions.Default,
  WorkoutsRepo.Default,
  ExercisesRepo.Default,
  CompletionsRepo.Default,
  LiveSessions.Default.pipe(Layer.provide(CompletionsRepo.Default)),
).pipe(Layer.provide(SqlLive))

/**
 * Every `J45Rpcs` handler layer merged into one: `RpcHandlersLive`
 * (`ServerInfo`), `MeHandlerLive` (`Me`), `PasskeyHandlersLive` (the four
 * passkey `AccountRpcs` members), `OwnerHandlersLive` (every `OwnerRpcs`
 * member), `LibraryHandlersLive` (every `LibraryRpcs` member),
 * `ExerciseHandlersLive` (every `ExerciseRpcs` member),
 * `SessionHandlersLive` (every `SessionRpcs` member), and
 * `HistoryHandlersLive` (every `HistoryRpcs` member) — together these
 * implement every member `AccountRpcs`, `OwnerRpcs`, `LibraryRpcs`,
 * `ExerciseRpcs`, `SessionRpcs`, and `HistoryRpcs` declare, so
 * `RpcServer.layer(J45Rpcs)` below type-checks.
 */
const RpcHandlersAll = Layer.mergeAll(
  RpcHandlersLive,
  MeHandlerLive,
  PasskeyHandlersLive,
  OwnerHandlersLive,
  LibraryHandlersLive,
  ExerciseHandlersLive,
  SessionHandlersLive,
  HistoryHandlersLive,
)

/**
 * Serves the full `J45Rpcs` merge (`PublicRpcs` + `AccountRpcs` +
 * `OwnerRpcs` + `LibraryRpcs` + `ExerciseRpcs` + `SessionRpcs` +
 * `HistoryRpcs`) at `/rpc`, guarded by `AuthMiddlewareLive` for every
 * `AccountRpcs`/`OwnerRpcs`/`LibraryRpcs`/`ExerciseRpcs`/`SessionRpcs`/
 * `HistoryRpcs` member — the merge this task lands, now that every handler
 * layer (and `AuthMiddlewareLive` itself) exists. `ServerInfo` stays
 * reachable with no session, exactly as `PublicRpcs`'s doc comment promises.
 */
const RpcLive = RpcServer.layer(J45Rpcs).pipe(
  Layer.provide(RpcHandlersAll),
  Layer.provide(AuthMiddlewareLive),
  Layer.provide(AuthServicesLive),
  Layer.provide(RpcProtocolLive),
)

/**
 * The passkey login HTTP routes, provided with the ceremony service
 * (`Passkeys`) and the session store (`AuthSessions`). `SqlLive` is provided
 * here so those services get their `SqlClient`; it is the very layer
 * `main.ts` merges to run migrations, and Effect memoizes layers by
 * reference — so exactly one database connection is opened and migrations
 * run once, regardless of this second reference.
 */
const PasskeyRoutesProvided = PasskeyRoutesLive.pipe(
  Layer.provide(Layer.mergeAll(Passkeys.Default, AuthSessions.Default)),
  Layer.provide(SqlLive),
)

/**
 * The full server: `/healthz` (plain HTTP), `/auth/*` (the cookie-lifecycle
 * HTTP surface — `AuthRoutesLive` for register/PIN-login/reset/me/logout,
 * `PasskeyRoutesProvided` for passkey login — both recorded exceptions to
 * the everything-through-rpc rule), `/rpc` (the full `J45Rpcs` merge over
 * websocket + ndjson, `AccountRpcs`/`OwnerRpcs`/`LibraryRpcs`/`ExerciseRpcs`/
 * `SessionRpcs`/`HistoryRpcs` guarded by `AuthMiddlewareLive`), and static
 * serving of `packages/client/dist` for everything else. Requires
 * `SqlClient.SqlClient` (via `AuthRoutesLive`/`HttpAuthServicesLive`) —
 * `main.ts` provides it from `SqlLive`.
 */
export const ServerLive = HttpRouter.Default.serve().pipe(
  Layer.provide(RpcLive),
  Layer.provide(AuthRoutesLive),
  Layer.provide(HealthzRouteLive),
  Layer.provide(PasskeyRoutesProvided),
  Layer.provide(StaticRouteLive),
  Layer.provide(ClientDistDirLive),
  Layer.provide(BunServerLive),
  Layer.provide(HttpAuthServicesLive),
)
