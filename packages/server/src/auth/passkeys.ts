import { SqlClient } from '@effect/sql'
import type { SqlError } from '@effect/sql/SqlError'
import type { UserId } from '@j45/domain'
import { Forbidden, InvalidCredentials, PasskeySummary, User } from '@j45/domain'
import type {
  AuthenticationResponseJSON,
  AuthenticatorTransportFuture,
  GenerateAuthenticationOptionsOpts,
  GenerateRegistrationOptionsOpts,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
  VerifiedAuthenticationResponse,
  VerifiedRegistrationResponse,
  VerifyAuthenticationResponseOpts,
  VerifyRegistrationResponseOpts,
  WebAuthnCredential,
} from '@simplewebauthn/server'
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from '@simplewebauthn/server'
import * as Context from 'effect/Context'
import * as Data from 'effect/Data'
import * as DateTime from 'effect/DateTime'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import * as Option from 'effect/Option'

import { AppOriginConfig } from '../config.js'
import { ChallengeStore } from './challenge-store.js'
import { UserRepo } from './user-repo.js'

/** The user-visible relying-party name shown in the authenticator prompt. */
const RP_NAME = 'J45'

/**
 * The WebAuthn relying-party identity, derived from `APP_ORIGIN` per the
 * design: `rpID` is the origin's hostname (`localhost` in dev/e2e,
 * `j45.atassi.org` in prod), and `expectedOrigin` is the full normalized
 * origin that every ceremony's `clientDataJSON` must match.
 */
const deriveRp = (appOrigin: string) => {
  const url = new URL(appOrigin)
  return { rpID: url.hostname, expectedOrigin: url.origin } as const
}

/** A `@simplewebauthn/server` verify call threw — mapped on to `InvalidCredentials`. */
export class WebAuthnError extends Data.TaggedError('WebAuthnError')<{
  readonly cause: unknown
}> {}

/**
 * The single seam over `@simplewebauthn/server`: the four ceremony halves as
 * Effects. `WebAuthnLive` is the only production implementation; tests swap
 * in a stub for the two `verify*` operations (real authenticator crypto is
 * exercised by the chromium e2e task, not here). Keeping simplewebauthn
 * behind this tag is why the domain package stays free of it.
 */
export type WebAuthnService = {
  readonly generateRegistrationOptions: (
    options: GenerateRegistrationOptionsOpts,
  ) => Effect.Effect<PublicKeyCredentialCreationOptionsJSON>
  readonly verifyRegistrationResponse: (
    options: VerifyRegistrationResponseOpts,
  ) => Effect.Effect<VerifiedRegistrationResponse, WebAuthnError>
  readonly generateAuthenticationOptions: (
    options: GenerateAuthenticationOptionsOpts,
  ) => Effect.Effect<PublicKeyCredentialRequestOptionsJSON>
  readonly verifyAuthenticationResponse: (
    options: VerifyAuthenticationResponseOpts,
  ) => Effect.Effect<VerifiedAuthenticationResponse, WebAuthnError>
}

export class WebAuthn extends Context.Tag('WebAuthn')<WebAuthn, WebAuthnService>() {}

/** The real `@simplewebauthn/server`; the sole seam through which it is called. */
export const WebAuthnLive: Layer.Layer<WebAuthn> = Layer.succeed(WebAuthn, {
  generateRegistrationOptions: (options) =>
    Effect.promise(() => generateRegistrationOptions(options)),
  verifyRegistrationResponse: (options) =>
    Effect.tryPromise({
      try: () => verifyRegistrationResponse(options),
      catch: (cause) => new WebAuthnError({ cause }),
    }),
  generateAuthenticationOptions: (options) =>
    Effect.promise(() => generateAuthenticationOptions(options)),
  verifyAuthenticationResponse: (options) =>
    Effect.tryPromise({
      try: () => verifyAuthenticationResponse(options),
      catch: (cause) => new WebAuthnError({ cause }),
    }),
})

type PasskeyRow = {
  readonly id: string
  readonly user_id: string
  readonly public_key: Uint8Array
  readonly counter: number
  readonly transports: string | null
  readonly created_at: string
  readonly last_used_at: string | null
}

/** Everything a ceremony half needs, resolved once at service construction. */
type Deps = {
  readonly sql: SqlClient.SqlClient
  readonly webauthn: WebAuthnService
  readonly challenges: ChallengeStore
  readonly users: UserRepo
  readonly rpID: string
  readonly expectedOrigin: string
}

/**
 * Pulls the base64url challenge out of a ceremony response's
 * `clientDataJSON`, so the (untrusted) value can be matched against — and
 * consumed from — the `ChallengeStore`. Any malformed input fails
 * `InvalidCredentials` rather than surfacing a parse defect.
 */
