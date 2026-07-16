import { createHash } from 'node:crypto'

import * as Headers from '@effect/platform/Headers'
import * as HttpRouter from '@effect/platform/HttpRouter'
import type { RequestError } from '@effect/platform/HttpServerError'
import * as HttpServerRequest from '@effect/platform/HttpServerRequest'
import * as HttpServerResponse from '@effect/platform/HttpServerResponse'
import { SqlClient } from '@effect/sql'
import type { SqlError } from '@effect/sql/SqlError'
import {
  Forbidden,
  InvalidCredentials,
  InviteCode,
  Pin,
  Unauthorized,
  User,
  Username,
  type InvalidInvite,
  type RateLimited,
  type UserId,
  type UsernameTaken,
} from '@j45/domain'
import type * as Context from 'effect/Context'
import * as DateTime from 'effect/DateTime'
import * as Duration from 'effect/Duration'
import * as Effect from 'effect/Effect'
import * as Either from 'effect/Either'
import type * as Layer from 'effect/Layer'
import * as Option from 'effect/Option'
import type { ParseError } from 'effect/ParseResult'
import * as Schema from 'effect/Schema'

import { AppOriginConfig, ExtraOriginsConfig } from '../config.js'
import { Accounts } from './accounts.js'
import { AuthSessions, SESSION_LIFETIME } from './auth-sessions.js'
import { SESSION_COOKIE_NAME, sessionClearCookie, sessionSetCookie } from './cookie.js'
import { PinHashing } from './hashing.js'
import { RateLimiter, type RateLimitOptions } from './rate-limiter.js'
import { UserRepo, type UserRow } from './user-repo.js'

const RegisterBody = Schema.Struct({
  code: InviteCode,
  username: Username,
  displayName: Schema.String,
  pin: Pin,
})

const LoginPinBody = Schema.Struct({ username: Username, pin: Pin })

const ResetBody = Schema.Struct({ code: InviteCode, newPin: Pin })

/**
 * A missing/malformed `APP_ORIGIN` is a deploy misconfiguration, not a
 * client-facing failure (same posture as `routes.ts`'s `ReleaseShaConfig`
 * read) — `orDie` keeps it out of every route's recoverable error channel.
 */
const appOriginOrDie = Effect.orDie(AppOriginConfig)

/** `pin:<username>` — design's PIN-login rate limit (5 failures / 15 min). */
const PIN_RATE_LIMIT: RateLimitOptions = { limit: 5, window: Duration.minutes(15) }

/** `invite:<ip>` — design's invite/reset-redemption rate limit (10 / 15 min). */
const INVITE_RATE_LIMIT: RateLimitOptions = { limit: 10, window: Duration.minutes(15) }

/**
 * `GET /auth/me`'s sliding-refresh trigger: once less than this much of
 * `SESSION_LIFETIME` remains, more than 7 days have been consumed.
 */
const REFRESH_REMAINING_THRESHOLD = Duration.subtract(SESSION_LIFETIME, Duration.days(7))

const sha256Hex = (value: string): string => createHash('sha256').update(value).digest('hex')

const userFromRow = (row: UserRow): User =>
  new User({ id: row.id, username: row.username, displayName: row.displayName, role: row.role })

/** The IP `invite:<ip>` keys on — `X-Forwarded-For` (set by Caddy) else the socket address. */
const clientIp = (request: HttpServerRequest.HttpServerRequest): string => {
  const forwarded = Headers.get(request.headers, 'x-forwarded-for')
  return Option.match(forwarded, {
    onNone: () => Option.getOrElse(request.remoteAddress, () => 'unknown'),
    onSome: (value) => (value.split(',')[0] ?? value).trim(),
  })
}

const jsonResponse = (
  body: unknown,
  status?: number,
): Effect.Effect<HttpServerResponse.HttpServerResponse> =>
  // A `HttpBodyError` here would mean we tried to serialize something
  // non-JSON-safe — a bug, not a client-facing failure; `orDie` matches the
  // architecture's "unexpected errors are defects" posture.
  HttpServerResponse.json(body, status === undefined ? undefined : { status }).pipe(Effect.orDie)

