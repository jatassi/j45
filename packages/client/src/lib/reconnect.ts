import * as Duration from 'effect/Duration'
import type * as Effect from 'effect/Effect'

import type { ServerRpcClient } from '@/lib/rpc-client'

/**
 * What every streaming feed in this client shares: the client it subscribes
 * through, and how long it waits before it tries again.
 *
 * There is one reconnection approach in this app, not one per feed. A feed
 * that drifted to a backoff of its own would be a second answer to a question
 * that is already answered, and the two would disagree the moment either is
 * tuned.
 */

/** The flat rpc client `ServerRpcClient` resolves to. */
export type FeedClient = Effect.Effect.Success<typeof ServerRpcClient>

/** Exponential reconnect backoff, capped at 8s so a long outage keeps retrying. */
export const reconnectDelay = (attempt: number): Duration.Duration =>
  Duration.millis(Math.min(500 * 2 ** attempt, 8000))
