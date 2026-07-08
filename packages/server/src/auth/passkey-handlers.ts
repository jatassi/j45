import { AccountRpcs, CurrentUser } from '@j45/domain'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'

import { Passkeys } from './passkeys.js'

/**
 * The four passkey-shaped `AccountRpcs` handlers, each cut as its own layer
 * via `toLayerHandler` so the account group's non-passkey handlers (`Me`,
 * owner rpcs) can be contributed by a sibling task and merged in
 * `rpc-serve-all`. Every handler runs behind `AuthMiddleware`, so
 * `CurrentUser` is in context; the ceremony work itself lives in `Passkeys`.
 * Enrollment and listing/deletion always scope to `CurrentUser` — a caller
 * only ever sees or mutates their own credentials.
 */
const enrollStart = AccountRpcs.toLayerHandler('PasskeyEnrollStart', () =>
  Effect.gen(function* () {
    const user = yield* CurrentUser
    const passkeys = yield* Passkeys
    return yield* passkeys.enrollStart(user)
  }),
)

const enrollFinish = AccountRpcs.toLayerHandler('PasskeyEnrollFinish', ({ response }) =>
  Effect.gen(function* () {
    const user = yield* CurrentUser
    const passkeys = yield* Passkeys
    return yield* passkeys.enrollFinish(user, response)
  }),
)

const listPasskeys = AccountRpcs.toLayerHandler('ListPasskeys', () =>
  Effect.gen(function* () {
    const user = yield* CurrentUser
    const passkeys = yield* Passkeys
    return yield* passkeys.listForUser(user.id)
  }),
)

const deletePasskey = AccountRpcs.toLayerHandler('DeletePasskey', ({ id }) =>
  Effect.gen(function* () {
    const user = yield* CurrentUser
    const passkeys = yield* Passkeys
    yield* passkeys.deleteForUser(user.id, id)
  }),
)

/** All four passkey account-rpc handlers, requiring only `Passkeys`. */
export const PasskeyHandlersLive = Layer.mergeAll(
  enrollStart,
  enrollFinish,
  listPasskeys,
  deletePasskey,
)
