import { Result, useAtomValue } from '@effect-atom/atom-react'

import { ServerRpcClient } from '@/lib/rpc-client'

/**
 * Proves rpc -> atom -> React end-to-end: `useAtomValue` reads the
 * `ServerInfo` rpc atom (WebSocket to `/rpc`) and renders the release sha
 * as a quiet footer detail on the account screen.
 */
export function ServerInfoCard() {
  const serverInfo = useAtomValue(ServerRpcClient.query('ServerInfo', undefined))

  return (
    <div
      className="w-full max-w-sm text-center text-xs text-muted-foreground"
      data-testid="server-info-card"
    >
      {Result.match(serverInfo, {
        onInitial: () => <p>Connecting…</p>,
        onFailure: (failure) => (
          <p className="text-destructive">Failed to reach server: {String(failure.cause)}</p>
        ),
        onSuccess: ({ value }) => (
          <p>
            <span className="font-mono" data-testid="server-info-sha">
              {value.sha}
            </span>
            <span className="mx-1.5">·</span>
            <span className="font-mono">{value.version}</span>
          </p>
        ),
      })}
    </div>
  )
}