const errorResponse = (status: number, tag: string, extra?: Record<string, unknown>) =>
  jsonResponse({ _tag: tag, ...extra }, status)

/** Every route's success body — `{user}` plus the session `Set-Cookie`. */
const authResponse = (result: { readonly user: User; readonly token: string }, appOrigin: string) =>
  jsonResponse({ user: result.user }).pipe(
    Effect.map(
      HttpServerResponse.setHeader('set-cookie', sessionSetCookie(result.token, appOrigin)),
    ),
  )

/**
 * CSRF posture: every `/auth` POST requires `Origin` to be `APP_ORIGIN` or
 * one of `APP_EXTRA_ORIGINS` (dev's LAN addresses — empty in production).
 */
const requireValidOrigin = Effect.gen(function* () {
  const request = yield* HttpServerRequest.HttpServerRequest
  const appOrigin = yield* appOriginOrDie
  const extraOrigins = yield* Effect.orDie(ExtraOriginsConfig)
  const allowedOrigins = new Set([appOrigin, ...extraOrigins])
  const origin = Headers.get(request.headers, 'origin')
  const matches = Option.match(origin, {
    onNone: () => false,
    onSome: (value) => allowedOrigins.has(value),
  })
  if (!matches) {
    return yield* Effect.fail(new Forbidden())
  }
})

type AuthRouteError =
  | Forbidden
  | Unauthorized
  | InvalidCredentials
  | InvalidInvite
  | UsernameTaken
  | RateLimited
  | ParseError
  | RequestError

/**
 * Maps every domain-tagged/request-parsing failure a route can raise to its
 * JSON error response and status code; a bare `SqlError` is an unexpected
 * persistence failure and dies loudly instead (never becomes a normal
 * response).
 */
const withAuthErrorHandling = <R>(
  effect: Effect.Effect<HttpServerResponse.HttpServerResponse, AuthRouteError | SqlError, R>,
): Effect.Effect<HttpServerResponse.HttpServerResponse, never, R> =>
  effect.pipe(
    Effect.catchTag('SqlError', (error) => Effect.die(error)),
    Effect.catchTags({
      Forbidden: () => errorResponse(403, 'Forbidden'),
      Unauthorized: () => errorResponse(401, 'Unauthorized'),
      InvalidCredentials: () => errorResponse(401, 'InvalidCredentials'),
      InvalidInvite: () => errorResponse(400, 'InvalidInvite'),
      UsernameTaken: () => errorResponse(400, 'UsernameTaken'),
      RateLimited: (error) =>
        errorResponse(429, 'RateLimited', { retryAfterSeconds: error.retryAfterSeconds }),
      ParseError: () => errorResponse(400, 'InvalidRequest'),
      RequestError: () => errorResponse(400, 'InvalidRequest'),
    }),
  )

/**
 * Runs `operation` (register or reset) behind the `invite:<ip>` rate limit:
 * checked up front, a failed redemption (`InvalidInvite`) counts against it,
 * a success resets it. `UsernameTaken` doesn't count — the invite itself was
 * valid, so it isn't a failed *redemption*.
 */
const withInviteRateLimit = <A, E extends { readonly _tag: string }, R>(
  rateLimiter: RateLimiter,
  operation: Effect.Effect<A, E, R>,
) =>
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest
    const key = `invite:${clientIp(request)}`

    yield* rateLimiter.check(key, INVITE_RATE_LIMIT)

    const outcome = yield* Effect.either(operation)
    if (Either.isLeft(outcome)) {
      if (outcome.left._tag === 'InvalidInvite') {
        yield* rateLimiter.recordFailure(key, INVITE_RATE_LIMIT)
      }
      return yield* Effect.fail(outcome.left)
    }

    yield* rateLimiter.recordSuccess(key)
    return outcome.right
  })

