import * as Cookies from '@effect/platform/Cookies'
import * as Headers from '@effect/platform/Headers'
import { AuthMiddleware, Unauthorized, User } from '@j45/domain'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import * as Option from 'effect/Option'

import { AuthSessions } from './auth-sessions.js'
import { SESSION_COOKIE_NAME } from './cookie.js'
import { UserRepo, type UserRow } from './user-repo.js'

/** `UserRow` (persistence shape, carries `pinHash`/`createdAt`) → the public `User` the rpc layer returns. */
const toDomainUser = (row: UserRow): User =>
  new User({ id: row.id, username: row.username, displayName: row.displayName, role: row.role })

/** The raw `j45_session` cookie value, or `None` for a missing cookie header or an unset/empty cookie. */
const parseSessionCookie = (headers: Headers.Headers): Option.Option<string> =>
  Headers.get(headers, 'cookie').pipe(
    Option.map((header) => Cookies.parseHeader(header)),
    Option.flatMap((cookies) => Option.fromNullable(cookies[SESSION_COOKIE_NAME])),
  )

/**
 * The `AuthMiddleware` contract's actual logic: parse `j45_session` out of
 * the call's headers, hash it (inside `AuthSessions.lookupAndTouch`) to find
 * an unexpired `auth_sessions` row, then load its owning user — failing
 * `Unauthorized` at any step (no cookie, unknown/expired token, or a session
 * whose user row is gone) rather than resolving `CurrentUser`. A `SqlError`
 * from either lookup is a database/infra failure, not a legitimate
 * "logged out" outcome — `Effect.orDie` surfaces it as a defect instead of
 * lying to the caller with `Unauthorized`, keeping this effect's only typed
 * failure the one `AuthMiddleware`'s contract declares.
 */
const resolveCurrentUser = (
  authSessions: AuthSessions,
  userRepo: UserRepo,
  headers: Headers.Headers,
) =>
  Effect.gen(function* () {
    const cookie = parseSessionCookie(headers)
    if (Option.isNone(cookie)) {
      return yield* Effect.fail(new Unauthorized())
    }

    const userId = yield* authSessions.lookupAndTouch(cookie.value).pipe(Effect.orDie)
    if (Option.isNone(userId)) {
      return yield* Effect.fail(new Unauthorized())
    }

    const userRow = yield* userRepo.findById(userId.value).pipe(Effect.orDie)
    if (Option.isNone(userRow)) {
      return yield* Effect.fail(new Unauthorized())
    }

    return toDomainUser(userRow.value)
  })

/**
 * Live implementation of `@j45/domain`'s `AuthMiddleware`: guards every
 * `AccountRpcs`/`OwnerRpcs` call, re-validating the session (and so
 * re-reading the current user) on each individual rpc, not just once per
 * websocket connection — a revoked session or a mid-connection PIN reset
 * takes effect on the very next call.
 */
export const AuthMiddlewareLive: Layer.Layer<AuthMiddleware, never, AuthSessions | UserRepo> =
  Layer.effect(
    AuthMiddleware,
    Effect.gen(function* () {
      const authSessions = yield* AuthSessions
      const userRepo = yield* UserRepo

      return ({ headers }: { readonly headers: Headers.Headers }) =>
        resolveCurrentUser(authSessions, userRepo, headers)
    }),
  )
