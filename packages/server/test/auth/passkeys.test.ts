import * as HttpApp from '@effect/platform/HttpApp'
import * as HttpRouter from '@effect/platform/HttpRouter'
import { NodeContext } from '@effect/platform-node'
import { SqlClient } from '@effect/sql'
import { SqliteClient } from '@effect/sql-sqlite-node'
import { describe, it } from '@effect/vitest'
import type { UserId, Username } from '@j45/domain'
import { User } from '@j45/domain'
import type {
  VerifiedAuthenticationResponse,
  VerifiedRegistrationResponse,
} from '@simplewebauthn/server'
import { generateAuthenticationOptions, generateRegistrationOptions } from '@simplewebauthn/server'
import * as ConfigProvider from 'effect/ConfigProvider'
import * as Duration from 'effect/Duration'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import * as TestClock from 'effect/TestClock'
import { expect } from 'vitest'

import { AuthSessions } from '../../src/auth/auth-sessions.js'
import { ChallengeStore } from '../../src/auth/challenge-store.js'
import { loginResponse, optionsResponse } from '../../src/auth/passkey-routes.js'
import { Passkeys, WebAuthn, WebAuthnError } from '../../src/auth/passkeys.js'
import { UserRepo } from '../../src/auth/user-repo.js'
import { MigratorLive } from '../../src/sql.js'

const APP_ORIGIN = 'https://example.test'
const RP_ID = 'example.test'
const CRED_ID = 'test-credential-id'
const PUBLIC_KEY = new Uint8Array([1, 2, 3, 4, 5])

type CredRow = {
  readonly id: string
  readonly user_id: string
  readonly public_key: Uint8Array
  readonly counter: number
  readonly transports: string | null
  readonly last_used_at: string | null
}

const SqlTestLive = MigratorLive.pipe(
  Layer.provideMerge(SqliteClient.layer({ filename: ':memory:' })),
  Layer.provideMerge(NodeContext.layer),
)

/** A registration verification fixture — the stub returns it in place of real crypto. */
const registrationInfo = (counter: number): VerifiedRegistrationResponse => ({
  verified: true,
  registrationInfo: {
    fmt: 'none',
    aaguid: '00000000-0000-0000-0000-000000000000',
    credential: { id: CRED_ID, publicKey: PUBLIC_KEY, counter },
    credentialType: 'public-key',
    attestationObject: new Uint8Array(),
    userVerified: true,
    credentialDeviceType: 'singleDevice',
    credentialBackedUp: false,
    origin: APP_ORIGIN,
  },
})

const authenticationInfo = (newCounter: number): VerifiedAuthenticationResponse => ({
  verified: true,
  authenticationInfo: {
    credentialID: CRED_ID,
    newCounter,
    userVerified: true,
    credentialDeviceType: 'singleDevice',
    credentialBackedUp: false,
    origin: APP_ORIGIN,
    rpID: RP_ID,
  },
})

/**
 * The `WebAuthn` seam with the real `generate*` calls (they need no
 * authenticator) but stubbed `verify*` returning the supplied fixtures — the
 * "fixture/stubbed verification data" the WebAuthn task's criterion 4 calls
 * for; real assertion crypto is the chromium e2e task's job.
 */
type Capture = { expectedOrigin?: string | string[]; expectedRPID?: string | string[] | undefined }

const stubWebAuthn = (fixtures: {
  readonly registration?: VerifiedRegistrationResponse
  readonly authentication?: VerifiedAuthenticationResponse
  readonly capture?: Capture
}): Layer.Layer<WebAuthn> =>
  Layer.succeed(WebAuthn, {
    generateRegistrationOptions: (options) =>
      Effect.promise(() => generateRegistrationOptions(options)),
    generateAuthenticationOptions: (options) =>
      Effect.promise(() => generateAuthenticationOptions(options)),
    verifyRegistrationResponse: (options) => {
      if (fixtures.capture !== undefined) {
        fixtures.capture.expectedOrigin = options.expectedOrigin
        fixtures.capture.expectedRPID = options.expectedRPID
      }
      return fixtures.registration === undefined
        ? Effect.fail(new WebAuthnError({ cause: 'stub' }))
        : Effect.succeed(fixtures.registration)
    },
    verifyAuthenticationResponse: () =>
      fixtures.authentication === undefined
        ? Effect.fail(new WebAuthnError({ cause: 'stub' }))
        : Effect.succeed(fixtures.authentication),
  })

