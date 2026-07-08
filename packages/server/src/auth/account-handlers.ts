import type { Rpc } from '@effect/rpc'
import { AccountRpcs, CurrentUser } from '@j45/domain'
import type * as Layer from 'effect/Layer'

/**
 * Implements `Me` — the one `AccountRpcs` member this task owns. `CurrentUser`
 * is itself a valid `Effect` (resolving to whatever `AuthMiddlewareLive`
 * provided for this call), so the handler is just that tag. Cut via
 * `toLayerHandler` (not `toLayer`) so `webauthn`'s `ListPasskeys`,
 * `DeletePasskey`, `PasskeyEnrollStart`, and `PasskeyEnrollFinish` handler
 * layers can be developed and merged independently — `rpc-serve-all` merges
 * every `AccountRpcs` handler layer together before serving the group.
 */
export const MeHandlerLive: Layer.Layer<Rpc.Handler<'Me'>> = AccountRpcs.toLayerHandler(
  'Me',
  () => CurrentUser,
)
