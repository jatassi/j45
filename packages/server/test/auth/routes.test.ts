import { NodeContext, NodeHttpServer } from '@effect/platform-node'
import * as Cookies from '@effect/platform/Cookies'
import * as HttpBody from '@effect/platform/HttpBody'
import * as HttpClient from '@effect/platform/HttpClient'
import * as HttpRouter from '@effect/platform/HttpRouter'
import { SqlClient } from '@effect/sql'
import { SqliteClient } from '@effect/sql-sqlite-node'
import { describe, expect, it } from '@effect/vitest'
import type { UserId } from '@j45/domain'
import * as ConfigProvider from 'effect/ConfigProvider'
import * as Duration from 'effect/Duration'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import * as Option from 'effect/Option'
import * as TestClock from 'effect/TestClock'

import { Accounts } from '../../src/auth/accounts.js'
import { AuthSessions } from '../../src/auth/auth-sessions.js'
import { SESSION_COOKIE_NAME } from '../../src/auth/cookie.js'
import { PinHashing } from '../../src/auth/hashing.js'
import { Invites } from '../../src/auth/invites.js'
import { RateLimiter } from '../../src/auth/rate-limiter.js'
import { AuthRoutesLive } from '../../src/auth/routes.js'
import { UserRepo } from '../../src/auth/user-repo.js'
import { MigratorLive } from '../../src/sql.js'

const TEST_APP_ORIGIN = 'https://app.example.test'
const testConfigProvider = ConfigProvider.fromMap(new Map([['APP_ORIGIN', TEST_APP_ORIGIN]]))

/**
 * The exact `MigratorLive` layer the server entrypoint runs at startup,
 * against an in-memory `@effect/sql-sqlite-node` driver — same pattern as
 * `test/auth/schema-sessions.test.ts` and `test/auth/accounts.test.ts`.
 */
const SqlTestLive = MigratorLive.pipe(
  Layer.provideMerge(SqliteClient.layer({ filename: ':memory:' })),
  Layer.provideMerge(NodeContext.layer),
)

/** A fast, reversible stand-in for `PinHashingLive` — see `accounts.test.ts`'s identical comment. */
const TestPinHashing = Layer.succeed(PinHashing, {
  hash: (pin: string) => Effect.succeed(`hashed:${pin}`),
  verify: (pin: string, hash: string) => Effect.succeed(hash === `hashed:${pin}`),
})

const SharedServicesLive = Layer.mergeAll(
  Invites.Default,
  UserRepo.Default,
  AuthSessions.Default,
  RateLimiter.Default,
).pipe(Layer.provideMerge(SqlTestLive))

const AuthServicesLive = Accounts.Default.pipe(
  Layer.provideMerge(SharedServicesLive),
  Layer.provideMerge(TestPinHashing),
)

/**
 * `AuthRoutesLive` registered on a real (loopback, ephemeral-port) Node http
 * server via `NodeHttpServer.layerTest` — that layer also hands back an
 * `HttpClient` pre-prefixed with the running server's base URL, so every
 * test below just calls `auth.postJson('/auth/register', ...)` etc.
 */
const RoutesLive = HttpRouter.Default.serve().pipe(Layer.provide(AuthRoutesLive))

const TestLive = RoutesLive.pipe(
  Layer.provideMerge(AuthServicesLive),
  Layer.provideMerge(NodeHttpServer.layerTest),
)

const runTest = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  effect.pipe(Effect.provide(TestLive), Effect.withConfigProvider(testConfigProvider))

const times = (n: number): readonly number[] => Array.from({ length: n }, (_, i) => i)

/** Thin per-test wrapper around the prefixed `HttpClient` — keeps call sites to `path, body, headers`. */
const authClient = (client: HttpClient.HttpClient) => ({
  postJson: (path: string, body: unknown, headers: Record<string, string> = {}) =>
    client.post(path, { body: HttpBody.unsafeJson(body), headers }),
  get: (path: string, headers: Record<string, string> = {}) => client.get(path, { headers }),
  post: (path: string, headers: Record<string, string> = {}) => client.post(path, { headers }),
})

