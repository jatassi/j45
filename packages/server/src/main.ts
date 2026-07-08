import { BunContext, BunRuntime } from '@effect/platform-bun'
import * as Layer from 'effect/Layer'

import { FirstRunLive } from './auth/first-run.js'
import { ServerLive } from './server.js'
import { SqlLive } from './sql.js'

/**
 * `SqlLive` runs migrations once as a side effect of layer construction.
 * Both `ServerLive` (the `/auth/*` routes) and `FirstRunLive` (it mints the
 * bootstrap invite against the real `invites`/`users` tables) depend on the
 * `SqlClient.SqlClient` it produces, so it's threaded through `provideMerge`
 * into their merge rather than left as a plain `mergeAll` sibling — that
 * dependency edge is what "after migrations" means in practice: neither can
 * build until `SqlLive`'s migration effect has already run.
 */
const MainLive = Layer.mergeAll(ServerLive, FirstRunLive).pipe(
  Layer.provideMerge(SqlLive),
  Layer.provide(BunContext.layer),
)

BunRuntime.runMain(Layer.launch(MainLive))
