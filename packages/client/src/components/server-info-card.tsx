import { Result, useAtomValue } from "@effect-atom/atom-react"

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { ServerRpcClient } from "@/lib/rpc-client"

/**
 * Proves rpc -> atom -> React end-to-end: `useAtomValue` reads the
 * `ServerInfo` rpc atom (WebSocket to `/rpc`) and renders `sha`, `version`,
 * and `serverTime` inside a shadcn/ui `Card`.
 */
export function ServerInfoCard() {
  const serverInfo = useAtomValue(ServerRpcClient.query("ServerInfo", undefined))

  return (
    <Card className="w-full max-w-sm" data-testid="server-info-card">
      <CardHeader>
        <CardTitle>J45 server</CardTitle>
        <CardDescription>Live status from the ServerInfo rpc</CardDescription>
      </CardHeader>
      <CardContent>
        {Result.match(serverInfo, {
          onInitial: () => (
            <p className="text-sm text-muted-foreground">Connecting…</p>
          ),
          onFailure: (failure) => (
            <p className="text-sm text-destructive">
              Failed to reach server: {String(failure.cause)}
            </p>
          ),
          onSuccess: ({ value }) => (
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
              <dt className="text-muted-foreground">sha</dt>
              <dd className="font-mono" data-testid="server-info-sha">
                {value.sha}
              </dd>
              <dt className="text-muted-foreground">version</dt>
              <dd className="font-mono" data-testid="server-info-version">
                {value.version}
              </dd>
              <dt className="text-muted-foreground">serverTime</dt>
              <dd className="font-mono" data-testid="server-info-server-time">
                {value.serverTime.toString()}
              </dd>
            </dl>
          ),
        })}
      </CardContent>
    </Card>
  )
}