const cookieHeader = (token: string): Record<string, string> => ({
  cookie: `${SESSION_COOKIE_NAME}=${token}`,
})

describe('AuthRoutesLive — design-table routes', () => {
  it.effect(
    'register (invite code), PIN login, and GET /auth/me follow the design table — statuses, Set-Cookie, error mapping',
    () =>
      runTest(
        Effect.gen(function* () {
          const auth = authClient(yield* HttpClient.HttpClient)
          const invites = yield* Invites
          const invite = yield* invites.mint()

          const badRegister = yield* auth.postJson(
            '/auth/register',
            { code: 'UNKN0WN2', username: 'alice', displayName: 'Alice', pin: '1234' },
            { origin: TEST_APP_ORIGIN },
          )
          expect(badRegister.status).toBe(400)
          expect(yield* badRegister.json).toEqual({ _tag: 'InvalidInvite' })

          const register = yield* auth.postJson(
            '/auth/register',
            { code: invite.code, username: 'alice', displayName: 'Alice', pin: '1234' },
            { origin: TEST_APP_ORIGIN },
          )
          expect(register.status).toBe(200)
          const registerBody = (yield* register.json) as {
            readonly user: { readonly role: string }
          }
          expect(registerBody.user.role).toBe('owner') // first user ever registered
          const rawToken = Option.getOrThrow(
            Cookies.getValue(register.cookies, SESSION_COOKIE_NAME),
          )
          const setCookieHeader = Option.getOrThrow(
            Option.fromNullable(register.headers['set-cookie']),
          )
          expect(setCookieHeader).toContain('HttpOnly')

          const badLogin = yield* auth.postJson(
            '/auth/login/pin',
            { username: 'alice', pin: '0000' },
            { origin: TEST_APP_ORIGIN },
          )
          expect(badLogin.status).toBe(401)
          expect(yield* badLogin.json).toEqual({ _tag: 'InvalidCredentials' })

          const meNoCookie = yield* auth.get('/auth/me')
          expect(meNoCookie.status).toBe(401)
          expect(yield* meNoCookie.json).toEqual({ _tag: 'Unauthorized' })

          const me = yield* auth.get('/auth/me', cookieHeader(rawToken))
          expect(me.status).toBe(200)
          const meBody = (yield* me.json) as { readonly user: { readonly username: string } }
          expect(meBody.user.username).toBe('alice')
        }),
      ),
  )

  it.effect(
    'logout deletes the session row and clears the cookie (204); a bad reset code fails InvalidInvite',
    () =>
      runTest(
        Effect.gen(function* () {
          const auth = authClient(yield* HttpClient.HttpClient)
          const sql = yield* SqlClient.SqlClient
          const invites = yield* Invites
          const invite = yield* invites.mint()

          const register = yield* auth.postJson(
            '/auth/register',
            { code: invite.code, username: 'ellen', displayName: 'Ellen', pin: '1234' },
            { origin: TEST_APP_ORIGIN },
          )
          const rawToken = Option.getOrThrow(
            Cookies.getValue(register.cookies, SESSION_COOKIE_NAME),
          )

          const badReset = yield* auth.postJson(
            '/auth/reset',
            { code: 'NOPE-CODE', newPin: '9999' },
            { origin: TEST_APP_ORIGIN },
          )
          expect(badReset.status).toBe(400)
          expect(yield* badReset.json).toEqual({ _tag: 'InvalidInvite' })

          const logout = yield* auth.post('/auth/logout', {
            origin: TEST_APP_ORIGIN,
            ...cookieHeader(rawToken),
          })
          expect(logout.status).toBe(204)
          const clearedCookie = Option.getOrThrow(Cookies.get(logout.cookies, SESSION_COOKIE_NAME))
          expect(clearedCookie.value).toBe('')

          const remainingSessions = yield* sql`SELECT * FROM auth_sessions`
          expect(remainingSessions).toHaveLength(0)

          const meAfterLogout = yield* auth.get('/auth/me', cookieHeader(rawToken))
          expect(meAfterLogout.status).toBe(401)
        }),
      ),
  )
})

