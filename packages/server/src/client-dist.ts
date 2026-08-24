import { fileURLToPath } from 'node:url'

import type * as Path from '@effect/platform/Path'
import * as Config from 'effect/Config'
import * as Context from 'effect/Context'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import * as Option from 'effect/Option'

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

/** The client build's HTML entry document, relative to the build root. */
export const ENTRY_DOCUMENT = 'index.html'

/**
 * One file inside the client build, named both ways: absolutely, to read it
 * off disk, and relative to the build root (always `/`-separated), to classify
 * it. The two always travel together, and deriving the second at the point of
 * use means un-resolving a path that was just resolved.
 */
export type BuildFile = {
  readonly absolutePath: string
  readonly buildRelativePath: string
}

const buildFile = (path_: Path.Path, distDir: string, absolutePath: string): BuildFile => ({
  absolutePath,
  buildRelativePath: path_.relative(distDir, absolutePath).split(path_.sep).join('/'),
})

/** The entry document of the build in `distDir`, the client-side-routing fallback. */
export const entryDocument = (path_: Path.Path, distDir: string): BuildFile =>
  buildFile(path_, distDir, path_.join(distDir, ENTRY_DOCUMENT))

/**
 * The file a request pathname names inside the (already absolute) client build
 * directory, `/` naming the entry document. `Option.none()` when `..` segments
 * would land outside the build — the directory-traversal guard.
 *
 * Resolution happens before classification deliberately: `/assets/../vite.svg`
 * names `vite.svg`, and the returned `buildRelativePath` says so.
 */
export const resolveDistPath = (
  path_: Path.Path,
  distDir: string,
  pathname: string,
): Option.Option<BuildFile> => {
  const requested = path_.resolve(
    path_.join(distDir, pathname === '/' ? ENTRY_DOCUMENT : pathname.slice(1)),
  )
  const isInside = requested === distDir || requested.startsWith(distDir + path_.sep)
  return isInside ? Option.some(buildFile(path_, distDir, requested)) : Option.none()
}
