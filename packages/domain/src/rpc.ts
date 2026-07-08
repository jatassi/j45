import { Rpc, RpcGroup } from "@effect/rpc"
import * as Schema from "effect/Schema"

/**
 * Snapshot of the running server, returned by the `ServerInfo` rpc.
 * `sha` and `version` prove the deployed build; `serverTime` proves the
 * server is the clock of record.
 */
export class ServerInfo extends Schema.Class<ServerInfo>("ServerInfo")({
  sha: Schema.String,
  version: Schema.String,
  serverTime: Schema.DateTimeUtc
}) {}

/**
 * The single rpc contract shared by every J45 client and server. Defined
 * exactly once, here — both `packages/server` and `packages/client` import
 * it from `@j45/domain` rather than redeclaring it.
 */
export class J45Rpcs extends RpcGroup.make(
  Rpc.make("ServerInfo", { success: ServerInfo })
) {}