describe('AuthRoutesLive — CSRF', () => {
  it.effect('every /auth POST rejects a missing or mismatched Origin header with 403', () =>
    runTest(
      Effect.gen(function* () {
        const auth = authClient(yield* HttpClient.HttpClient)
        const postWithOrigin = (path: string, origin?: string) =>
          auth.postJson(path, {}, origin === undefined ? {} : { origin })

        for (const path of ['/auth/register', '/auth/login/pin', '/auth/reset', '/auth/logout']) {
          const missing = yield* postWithOrigin(path)
          expect(missing.status).toBe(403)
          expect(yield* missing.json).toEqual({ _tag: 'Forbidden' })

          const mismatched = yield* postWithOrigin(path, 'https://evil.example')
          expect(mismatched.status).toBe(403)
        }
      }),
    ),
  )
})

describe('AuthRoutesLive — rate limiting', () => {
  it.effect(
    'PIN login locks after 5 failures (RateLimited even for the correct PIN); a success resets the counter',
    () =>
      runTest(
        Effect.gen(function* () {
          const auth = authClient(yield* HttpClient.HttpClient)
          const invites = yield* Invites
          const invite = yield* invites.mint()
          yield* auth.postJson(
            '/auth/register',
            { code: invite.code, username: 'bob', displayName: 'Bob', pin: '4242' },
            { origin: TEST_APP_ORIGIN },
          )

          const wrongAttempt = () =>
            auth.postJson(
              '/auth/login/pin',
              { username: 'bob', pin: '0000' },
              { origin: TEST_APP_ORIGIN },
            )
          const correctAttempt = () =>
            auth.postJson(
              '/auth/login/pin',
              { username: 'bob', pin: '4242' },
              { origin: TEST_APP_ORIGIN },
            )

          const fiveFailures = yield* Effect.forEach(times(5), wrongAttempt)
          for (const response of fiveFailures) {
            expect(response.status).toBe(401)
          }

          const lockedWithCorrectPin = yield* correctAttempt()
          expect(lockedWithCorrectPin.status).toBe(429)
          expect(yield* lockedWithCorrectPin.json).toMatchObject({ _tag: 'RateLimited' })

          yield* TestClock.adjust(Duration.minutes(16))
          const unlockedLogin = yield* correctAttempt()
          expect(unlockedLogin.status).toBe(200)

          // A success resets the counter — 4 more failures don't relock.
          const fourMoreFailures = yield* Effect.forEach(times(4), wrongAttempt)
          for (const response of fourMoreFailures) {
            expect(response.status).toBe(401)
          }
          const stillUnlocked = yield* correctAttempt()
          expect(stillUnlocked.status).toBe(200)
        }),
      ),
  )

  it.effect(
    'failed invite redemptions count toward invite:<ip> (X-Forwarded-For, else the socket address), independently per key',
    () =>
      runTest(
        Effect.gen(function* () {
          const auth = authClient(yield* HttpClient.HttpClient)
          const badRegister = (forwardedFor?: string) =>
            auth.postJson(
              '/auth/register',
              { code: 'UNKN0WN2', username: 'nobody', displayName: 'Nobody', pin: '1234' },
              {
                origin: TEST_APP_ORIGIN,
                ...(forwardedFor === undefined ? {} : { 'x-forwarded-for': forwardedFor }),
              },
            )

          const tenFailuresFromA = yield* Effect.forEach(times(10), () =>
            badRegister('203.0.113.5'),
          )
          for (const response of tenFailuresFromA) {
            expect(response.status).toBe(400)
          }
          const lockedA = yield* badRegister('203.0.113.5')
          expect(lockedA.status).toBe(429)

          // A distinct X-Forwarded-For IP is an independent counter.
          const stillOkFromB = yield* badRegister('203.0.113.9')
          expect(stillOkFromB.status).toBe(400)

          // No X-Forwarded-For at all — falls back to the socket address.
          const stillOkFromSocket = yield* badRegister(undefined)
          expect(stillOkFromSocket.status).toBe(400)
        }),
      ),
  )
})