const decodeChallenge = (response: unknown): Effect.Effect<string, InvalidCredentials> =>
  Effect.try({
    try: () => {
      const clientDataJSON = (
        response as { readonly response?: { readonly clientDataJSON?: unknown } }
      ).response?.clientDataJSON
      if (typeof clientDataJSON !== 'string') {
        throw new TypeError('missing clientDataJSON')
      }
      const decoded = Buffer.from(clientDataJSON, 'base64url').toString('utf8')
      const challenge = (JSON.parse(decoded) as { readonly challenge?: unknown }).challenge
      if (typeof challenge !== 'string') {
        throw new TypeError('missing challenge')
      }
      return challenge
    },
    catch: () => new InvalidCredentials(),
  })

const credentialIdOf = (response: unknown): string | undefined => {
  const id = (response as { readonly id?: unknown }).id
  return typeof id === 'string' ? id : undefined
}

const responseTransports = (response: unknown): AuthenticatorTransportFuture[] => {
  const transports = (response as { readonly response?: { readonly transports?: unknown } })
    .response?.transports
  return Array.isArray(transports) ? (transports as AuthenticatorTransportFuture[]) : []
}

const rowToSummary = (
  row: Pick<PasskeyRow, 'id' | 'created_at' | 'last_used_at'>,
): PasskeySummary =>
  new PasskeySummary({
    id: row.id,
    createdAt: DateTime.unsafeMake(row.created_at),
    ...(row.last_used_at === null ? {} : { lastUsedAt: DateTime.unsafeMake(row.last_used_at) }),
  })

const toWebAuthnCredential = (row: PasskeyRow): WebAuthnCredential => ({
  id: row.id,
  publicKey: new Uint8Array(row.public_key),
  counter: row.counter,
  ...(row.transports === null
    ? {}
    : { transports: JSON.parse(row.transports) as AuthenticatorTransportFuture[] }),
})

/** Takes the challenge from the store, mapping its miss on to `InvalidCredentials`. */
const consume = (deps: Deps, challenge: string): Effect.Effect<string, InvalidCredentials> =>
  deps.challenges.take(challenge).pipe(Effect.mapError(() => new InvalidCredentials()))

const findCredential = (deps: Deps, id: string) =>
  deps.sql<PasskeyRow>`SELECT * FROM passkey_credentials WHERE id = ${id}`.pipe(
    Effect.flatMap((rows) =>
      rows[0] === undefined ? Effect.fail(new InvalidCredentials()) : Effect.succeed(rows[0]),
    ),
  )

/**
 * A `SqlError` mid-ceremony is infrastructure failing, not a bad credential:
 * turn it into a defect so a method's declared error channel stays exactly
 * its domain errors (`InvalidCredentials`/`Forbidden`). Applied at each seam
 * via `Effect.catchTag('SqlError', asDefect)`.
 */
const asDefect = (error: SqlError): Effect.Effect<never> => Effect.die(error)

const enrollStart = (deps: Deps, user: User) =>
  Effect.gen(function* () {
    const options = yield* deps.webauthn.generateRegistrationOptions({
      rpName: RP_NAME,
      rpID: deps.rpID,
      userName: user.username,
      userDisplayName: user.displayName,
      userID: new TextEncoder().encode(user.id),
      authenticatorSelection: { residentKey: 'required', userVerification: 'preferred' },
    })
    yield* deps.challenges.put(options.challenge)
    return options
  })

const verifyRegistration = (
  deps: Deps,
  response: unknown,
  challenge: string,
): Effect.Effect<WebAuthnCredential, InvalidCredentials> =>
  Effect.gen(function* () {
    const verification = yield* deps.webauthn
      .verifyRegistrationResponse({
        response: response as RegistrationResponseJSON,
        expectedChallenge: challenge,
        expectedOrigin: deps.expectedOrigin,
        expectedRPID: deps.rpID,
      })
      .pipe(Effect.mapError(() => new InvalidCredentials()))
    if (!verification.verified) {
      return yield* Effect.fail(new InvalidCredentials())
    }
    return verification.registrationInfo.credential
  })

const enrollFinish = (deps: Deps, user: User, response: unknown) =>
  Effect.gen(function* () {
    const challenge = yield* decodeChallenge(response)
    yield* consume(deps, challenge)
    const credential = yield* verifyRegistration(deps, response, challenge)
    const now = yield* DateTime.now
    yield* deps.sql`INSERT INTO passkey_credentials ${deps.sql.insert({
      id: credential.id,
      user_id: user.id,
      public_key: Buffer.from(credential.publicKey),
      counter: credential.counter,
      transports: JSON.stringify(responseTransports(response)),
      created_at: DateTime.formatIso(now),
      last_used_at: null,
    })}`
    return new PasskeySummary({ id: credential.id, createdAt: now })
  }).pipe(Effect.catchTag('SqlError', asDefect))

