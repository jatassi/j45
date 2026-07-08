import type { Rpc } from "@effect/rpc"
import { J45Rpcs, ServerInfo } from "@j45/domain"
import * as DateTime from "effect/DateTime"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"

import { ReleaseShaConfig } from "./config.js"
import { version } from "./version.js"

/**
 * Implements every rpc in `J45Rpcs`. The contract — `ServerInfo` and
 * `J45Rpcs` themselves — is defined exactly once, in `@j45/domain`; this
 * module supplies behavior only, never schema.
 */
export const RpcHandlersLive: Layer.Layer<Rpc.Handler<"ServerInfo">> = J45Rpcs.toLayer({
  ServerInfo: () =>
    Effect.gen(function* () {
      // A missing/malformed RELEASE_SHA is a deploy misconfiguration, not an
      // expected rpc failure — surface it as a defect.
      const sha = yield* Effect.orDie(ReleaseShaConfig)
      const serverTime = yield* DateTime.now
      return new ServerInfo({ sha, version, serverTime })
    })
})
