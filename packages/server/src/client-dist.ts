import { fileURLToPath } from 'node:url'

import * as Config from 'effect/Config'
import * as Context from 'effect/Context'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'

/**
 * Where the static route reads the built client from. A `Context.Tag` (not
 * just a `Config`) so tests can override it with `Layer.succeed` — a temp
 * directory instead of the real `packages/client/dist`, which may not exist
 * until the `client` task builds it.
 */
export class ClientDistDir extends Context.Tag('@j45/server/ClientDistDir')<
  ClientDistDir,
  { readonly path: string }
>() {}

const defaultDistDir = fileURLToPath(new URL('../../client/dist', import.meta.url))

/** Defaults to `packages/client/dist`; overridable via `CLIENT_DIST_DIR`. */
const ClientDistDirConfig = Config.string('CLIENT_DIST_DIR').pipe(
  Config.withDefault(defaultDistDir),
)

export const ClientDistDirLive = Layer.effect(
  ClientDistDir,
  Effect.map(ClientDistDirConfig, (path) => ({ path })),
)