const testLayer = (webauthn: Layer.Layer<WebAuthn>) => {
  const services = Layer.mergeAll(
    Passkeys.DefaultWithoutDependencies.pipe(
      Layer.provide(webauthn),
      Layer.provide(ChallengeStore.Default),
      Layer.provide(UserRepo.Default),
    ),
    UserRepo.Default,
    AuthSessions.Default,
  )
  return services.pipe(
    Layer.provideMerge(SqlTestLive),
    Layer.provide(
      Layer.setConfigProvider(ConfigProvider.fromMap(new Map([['APP_ORIGIN', APP_ORIGIN]]))),
    ),
  )
}

const domainUser = (id: string, username: string): User =>
  new User({
    id: id as UserId,
    username: username as Username,
    displayName: 'Test User',
    role: 'owner',
  })

const insertUser = (id: string, username: string) =>
  Effect.gen(function* () {
    const users = yield* UserRepo
    yield* users.insert({
      id: id as UserId,
      username: username as Username,
      displayName: 'Test User',
      role: 'owner',
      pinHash: 'irrelevant',
      createdAt: '2020-01-01T00:00:00.000Z',
    })
  })

const insertCredential = (sql: SqlClient.SqlClient, id: string, userId: string) =>
  sql`INSERT INTO passkey_credentials ${sql.insert({
    id,
    user_id: userId,
    public_key: Buffer.from(PUBLIC_KEY),
    counter: 0,
    transports: null,
    created_at: '2020-01-01T00:00:00.000Z',
    last_used_at: null,
  })}`

const clientData = (type: string, challenge: string): string =>
  Buffer.from(JSON.stringify({ type, challenge, origin: APP_ORIGIN })).toString('base64url')

const registrationResponse = (challenge: string, transports: readonly string[]) => ({
  id: CRED_ID,
  rawId: CRED_ID,
  type: 'public-key',
  clientExtensionResults: {},
  response: {
    clientDataJSON: clientData('webauthn.create', challenge),
    attestationObject: '',
    transports,
  },
})

const authenticationResponse = (challenge: string) => ({
  id: CRED_ID,
  rawId: CRED_ID,
  type: 'public-key',
  clientExtensionResults: {},
  response: {
    clientDataJSON: clientData('webauthn.get', challenge),
    authenticatorData: '',
    signature: '',
  },
})

const jsonOf = (response: Response) => Effect.promise((): Promise<unknown> => response.json())

describe('ChallengeStore', () => {
  it.effect('consumes a challenge exactly once and expires it after the 2-minute TTL', () =>
    Effect.gen(function* () {
      const store = yield* ChallengeStore

      yield* store.put('challenge-a')
      expect(yield* store.take('challenge-a')).toBe('challenge-a')
      const replayed = yield* Effect.exit(store.take('challenge-a'))
      expect(replayed._tag).toBe('Failure')

      yield* store.put('challenge-b')
      yield* TestClock.adjust(Duration.seconds(119))
      expect(yield* store.take('challenge-b')).toBe('challenge-b')

      yield* store.put('challenge-c')
      yield* TestClock.adjust(Duration.minutes(2))
      const expired = yield* Effect.exit(store.take('challenge-c'))
      expect(expired._tag).toBe('Failure')
    }).pipe(Effect.provide(ChallengeStore.Default)),
  )
})

