import * as HttpRouter from "@effect/platform/HttpRouter"
import { BunHttpServer } from "@effect/platform-bun"
import { RpcSerialization, RpcServer } from "@effect/rpc"
import { J45Rpcs } from "@j45/domain"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"

import { ClientDistDirLive } from "./clientDist.js"
import { PortConfig } from "./config.js"
import { HealthzRouteLive, StaticRouteLive } from "./routes.js"
import { RpcHandlersLive } from "./rpcHandlers.js"

/** The Bun http server, listening on `PortConfig` (default 3000). */
const BunServerLive = Layer.unwrapEffect(
  Effect.map(PortConfig, (port) => BunHttpServer.layer({ port }))
)

const RpcProtocolLive = RpcServer.layerProtocolWebsocket({ path: "/rpc" }).pipe(
  Layer.provide(RpcSerialization.layerNdjson)
)

/** Serves `J45Rpcs` (imported from `@j45/domain`) over `/rpc`. */
const RpcLive = RpcServer.layer(J45Rpcs).pipe(
  Layer.provide(RpcHandlersLive),
  Layer.provide(RpcProtocolLive)
)

/**
 * The full server: `/healthz` (plain HTTP), `/rpc` (`J45Rpcs` over
 * websocket + ndjson), and static serving of `packages/client/dist` for
 * everything else.
 */
export const ServerLive = HttpRouter.Default.serve().pipe(
  Layer.provide(RpcLive),
  Layer.provide(HealthzRouteLive),
  Layer.provide(StaticRouteLive),
  Layer.provide(ClientDistDirLive),
  Layer.provide(BunServerLive)
)
