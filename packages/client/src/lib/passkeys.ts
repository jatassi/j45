import { InvalidCredentials, type User } from '@j45/domain'
import type {
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
} from '@simplewebauthn/browser'
import { startAuthentication, startRegistration } from '@simplewebauthn/browser'
import * as Effect from 'effect/Effect'

import * as AuthApi from '@/lib/auth-api'
import { ServerRpcClient } from '@/lib/rpc-client'

/**
 * The usernameless passkey login ceremony: fetch authentication options from
 * `/auth/login/passkey/options` (empty `allowCredentials` — the credential
 * id in the assertion is what locates the account), run `startAuthentication`
 * in the browser (prompts the platform authenticator), then POST the
 * assertion to `/auth/login/passkey` to complete the session. Any way the
 * ceremony can fail — no discoverable credential, the user cancelling, the
 * server rejecting the assertion — surfaces as the same `InvalidCredentials`
 * the PIN fallback uses: from the caller's perspective a passkey attempt
 * that didn't produce a session is indistinguishable from bad credentials.
 */
export const loginWithPasskey = (): Effect.Effect<User, InvalidCredentials> =>
  Effect.gen(function* () {
    const optionsJSON = yield* AuthApi.loginPasskeyOptions()
    const response = yield* Effect.tryPromise({
      try: () =>
        startAuthentication({
          optionsJSON: optionsJSON as PublicKeyCredentialRequestOptionsJSON,
        }),
      catch: () => new InvalidCredentials(),
    })
    return yield* AuthApi.loginPasskey(response)
  })

/**
 * Enrolls a new passkey for the signed-in caller: `PasskeyEnrollStart` (rpc)
 * returns creation options (`residentKey: "required"` server-side, so the
 * result is discoverable/usernameless), `startRegistration` runs the browser
 * ceremony, and `PasskeyEnrollFinish` (rpc) verifies and stores the
 * credential. Requires the `ServerRpcClient` rpc client in scope — the
 * register/account screens that drive this from a click handler run it
 * through an atom (e.g. `ServerRpcClient.runtime.fn(() => enrollPasskey)`),
 * the same rpc connection `ServerInfoCard`'s query already uses.
 */
export const enrollPasskey = Effect.gen(function* () {
  const client = yield* ServerRpcClient
  const creationOptionsJSON = yield* client('PasskeyEnrollStart', undefined)
  const response = yield* Effect.tryPromise({
    try: () =>
      startRegistration({
        optionsJSON: creationOptionsJSON as PublicKeyCredentialCreationOptionsJSON,
      }),
    catch: () => new InvalidCredentials(),
  })
  return yield* client('PasskeyEnrollFinish', { response })
})

/**
 * `enrollPasskey` bound to `ServerRpcClient.runtime` so a click handler can
 * drive it via `useAtomSet(enrollPasskeyAtom, { mode: "promiseExit" })` (see
 * `components/enroll-passkey-prompt.tsx`) — this reuses the same long-lived
 * rpc connection the rest of the app's atoms share (e.g. `ServerInfoCard`'s
 * query) rather than opening a second one just for enrollment.
 */
export const enrollPasskeyAtom = ServerRpcClient.runtime.fn(() => enrollPasskey)