describe('Passkeys enrollment', () => {
  it.effect(
    'enrollStart returns residentKey-required, uv-preferred options with rpID from APP_ORIGIN',
    () =>
      Effect.gen(function* () {
        const passkeys = yield* Passkeys
        const options = yield* passkeys.enrollStart(domainUser('user-1', 'alice'))
        expect(options.rp.id).toBe(RP_ID)
        expect(options.authenticatorSelection?.residentKey).toBe('required')
        expect(options.authenticatorSelection?.userVerification).toBe('preferred')
      }).pipe(Effect.provide(testLayer(stubWebAuthn({})))),
  )

  it.effect(
    'enrollFinish stores the credential for the user; a stale challenge fails InvalidCredentials',
    () =>
      Effect.gen(function* () {
        yield* insertUser('user-1', 'alice')
        const passkeys = yield* Passkeys
        const sql = yield* SqlClient.SqlClient
        const user = domainUser('user-1', 'alice')

        const options = yield* passkeys.enrollStart(user)
        const response = registrationResponse(options.challenge, ['internal', 'hybrid'])
        const summary = yield* passkeys.enrollFinish(user, response)
        expect(summary.id).toBe(CRED_ID)

        const rows = yield* sql<CredRow>`SELECT * FROM passkey_credentials`
        expect(rows).toHaveLength(1)
        const row = rows[0]
        expect(row?.id).toBe(CRED_ID)
        expect(row?.user_id).toBe('user-1')
        expect(row?.counter).toBe(0)
        expect(row?.transports).toBe(JSON.stringify(['internal', 'hybrid']))
        expect(row?.last_used_at).toBe(null)
        expect(row === undefined ? [] : [...row.public_key]).toEqual([...PUBLIC_KEY])

        // The challenge was consumed by the first finish, so replaying fails.
        const replay = yield* Effect.exit(passkeys.enrollFinish(user, response))
        expect(replay._tag).toBe('Failure')
      }).pipe(Effect.provide(testLayer(stubWebAuthn({ registration: registrationInfo(0) })))),
  )

  it.effect('verification receives the expectedOrigin and rpID derived from APP_ORIGIN', () => {
    const capture: Capture = {}
    return Effect.gen(function* () {
      yield* insertUser('user-2', 'bob')
      const passkeys = yield* Passkeys
      const user = domainUser('user-2', 'bob')
      const options = yield* passkeys.enrollStart(user)
      yield* passkeys.enrollFinish(user, registrationResponse(options.challenge, ['internal']))
      expect(capture.expectedOrigin).toBe(APP_ORIGIN)
      expect(capture.expectedRPID).toBe(RP_ID)
    }).pipe(Effect.provide(testLayer(stubWebAuthn({ registration: registrationInfo(0), capture }))))
  })
})

describe('Passkeys management (own credentials only)', () => {
  it.effect(
    'ListPasskeys returns only the caller’s; DeletePasskey removes own and Forbids others’',
    () =>
      Effect.gen(function* () {
        yield* insertUser('owner-a', 'aaa')
        yield* insertUser('owner-b', 'bbb')
        const passkeys = yield* Passkeys
        const sql = yield* SqlClient.SqlClient
        yield* insertCredential(sql, 'cred-a', 'owner-a')
        yield* insertCredential(sql, 'cred-b', 'owner-b')

        const listA = yield* passkeys.listForUser('owner-a' as UserId)
        expect(listA.map((passkey) => passkey.id)).toEqual(['cred-a'])

        yield* passkeys.deleteForUser('owner-a' as UserId, 'cred-a')
        expect(yield* passkeys.listForUser('owner-a' as UserId)).toHaveLength(0)

        const forbidden = yield* Effect.exit(passkeys.deleteForUser('owner-a' as UserId, 'cred-b'))
        expect(forbidden._tag).toBe('Failure')
        const survivorB = yield* sql`SELECT id FROM passkey_credentials WHERE id = 'cred-b'`
        expect(survivorB).toHaveLength(1)
      }).pipe(Effect.provide(testLayer(stubWebAuthn({})))),
  )
})