/**
 * `HttpRouter.Default`'s per-request handlers are fixed to `DefaultServices`
 * — no room for custom services like `Accounts`/`AuthSessions`/etc. — so
 * `AuthRoutesLive` resolves each singleton service exactly once (at layer
 * construction) and every route closes over the plain instances below
 * instead of `yield*`-ing the tags per request (same instances either way;
 * Effect memoizes a Layer's built services regardless).
 */
type AccountsRouteDeps = { readonly accounts: Accounts; readonly rateLimiter: RateLimiter }

const registerRoute = (deps: AccountsRouteDeps) =>
  Effect.gen(function* () {
    yield* requireValidOrigin
    const body = yield* HttpServerRequest.schemaBodyJson(RegisterBody)
    const appOrigin = yield* appOriginOrDie

    const result = yield* withInviteRateLimit(deps.rateLimiter, deps.accounts.register(body))
    return yield* authResponse(result, appOrigin)
  }).pipe(withAuthErrorHandling)

const resetRoute = (deps: AccountsRouteDeps) =>
  Effect.gen(function* () {
    yield* requireValidOrigin
    const body = yield* HttpServerRequest.schemaBodyJson(ResetBody)
    const appOrigin = yield* appOriginOrDie

    const result = yield* withInviteRateLimit(deps.rateLimiter, deps.accounts.reset(body))
    return yield* authResponse(result, appOrigin)
  }).pipe(withAuthErrorHandling)

type LoginPinDeps = {
  readonly userRepo: UserRepo
  readonly pinHashing: Context.Tag.Service<typeof PinHashing>
  readonly authSessions: AuthSessions
  readonly rateLimiter: RateLimiter
}

/** The PIN-login business logic, wrapped by `loginPinRoute` in the `pin:<username>` rate limit. */
const verifyPinLogin = (
  deps: LoginPinDeps,
  body: { readonly username: Username; readonly pin: Pin },
) =>
  Effect.gen(function* () {
    const userOption = yield* deps.userRepo.findByUsername(body.username)
    const isValid = yield* Option.match(userOption, {
      onNone: () => Effect.succeed(false),
      onSome: (user) => deps.pinHashing.verify(body.pin, user.pinHash),
    })

    if (!isValid) {
      return yield* Effect.fail(new InvalidCredentials())
    }

    // `isValid` only reaches here when `userOption` is `Some` (see above).
    const user = Option.getOrThrow(userOption)
    const token = yield* deps.authSessions.create(user.id)
    return { user: userFromRow(user), token }
  })

const loginPinRoute = (deps: LoginPinDeps) =>
  Effect.gen(function* () {
    yield* requireValidOrigin
    const body = yield* HttpServerRequest.schemaBodyJson(LoginPinBody)
    const appOrigin = yield* appOriginOrDie
    const key = `pin:${body.username}`

    yield* deps.rateLimiter.check(key, PIN_RATE_LIMIT)

    const outcome = yield* Effect.either(verifyPinLogin(deps, body))
    if (Either.isLeft(outcome)) {
      yield* deps.rateLimiter.recordFailure(key, PIN_RATE_LIMIT)
      return yield* Effect.fail(outcome.left)
    }

    yield* deps.rateLimiter.recordSuccess(key)
    return yield* authResponse(outcome.right, appOrigin)
  }).pipe(withAuthErrorHandling)

const logoutRoute = (deps: { readonly authSessions: AuthSessions }) =>
  Effect.gen(function* () {
    yield* requireValidOrigin
    const request = yield* HttpServerRequest.HttpServerRequest
    const appOrigin = yield* appOriginOrDie

    const token = request.cookies[SESSION_COOKIE_NAME]
    if (token !== undefined) {
      yield* deps.authSessions.delete(token)
    }

    return HttpServerResponse.empty({ status: 204 }).pipe(
      HttpServerResponse.setHeader('set-cookie', sessionClearCookie(appOrigin)),
    )
  }).pipe(withAuthErrorHandling)

type ActiveSession = {
  readonly userId: UserId
  readonly now: DateTime.Utc
  readonly expiresAt: DateTime.Utc
}

