import * as FileSystem from '@effect/platform/FileSystem'
import type * as Headers from '@effect/platform/Headers'
import * as HttpRouter from '@effect/platform/HttpRouter'
import * as HttpServerRequest from '@effect/platform/HttpServerRequest'
import * as HttpServerResponse from '@effect/platform/HttpServerResponse'
import * as Path from '@effect/platform/Path'
import * as Effect from 'effect/Effect'
import type * as Layer from 'effect/Layer'
import * as Option from 'effect/Option'

import type { BuildFile } from './client-dist.js'
import { ClientDistDir, entryDocument, resolveDistPath } from './client-dist.js'
import { ReleaseShaConfig, ServeClientConfig } from './config.js'
import { cacheControlFor, isNotModified } from './static-cache.js'
import { version } from './version.js'

/**
 * Plain HTTP `GET /healthz` — the one recorded exception to the
 * everything-through-rpc rule (ops surface for deploy hooks and uptime
 * checks, not client traffic).
 */
export const HealthzRouteLive: Layer.Layer<never> = HttpRouter.Default.use((router) =>
  router.get(
    '/healthz',
    Effect.gen(function* () {
      // A missing/malformed RELEASE_SHA is a deploy misconfiguration, not a
      // client-facing failure — surface it as a defect.
      const sha = yield* Effect.orDie(ReleaseShaConfig)
      return yield* HttpServerResponse.json({ sha, version })
    }),
  ),
)

/**
 * One file out of the client build, carrying the cache policy its class
 * earns — or a bodiless `304` when the request's validators already describe
 * it. `HttpServerResponse.file` supplies the validators themselves (`ETag`
 * from size+mtime, `Last-Modified`) but never acts on the ones a client sends
 * back, so the comparison is ours to make; without it, forcing revalidation
 * on the entry document would re-send the whole document every load.
 */
const buildFileResponse = (file: BuildFile, requestHeaders: Headers.Headers) =>
  Effect.gen(function* () {
    const response = yield* HttpServerResponse.file(file.absolutePath, {
      headers: { 'cache-control': cacheControlFor(file.buildRelativePath) },
    })
    return isNotModified(requestHeaders, response.headers)
      ? // `response.headers` is exactly the validators plus the cache policy,
        // which is what RFC 9110 §15.4.5 asks a 304 to repeat.
        HttpServerResponse.empty({ status: 304, headers: response.headers })
      : response
  })

/**
 * Per-request handler: serve the requested file from the dist directory,
 * fall back to `index.html` for client-side routing, else 404.
 */
const staticFileHandler = (resolvedDistDir: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const path_ = yield* Path.Path
    const request = yield* HttpServerRequest.HttpServerRequest

    const distDir = path_.resolve(resolvedDistDir)
    const { pathname } = new URL(request.url, 'http://localhost')
    const isFilePresent = (candidate: string) =>
      fs.exists(candidate).pipe(Effect.orElseSucceed(() => false))

    // `Option.none()` when `..` segments would escape distDir.
    const requested = resolveDistPath(path_, distDir, pathname)
    if (Option.isSome(requested) && (yield* isFilePresent(requested.value.absolutePath))) {
      return yield* buildFileResponse(requested.value, request.headers)
    }

    const entry = entryDocument(path_, distDir)
    if (yield* isFilePresent(entry.absolutePath)) {
      return yield* buildFileResponse(entry, request.headers)
    }

    return HttpServerResponse.empty({ status: 404 })
  })

/**
 * Serves the built client from `ClientDistDir` for every route not claimed
 * by `/healthz` or `/rpc` (those are matched first — `find-my-way-ts`
 * prioritizes literal segments over the `*` wildcard regardless of
 * registration order). Falls back to `index.html` for client-side routing;
 * responds 404 when `ClientDistDir` has no build yet.
 *
 * With `SERVE_CLIENT=false` (the dev script) the wildcard instead 404s with
 * a pointer to the Vite dev server, so a stale local build is never served.
 */
export const StaticRouteLive: Layer.Layer<never, never, ClientDistDir> = HttpRouter.Default.use(
  (router) =>
    Effect.gen(function* () {
      // A malformed SERVE_CLIENT is a launch misconfiguration, not a
      // client-facing failure — surface it as a defect.
      const isServingClient = yield* Effect.orDie(ServeClientConfig)
      if (!isServingClient) {
        yield* router.get(
          '*',
          Effect.succeed(
            HttpServerResponse.text(
              'client serving is off (SERVE_CLIENT=false); in dev the client is Vite on :5173\n',
              { status: 404 },
            ),
          ),
        )
        return
      }

      // Resolved once, outside the per-request handler, so the handler
      // itself only needs the router's default services.
      const { path: distDir } = yield* ClientDistDir

      yield* router.get('*', staticFileHandler(distDir))
    }),
)
