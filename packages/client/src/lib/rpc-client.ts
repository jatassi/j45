import { AtomRpc } from '@effect-atom/atom-react'
import * as Socket from '@effect/platform/Socket'
import * as RpcClient from '@effect/rpc/RpcClient'
import * as RpcSerialization from '@effect/rpc/RpcSerialization'
import { J45Rpcs } from '@j45/domain'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'

import { withAuthSessionExpiry } from '@/lib/auth-session-expiry'

/**
 * WebSocket url for the `/rpc` endpoint, served by the same origin the page
 * was loaded from (the Vite dev server proxies it to the server on :3000;
 * production serves both from the same origin).
 */
const rpcUrl = (): string => {
  const scheme = globalThis.location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${scheme}//${globalThis.location.host}/rpc`
}

const ProtocolLive = RpcClient.layerProtocolSocket().pipe(
  Layer.provide(RpcSerialization.layerNdjson),
  Layer.provide(Socket.layerWebSocket(rpcUrl())),
  Layer.provide(Socket.layerWebSocketConstructorGlobal),
)

/**
 * The AtomRpc client for `J45Rpcs`, backed by a WebSocket connection to
 * `/rpc`. Atoms derived from `.query` render `Result`s consumable via
 * `useAtomValue`.
 *
 * `makeEffect` is the default flat client (exactly what `AtomRpc.Tag` would
 * have built) with one wrapper around it. This is the single chokepoint every
 * rpc in the app passes through, which makes it the only sane place to notice
 * that the server has stopped recognising us: `withAuthSessionExpiry` reports
 * any `Unauthorized` so `AuthGate` can re-probe and return to the login
 * screen, instead of every screen handling it — or, as before, none of them
 * doing.
 */
export class ServerRpcClient extends AtomRpc.Tag<ServerRpcClient>()('ServerRpcClient', {
  group: J45Rpcs,
  protocol: ProtocolLive,
  makeEffect: RpcClient.make(J45Rpcs, { flatten: true }).pipe(Effect.map(withAuthSessionExpiry)),
}) {}