type SessionRow = { readonly user_id: string; readonly expires_at: string }

/**
 * A dedicated `auth_sessions` read for `GET /auth/me`'s sliding refresh —
 * `AuthSessions.lookupAndTouch` (schema-sessions) only reports whether a
 * token is live, not its `expires_at`, which the refresh decision needs;
 * adding that would ripple into every existing caller, so this route reads
 * the row directly through the same generic `SqlClient` tag instead.
 */
const lookupSession = (sql: SqlClient.SqlClient, token: string) =>
  Effect.gen(function* () {
    const now = yield* DateTime.now
    const rows = yield* sql<SessionRow>`
      SELECT user_id, expires_at FROM auth_sessions WHERE token_hash = ${sha256Hex(token)}
    `
    const row = rows[0]
    if (row === undefined) {
      return Option.none<ActiveSession>()
    }

    const expiresAt = DateTime.unsafeMake(row.expires_at)
    if (DateTime.lessThanOrEqualTo(expiresAt, now)) {
      return Option.none<ActiveSession>()
    }

    return Option.some({ userId: row.user_id as UserId, now, expiresAt })
  })

const extendSession = (sql: SqlClient.SqlClient, token: string, now: DateTime.Utc) =>
  Effect.gen(function* () {
    const newExpiresAt = DateTime.formatIso(DateTime.addDuration(now, SESSION_LIFETIME))
    yield* sql`UPDATE auth_sessions SET expires_at = ${newExpiresAt} WHERE token_hash = ${sha256Hex(token)}`
  })

const meRoute = (deps: { readonly userRepo: UserRepo; readonly sql: SqlClient.SqlClient }) =>
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest
    const appOrigin = yield* appOriginOrDie

    const token = request.cookies[SESSION_COOKIE_NAME]
    if (token === undefined) {
      return yield* Effect.fail(new Unauthorized())
    }

    const session = yield* lookupSession(deps.sql, token)
    if (Option.isNone(session)) {
      return yield* Effect.fail(new Unauthorized())
    }

    const userOption = yield* deps.userRepo.findById(session.value.userId)
    if (Option.isNone(userOption)) {
      return yield* Effect.fail(new Unauthorized())
    }

    const response = yield* jsonResponse({ user: userFromRow(userOption.value) })

    const remaining = DateTime.distanceDuration(session.value.now, session.value.expiresAt)
    if (Duration.lessThan(remaining, REFRESH_REMAINING_THRESHOLD)) {
      yield* extendSession(deps.sql, token, session.value.now)
      return response.pipe(
        HttpServerResponse.setHeader('set-cookie', sessionSetCookie(token, appOrigin)),
      )
    }

    return response
  }).pipe(withAuthErrorHandling)

/**
 * The cookie-lifecycle HTTP surface (recorded exception to the
 * everything-through-rpc rule): registered exactly like `HealthzRouteLive`.
 * Resolves every dependency once (see the `AccountsRouteDeps` comment) and
 * closes each route handler over the results.
 */
export const AuthRoutesLive: Layer.Layer<
  never,
  never,
  Accounts | AuthSessions | UserRepo | PinHashing | RateLimiter | SqlClient.SqlClient
> = HttpRouter.Default.use((router) =>
  Effect.gen(function* () {
    const accounts = yield* Accounts
    const authSessions = yield* AuthSessions
    const userRepo = yield* UserRepo
    const pinHashing = yield* PinHashing
    const rateLimiter = yield* RateLimiter
    const sql = yield* SqlClient.SqlClient

    yield* router.post('/auth/register', registerRoute({ accounts, rateLimiter }))
    yield* router.post(
      '/auth/login/pin',
      loginPinRoute({ userRepo, pinHashing, authSessions, rateLimiter }),
    )
    yield* router.post('/auth/reset', resetRoute({ accounts, rateLimiter }))
    yield* router.post('/auth/logout', logoutRoute({ authSessions }))
    yield* router.get('/auth/me', meRoute({ userRepo, sql }))
  }),
)