describe('AuthRoutesLive — reset revokes the prior session', () => {
  it.effect(
    'a redeemed reset code signs the member in with the new PIN; the old PIN fails and the prior session 401s',
    () =>
      runTest(
        Effect.gen(function* () {
          const auth = authClient(yield* HttpClient.HttpClient)
          const invites = yield* Invites

          const registrationInvite = yield* invites.mint()
          const register = yield* auth.postJson(
            '/auth/register',
            { code: registrationInvite.code, username: 'carol', displayName: 'Carol', pin: '1234' },
            { origin: TEST_APP_ORIGIN },
          )
          const registerBody = (yield* register.json) as { readonly user: { readonly id: string } }
          const oldToken = Option.getOrThrow(
            Cookies.getValue(register.cookies, SESSION_COOKIE_NAME),
          )

          // The owner mints a reset code for carol (the owner rpc surface is a
          // later task — minting through `Invites` directly is equivalent).
          const resetInvite = yield* invites.mint({ resetUserId: registerBody.user.id as UserId })

          const reset = yield* auth.postJson(
            '/auth/reset',
            { code: resetInvite.code, newPin: '9999' },
            { origin: TEST_APP_ORIGIN },
          )
          expect(reset.status).toBe(200)
          const newToken = Option.getOrThrow(Cookies.getValue(reset.cookies, SESSION_COOKIE_NAME))

          const meWithNewToken = yield* auth.get('/auth/me', cookieHeader(newToken))
          expect(meWithNewToken.status).toBe(200)

          const oldPinLogin = yield* auth.postJson(
            '/auth/login/pin',
            { username: 'carol', pin: '1234' },
            { origin: TEST_APP_ORIGIN },
          )
          expect(oldPinLogin.status).toBe(401)

          const meWithOldToken = yield* auth.get('/auth/me', cookieHeader(oldToken))
          expect(meWithOldToken.status).toBe(401)
        }),
      ),
  )
})

describe('AuthRoutesLive — sliding refresh', () => {
  it.effect(
    'GET /auth/me extends expires_at and re-sets the cookie once more than 7 days of lifetime are consumed',
    () =>
      runTest(
        Effect.gen(function* () {
          const auth = authClient(yield* HttpClient.HttpClient)
          const sql = yield* SqlClient.SqlClient
          const invites = yield* Invites
          const invite = yield* invites.mint()

          const register = yield* auth.postJson(
            '/auth/register',
            { code: invite.code, username: 'dave', displayName: 'Dave', pin: '1234' },
            { origin: TEST_APP_ORIGIN },
          )
          const token = Option.getOrThrow(Cookies.getValue(register.cookies, SESSION_COOKIE_NAME))
          const rowExpiresAt = () =>
            sql<{ readonly expires_at: string }>`SELECT expires_at FROM auth_sessions`.pipe(
              Effect.map((rows) => rows[0]?.expires_at),
            )

          const meSoon = yield* auth.get('/auth/me', cookieHeader(token))
          expect(meSoon.status).toBe(200)
          expect(Option.isNone(Cookies.getValue(meSoon.cookies, SESSION_COOKIE_NAME))).toBe(true)
          const expiresAtBefore = yield* rowExpiresAt()

          yield* TestClock.adjust(Duration.days(8))
          const meLater = yield* auth.get('/auth/me', cookieHeader(token))
          expect(meLater.status).toBe(200)
          expect(Option.isSome(Cookies.getValue(meLater.cookies, SESSION_COOKIE_NAME))).toBe(true)
          const expiresAtAfter = yield* rowExpiresAt()

          expect(expiresAtAfter !== undefined && expiresAtAfter > (expiresAtBefore ?? '')).toBe(
            true,
          )
        }),
      ),
  )
})
