import type { Rpc } from '@effect/rpc'
import { PublicRpcs, ServerInfo } from '@j45/domain'
import * as DateTime from 'effect/DateTime'
import * as Effect from 'effect/Effect'
import type * as Layer from 'effect/Layer'

import { ReleaseShaConfig } from './config.js'
import { version } from './version.js'

/**
 * Implements every rpc in `PublicRpcs`. `AccountRpcs`/`OwnerRpcs` need
 * `AuthMiddlewareLive` and their own handler layers before they can be
 * served — `rpc-serve-all` flips `server.ts` to the full `J45Rpcs` merge
 * once those exist. The contract — `ServerInfo` and the rpc groups
 * themselves — is defined exactly once, in `@j45/domain`; this module
 * supplies behavior only, never schema.
 */
export const RpcHandlersLive: Layer.Layer<Rpc.Handler<'ServerInfo'>> = PublicRpcs.toLayer({
  ServerInfo: () =>
    Effect.gen(function* () {
      // A missing/malformed RELEASE_SHA is a deploy misconfiguration, not an
      // expected rpc failure — surface it as a defect.
      const sha = yield* Effect.orDie(ReleaseShaConfig)
      const serverTime = yield* DateTime.now
      return new ServerInfo({ sha, version, serverTime })
    }),
})
