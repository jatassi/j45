import { BunContext, BunRuntime } from '@effect/platform-bun'
import * as Layer from 'effect/Layer'

import { ServerLive } from './server.js'
import { SqlLive } from './sql.js'

/**
 * `SqlLive` runs migrations once as a side effect of layer construction, so
 * merging it alongside `ServerLive` runs them at startup, before the http
 * server (which has no persistence-backed routes yet) starts serving.
 */
const MainLive = Layer.mergeAll(ServerLive, SqlLive).pipe(Layer.provide(BunContext.layer))

BunRuntime.runMain(Layer.launch(MainLive))
