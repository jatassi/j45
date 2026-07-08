import * as HttpRouter from '@effect/platform/HttpRouter'
import * as HttpServerRequest from '@effect/platform/HttpServerRequest'
import * as HttpServerResponse from '@effect/platform/HttpServerResponse'
import type { User } from '@j45/domain'
import * as Effect from 'effect/Effect'
import type * as Layer from 'effect/Layer'
import * as Schema from 'effect/Schema'

import { AppOriginConfig } from '../config.js'
import { AuthSessions } from './auth-sessions.js'
import { sessionSetCookie } from './cookie.js'
import { Passkeys } from './passkeys.js'

/**
 * The passkey login body: the assertion returned by the browser's
 * `startAuthentication()`. It crosses as `Schema.Unknown` —
 * `@simplewebauthn/server` (behind `Passkeys`) is the validator of record.
 */
const LoginBody = Schema.Struct({ response: Schema.Unknown })

const jsonError = (tag: string, status: number) =>
  HttpServerResponse.json({ _tag: tag }, { status })

/** The `{ user }` payload every successful login route returns (design table). */
const userPayload = (user: User) => ({
  id: user.id,
  username: user.username,
  displayName: user.displayName,
  role: user.role,
})

/**
 * `POST /auth/login/passkey/options` — usernameless authentication options
 * (empty `allowCredentials`), with the challenge registered server-side for
 * one-time use. Public (no session): this is a login entry point.
 */
export const optionsResponse = (passkeys: Passkeys) =>
  Effect.gen(function* () {
    const options = yield* passkeys.loginOptions()
    return yield* HttpServerResponse.json(options)
  })

/**
 * `POST /auth/login/passkey` — verifies the assertion via `Passkeys`
 * (locating the user by credential id, bumping `counter`/`last_used_at`),
 * mints a session, and sets the `j45_session` cookie alongside `{ user }`.
 * A failed assertion is `401 InvalidCredentials`; a malformed body is `400`.
 */
export const loginResponse = (passkeys: Passkeys, authSessions: AuthSessions, appOrigin: string) =>
  Effect.gen(function* () {
    const { response } = yield* HttpServerRequest.schemaBodyJson(LoginBody)
    const user = yield* passkeys.loginVerify(response)
    const token = yield* authSessions.create(user.id)
    const ok = yield* HttpServerResponse.json({ user: userPayload(user) })
    return HttpServerResponse.setHeader(ok, 'Set-Cookie', sessionSetCookie(token, appOrigin))
  }).pipe(
    Effect.catchTags({
      InvalidCredentials: () => jsonError('InvalidCredentials', 401),
      RequestError: () => jsonError('BadRequest', 400),
      ParseError: () => jsonError('BadRequest', 400),
    }),
  )

/**
 * Registers the two passkey login routes into the shared default router,
 * exactly like `HealthzRouteLive`. The services are resolved once here (not
 * per request), so the handlers themselves need only the request. The
 * cookie-setting login route is HTTP, not rpc, because a websocket rpc
 * cannot set cookies (design's recorded HTTP exception).
 */
export const PasskeyRoutesLive: Layer.Layer<never, never, Passkeys | AuthSessions> =
  HttpRouter.Default.use((router) =>
    Effect.gen(function* () {
      const passkeys = yield* Passkeys
      const authSessions = yield* AuthSessions
      // A missing APP_ORIGIN falls back to its default; a genuine parse
      // failure is a deploy misconfiguration, so surface it as a defect.
      const appOrigin = yield* Effect.orDie(AppOriginConfig)
      yield* router.post('/auth/login/passkey/options', optionsResponse(passkeys))
      yield* router.post('/auth/login/passkey', loginResponse(passkeys, authSessions, appOrigin))
    }),
  )