const listCredentials = (deps: Deps, userId: UserId) =>
  deps.sql<PasskeyRow>`
    SELECT * FROM passkey_credentials WHERE user_id = ${userId} ORDER BY created_at
  `.pipe(
    Effect.map((rows) => rows.map(rowToSummary)),
    Effect.catchTag('SqlError', asDefect),
  )

const deleteOwned = (deps: Deps, userId: UserId, id: string) =>
  Effect.gen(function* () {
    const rows = yield* deps.sql<{
      readonly user_id: string
    }>`SELECT user_id FROM passkey_credentials WHERE id = ${id}`
    if (rows[0] !== undefined && rows[0].user_id !== userId) {
      return yield* Effect.fail(new Forbidden())
    }
    yield* deps.sql`DELETE FROM passkey_credentials WHERE id = ${id} AND user_id = ${userId}`
  }).pipe(Effect.catchTag('SqlError', asDefect))

const loginOptions = (deps: Deps) =>
  Effect.gen(function* () {
    const options = yield* deps.webauthn.generateAuthenticationOptions({
      rpID: deps.rpID,
      allowCredentials: [],
      userVerification: 'preferred',
    })
    yield* deps.challenges.put(options.challenge)
    return options
  })

const touchCredential = (deps: Deps, id: string, counter: number) =>
  Effect.gen(function* () {
    const now = yield* DateTime.now
    yield* deps.sql`
      UPDATE passkey_credentials
      SET counter = ${counter}, last_used_at = ${DateTime.formatIso(now)}
      WHERE id = ${id}
    `
  })

const loadUser = (deps: Deps, userId: string) =>
  Effect.gen(function* () {
    const found = yield* deps.users.findById(userId as UserId)
    if (Option.isNone(found)) {
      return yield* Effect.fail(new InvalidCredentials())
    }
    const row = found.value
    return new User({
      id: row.id,
      username: row.username,
      displayName: row.displayName,
      role: row.role,
    })
  })

const loginVerify = (deps: Deps, response: unknown): Effect.Effect<User, InvalidCredentials> =>
  Effect.gen(function* () {
    const credentialId = credentialIdOf(response)
    if (credentialId === undefined) {
      return yield* Effect.fail(new InvalidCredentials())
    }
    const stored = yield* findCredential(deps, credentialId)
    const challenge = yield* decodeChallenge(response)
    yield* consume(deps, challenge)
    const verification = yield* deps.webauthn
      .verifyAuthenticationResponse({
        response: response as AuthenticationResponseJSON,
        expectedChallenge: challenge,
        expectedOrigin: deps.expectedOrigin,
        expectedRPID: deps.rpID,
        credential: toWebAuthnCredential(stored),
      })
      .pipe(Effect.mapError(() => new InvalidCredentials()))
    if (!verification.verified) {
      return yield* Effect.fail(new InvalidCredentials())
    }
    yield* touchCredential(deps, stored.id, verification.authenticationInfo.newCounter)
    return yield* loadUser(deps, stored.user_id)
  }).pipe(Effect.catchTag('SqlError', asDefect))

/**
 * The passkey ceremony service — the four WebAuthn halves plus the caller's
 * own-credential management, all behind the `WebAuthn` seam so
 * simplewebauthn is never called from anywhere else. `rpID`/`expectedOrigin`
 * are derived once from `APP_ORIGIN`; challenges are one-time via
 * `ChallengeStore`; credentials persist to `passkey_credentials` (base64url
 * id, public key blob, counter, transports JSON) through the generic
 * `SqlClient` tag.
 */
export class Passkeys extends Effect.Service<Passkeys>()('Passkeys', {
  effect: Effect.gen(function* () {
    const appOrigin = yield* AppOriginConfig
    const deps: Deps = {
      sql: yield* SqlClient.SqlClient,
      webauthn: yield* WebAuthn,
      challenges: yield* ChallengeStore,
      users: yield* UserRepo,
      ...deriveRp(appOrigin),
    }
    return {
      enrollStart: (user: User) => enrollStart(deps, user),
      enrollFinish: (user: User, response: unknown) => enrollFinish(deps, user, response),
      listForUser: (userId: UserId) => listCredentials(deps, userId),
      deleteForUser: (userId: UserId, id: string) => deleteOwned(deps, userId, id),
      loginOptions: () => loginOptions(deps),
      loginVerify: (response: unknown) => loginVerify(deps, response),
    } as const
  }),
  dependencies: [WebAuthnLive, ChallengeStore.Default, UserRepo.Default],
}) {}
