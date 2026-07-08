import {
  InvalidCredentials,
  InvalidInvite,
  RateLimited,
  Unauthorized,
  User,
  UsernameTaken,
} from '@j45/domain'
import * as Effect from 'effect/Effect'
import * as Schema from 'effect/Schema'

/**
 * Wraps the plain-HTTP `/auth/*` routes — the one recorded exception (besides
 * `/healthz`) to "all client<->server traffic is the one RpcGroup": an rpc
 * riding the `/rpc` WebSocket can't set or clear cookies, so the cookie
 * lifecycle lives here instead. Every function returns an `Effect` whose
 * failure channel is exactly the domain tagged error(s) the design's route
 * table assigns that endpoint — a "typed result" in the same sense
 * `ServerRpcClient`'s rpc calls are. Anything that doesn't fit that contract
 * (the network failing, a response body that doesn't parse against the
 * declared success/error schema) is a defect: it never reaches this
 * module's callers as a typed failure, per the architecture's error
 * posture ("unexpected errors are defects... never swallow").
 */

type FetchResult = { readonly status: number; readonly body: unknown }

const request = (path: string, init: RequestInit): Effect.Effect<FetchResult> =>
  Effect.tryPromise({
    try: async () => {
      const response = await fetch(path, { credentials: 'same-origin', ...init })
      const body: unknown = response.status === 204 ? undefined : await response.json()
      return { status: response.status, body }
    },
    catch: (cause) => new Error(`request to ${path} failed: ${String(cause)}`),
  }).pipe(Effect.orDie)

const decode = <A, I>(schema: Schema.Schema<A, I>, value: unknown): Effect.Effect<A> =>
  Schema.decodeUnknown(schema)(value).pipe(Effect.orDie)

const jsonHeaders = { 'content-type': 'application/json' }

type CallOptions<A, AI, E, EI> = {
  readonly path: string
  readonly init: RequestInit
  readonly successSchema: Schema.Schema<A, AI>
  readonly errorSchema: Schema.Schema<E, EI>
}

/**
 * Issues an `/auth/*` HTTP call and resolves it into the declared
 * success/error `Schema`s: a 2xx body decodes against `successSchema`;
 * anything else decodes against `errorSchema` and becomes the effect's
 * typed failure. A body that matches neither is a defect, not a silent
 * coercion.
 */
function call<A, AI, E, EI>(options: CallOptions<A, AI, E, EI>): Effect.Effect<A, E> {
  return Effect.gen(function* () {
    const { status, body } = yield* request(options.path, options.init)
    if (status >= 200 && status < 300) {
      return yield* decode(options.successSchema, body)
    }
    return yield* Effect.fail(yield* decode(options.errorSchema, body))
  })
}

type PostOptions<A, AI, E, EI> = {
  readonly path: string
  readonly payload: unknown
  readonly successSchema: Schema.Schema<A, AI>
  readonly errorSchema: Schema.Schema<E, EI>
}

const post = <A, AI, E, EI>(options: PostOptions<A, AI, E, EI>): Effect.Effect<A, E> =>
  call({
    path: options.path,
    init: { method: 'POST', headers: jsonHeaders, body: JSON.stringify(options.payload) },
    successSchema: options.successSchema,
    errorSchema: options.errorSchema,
  })

/**
 * Every successful `/auth/*` response body is `{user}`, not a bare `User`
 * (design's route table — `packages/server/src/auth/routes.ts`'s
 * `authResponse`/`meRoute` match this exactly). `unwrapUser` decodes that
 * envelope and hands callers the `User` it carries, so each function below
 * keeps declaring `Effect.Effect<User, ...>` rather than leaking the
 * envelope shape into every caller.
 */
const UserEnvelope = Schema.Struct({ user: User })

const unwrapUser = <E>(effect: Effect.Effect<{ readonly user: User }, E>): Effect.Effect<User, E> =>
  Effect.map(effect, (envelope) => envelope.user)

/**
 * `POST /auth/register` — redeems an invite code and creates the account.
 * `RateLimited` surfaces here too: failed redemptions count toward the
 * design's `invite:<ip>` key, not just username/PIN attempts.
 */
export const register = (input: {
  readonly code: string
  readonly username: string
  readonly displayName: string
  readonly pin: string
}): Effect.Effect<User, InvalidInvite | UsernameTaken | RateLimited> =>
  unwrapUser(
    post({
      path: '/auth/register',
      payload: input,
      successSchema: UserEnvelope,
      errorSchema: Schema.Union(InvalidInvite, UsernameTaken, RateLimited),
    }),
  )

/** `POST /auth/login/pin` — the username+PIN fallback login. */
export const loginPin = (input: {
  readonly username: string
  readonly pin: string
}): Effect.Effect<User, InvalidCredentials | RateLimited> =>
  unwrapUser(
    post({
      path: '/auth/login/pin',
      payload: input,
      successSchema: UserEnvelope,
      errorSchema: Schema.Union(InvalidCredentials, RateLimited),
    }),
  )

/**
 * `POST /auth/login/passkey/options` — usernameless authentication options
 * for `@simplewebauthn/browser`'s `startAuthentication`; the envelope is
 * `Schema.Unknown` by design (`@simplewebauthn/server` is the validator of
 * record). No auth, and the route documents no failure mode.
 */
export const loginPasskeyOptions = (): Effect.Effect<unknown> =>
  post({
    path: '/auth/login/passkey/options',
    payload: {},
    successSchema: Schema.Unknown,
    errorSchema: Schema.Never,
  })

/** `POST /auth/login/passkey` — verifies the assertion and sets the session. */
export const loginPasskey = (response: unknown): Effect.Effect<User, InvalidCredentials> =>
  unwrapUser(
    post({
      path: '/auth/login/passkey',
      payload: { response },
      successSchema: UserEnvelope,
      errorSchema: InvalidCredentials,
    }),
  )

/** `POST /auth/reset` — redeems a reset code, sets a new PIN, signs in. */
export const reset = (input: {
  readonly code: string
  readonly newPin: string
}): Effect.Effect<User, InvalidInvite> =>
  unwrapUser(
    post({
      path: '/auth/reset',
      payload: input,
      successSchema: UserEnvelope,
      errorSchema: InvalidInvite,
    }),
  )

/**
 * `GET /auth/me` — the session probe `AuthGate` fetches on load.
 * `Unauthorized` (no/invalid/expired cookie) is the anonymous signal, not a
 * defect: every fresh page load is expected to see it at least once.
 */
export const me = (): Effect.Effect<User, Unauthorized> =>
  unwrapUser(
    call({
      path: '/auth/me',
      init: { method: 'GET' },
      successSchema: UserEnvelope,
      errorSchema: Unauthorized,
    }),
  )

/** `POST /auth/logout` — clears the session cookie and deletes the row. */
export const logout = (): Effect.Effect<void> =>
  Effect.gen(function* () {
    const { status } = yield* request('/auth/logout', { method: 'POST' })
    if (status < 200 || status >= 300) {
      return yield* Effect.die(new Error(`/auth/logout failed with status ${status}`))
    }
  })