describe('Passkeys login', () => {
  it.effect('loginOptions returns usernameless options with empty allowCredentials', () =>
    Effect.gen(function* () {
      const passkeys = yield* Passkeys
      const options = yield* passkeys.loginOptions()
      expect(options.allowCredentials ?? []).toHaveLength(0)
      expect(options.rpId).toBe(RP_ID)
    }).pipe(Effect.provide(testLayer(stubWebAuthn({})))),
  )

  it.effect('loginVerify locates the user by credential id and updates counter/last_used_at', () =>
    Effect.gen(function* () {
      yield* insertUser('user-7', 'grace')
      const passkeys = yield* Passkeys
      const sql = yield* SqlClient.SqlClient
      const user = domainUser('user-7', 'grace')

      const regOptions = yield* passkeys.enrollStart(user)
      yield* passkeys.enrollFinish(user, registrationResponse(regOptions.challenge, ['internal']))

      const authOptions = yield* passkeys.loginOptions()
      const loggedIn = yield* passkeys.loginVerify(authenticationResponse(authOptions.challenge))
      expect(loggedIn.id).toBe('user-7')
      expect(loggedIn.username).toBe('grace')

      const rows =
        yield* sql<CredRow>`SELECT counter, last_used_at FROM passkey_credentials WHERE id = ${CRED_ID}`
      expect(rows[0]?.counter).toBe(5)
      expect(rows[0]?.last_used_at).not.toBe(null)
    }).pipe(
      Effect.provide(
        testLayer(
          stubWebAuthn({
            registration: registrationInfo(0),
            authentication: authenticationInfo(5),
          }),
        ),
      ),
    ),
  )

  it.effect('loginVerify fails InvalidCredentials for a credential id that is not stored', () =>
    Effect.gen(function* () {
      const passkeys = yield* Passkeys
      const authOptions = yield* passkeys.loginOptions()
      const exit = yield* Effect.exit(
        passkeys.loginVerify(authenticationResponse(authOptions.challenge)),
      )
      expect(exit._tag).toBe('Failure')
    }).pipe(Effect.provide(testLayer(stubWebAuthn({ authentication: authenticationInfo(1) })))),
  )
})

describe('passkey login HTTP routes', () => {
  it.effect(
    'POST /auth/login/passkey/options returns options; POST /auth/login/passkey sets the session cookie',
    () =>
      Effect.gen(function* () {
        yield* insertUser('user-9', 'heidi')
        const passkeys = yield* Passkeys
        const authSessions = yield* AuthSessions
        const user = domainUser('user-9', 'heidi')
        const regOptions = yield* passkeys.enrollStart(user)
        yield* passkeys.enrollFinish(user, registrationResponse(regOptions.challenge, ['internal']))

        const router = HttpRouter.empty.pipe(
          HttpRouter.post('/auth/login/passkey/options', optionsResponse(passkeys)),
          HttpRouter.post('/auth/login/passkey', loginResponse(passkeys, authSessions, APP_ORIGIN)),
        )
        const handle = HttpApp.toWebHandler(router)

        const optionsRes = yield* Effect.promise(() =>
          handle(new Request('http://localhost/auth/login/passkey/options', { method: 'POST' })),
        )
        expect(optionsRes.status).toBe(200)
        const optionsBody = (yield* jsonOf(optionsRes)) as {
          readonly allowCredentials?: readonly unknown[]
          readonly challenge: string
        }
        expect(optionsBody.allowCredentials ?? []).toHaveLength(0)

        const loginRes = yield* Effect.promise(() =>
          handle(
            new Request('http://localhost/auth/login/passkey', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ response: authenticationResponse(optionsBody.challenge) }),
            }),
          ),
        )
        expect(loginRes.status).toBe(200)
        expect(loginRes.headers.get('set-cookie')).toContain('j45_session=')
        const loginBody = (yield* jsonOf(loginRes)) as { readonly user: { readonly id: string } }
        expect(loginBody.user.id).toBe('user-9')
      }).pipe(
        Effect.provide(
          testLayer(
            stubWebAuthn({
              registration: registrationInfo(0),
              authentication: authenticationInfo(3),
            }),
          ),
        ),
      ),
  )
})
