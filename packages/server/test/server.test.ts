import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { NodeContext, NodeSocket } from '@effect/platform-node'
import * as Command from '@effect/platform/Command'
import { RpcClient, RpcSerialization } from '@effect/rpc'
import { describe, it } from '@effect/vitest'
import { J45Rpcs, ServerInfo } from '@j45/domain'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import * as Schedule from 'effect/Schedule'
import * as Schema from 'effect/Schema'
import { expect } from 'vitest'

import { version } from '../src/version.js'

const serverDir = fileURLToPath(new URL('..', import.meta.url))

const get = (port: number, pathname: string, headers: Record<string, string> = {}) =>
  Effect.tryPromise(() => fetch(`http://localhost:${port}${pathname}`, { headers }))

const bodyOf = (response: Response) => Effect.tryPromise(() => response.text())

/**
 * Reserves a free TCP port by briefly binding to port 0, then releasing it
 * before the real server (a separate process) binds it.
 */
const getFreePort = Effect.async<number, Error>((resume) => {
  const probe = createServer()
  probe.listen(0, () => {
    const address = probe.address()
    probe.close(() => {
      if (address !== null && typeof address === 'object') {
        resume(Effect.succeed(address.port))
      } else {
        resume(Effect.fail(new Error('could not determine a free port')))
      }
    })
  })
})

const waitForHealthz = (port: number) =>
  get(port, '/healthz').pipe(
    Effect.filterOrFail(
      (response) => response.status === 200,
      () => new Error('server not ready'),
    ),
    Effect.retry({ schedule: Schedule.spaced('100 millis'), times: 100 }),
  )

/**
 * Spawns the real production entrypoint (`bun run src/main.ts`) on a free
 * port. vitest's worker pool runs under Node, where the `Bun` global (and
 * so `BunHttpServer`'s websocket upgrade support) isn't available — the
 * same reason server-sql's tests swap in `@effect/sql-sqlite-node` for the
 * driver. Here the server itself must run as a genuine Bun process; the
 * http/rpc *clients* below run fine under Node against it. The child is
 * killed automatically when the enclosing scope closes.
 */
const bootServer = (options: {
  readonly releaseSha: string
  readonly clientDistDir?: string
  readonly serveClient?: boolean
}) =>
  Effect.gen(function* () {
    const port = yield* getFreePort
    const command = Command.make('bun', 'run', 'src/main.ts').pipe(
      Command.workingDirectory(serverDir),
      Command.env({
        PORT: String(port),
        RELEASE_SHA: options.releaseSha,
        ...(options.clientDistDir !== undefined && { CLIENT_DIST_DIR: options.clientDistDir }),
        ...(options.serveClient !== undefined && { SERVE_CLIENT: String(options.serveClient) }),
      }),
    )
    yield* Command.start(command)
    yield* waitForHealthz(port)
    return port
  }).pipe(Effect.provide(NodeContext.layer))

const entryHtml = '<h1>entry</h1>'
const outsideBuild = 'OUTSIDE THE BUILD'

/**
 * A stand-in for a real Vite build: the HTML entry document, one
 * content-hashed asset under `assets/`, and one `public/` passthrough whose
 * name is stable across builds — the three cache classes the static route
 * distinguishes.
 */
const makeDistDir = Effect.gen(function* () {
  const root = yield* Effect.tryPromise(() => mkdtemp(path.join(tmpdir(), 'j45-client-')))
  const distDir = path.join(root, 'dist')
  yield* Effect.tryPromise(() => mkdir(path.join(distDir, 'assets'), { recursive: true }))
  yield* Effect.tryPromise(() => writeFile(path.join(distDir, 'index.html'), entryHtml))
  yield* Effect.tryPromise(() =>
    writeFile(path.join(distDir, 'assets', 'index-DDjKQXnb.js'), "console.log('hi')"),
  )
  yield* Effect.tryPromise(() => writeFile(path.join(distDir, 'vite.svg'), '<svg />'))
  // One level above the build — the thing a traversal would be reaching for.
  yield* Effect.tryPromise(() => writeFile(path.join(root, 'release.env'), outsideBuild))
  return distDir
})

describe('server', () => {
  it.scopedLive(
    'GET /healthz returns 200 JSON with sha and version',
    () =>
      Effect.gen(function* () {
        const port = yield* bootServer({ releaseSha: 'test-sha-healthz' })

        const response = yield* get(port, '/healthz')
        expect(response.status).toBe(200)

        const body = yield* Effect.tryPromise(() => response.json())
        expect(body).toEqual({ sha: 'test-sha-healthz', version })
      }),
    { timeout: 20_000 },
  )

  it.scopedLive(
    'the ServerInfo rpc (imported from @j45/domain) responds over /rpc',
    () =>
      Effect.gen(function* () {
        const port = yield* bootServer({ releaseSha: 'test-sha-rpc' })

        // The client and its call must share one `Effect.provide` scope —
        // scoping the protocol layer around `RpcClient.make` alone closes
        // it (and interrupts the socket's read loop) the instant `make`
        // returns, before any rpc call can complete.
        const info = yield* Effect.gen(function* () {
          const client = yield* RpcClient.make(J45Rpcs)
          return yield* client.ServerInfo()
        }).pipe(
          Effect.provide(
            RpcClient.layerProtocolSocket().pipe(
              Layer.provide(NodeSocket.layerWebSocket(`ws://localhost:${port}/rpc`)),
              Layer.provide(RpcSerialization.layerNdjson),
            ),
          ),
        )

        expect(Schema.is(ServerInfo)(info)).toBe(true)
        expect(info.sha).toBe('test-sha-rpc')
        expect(info.version).toBe(version)
      }),
    { timeout: 20_000 },
  )

  it.scopedLive(
    'serves static files from packages/client/dist, falling back to index.html',
    () =>
      Effect.gen(function* () {
        const distDir = yield* makeDistDir
        const port = yield* bootServer({ releaseSha: 'test-sha-static', clientDistDir: distDir })

        const asset = yield* get(port, '/assets/index-DDjKQXnb.js')
        expect(asset.status).toBe(200)
        expect(yield* bodyOf(asset)).toBe("console.log('hi')")

        const fallback = yield* get(port, '/some/spa/route')
        expect(fallback.status).toBe(200)
        expect(yield* bodyOf(fallback)).toBe(entryHtml)

        // A traversal-shaped request must never reach above the build.
        // `new URL()` normalizes a literal `..` away before the route sees the
        // pathname, so the encoded form is the one that actually arrives — and
        // it must stay encoded, not be decoded back into an escape.
        const escaped = yield* get(port, '/%2e%2e/release.env')
        const escapedBody = yield* bodyOf(escaped)
        expect(escapedBody).not.toContain(outsideBuild)
        expect(escapedBody).toBe(entryHtml)
      }),
    { timeout: 20_000 },
  )

  it.scopedLive(
    'SERVE_CLIENT=false disables static serving even when a build exists',
    () =>
      Effect.gen(function* () {
        const distDir = yield* makeDistDir
        const port = yield* bootServer({
          releaseSha: 'test-sha-no-static',
          clientDistDir: distDir,
          serveClient: false,
        })

        // bootServer already saw /healthz respond 200 — the ops surface
        // survives; the client build must not.
        const root = yield* get(port, '/')
        expect(root.status).toBe(404)
        expect(yield* bodyOf(root)).not.toContain('entry')
      }),
    { timeout: 20_000 },
  )

  it.scopedLive(
    'revalidates the entry document always and pins content-hashed assets for a year',
    () =>
      Effect.gen(function* () {
        const distDir = yield* makeDistDir
        const port = yield* bootServer({ releaseSha: 'test-sha-cache', clientDistDir: distDir })

        const root = yield* get(port, '/')
        expect(root.status).toBe(200)
        expect(root.headers.get('cache-control')).toBe('no-cache')

        // The fallback is the easy one to miss: it serves the entry document
        // under a URL that looks nothing like it.
        const fallback = yield* get(port, '/some/spa/route')
        expect(fallback.status).toBe(200)
        expect(yield* bodyOf(fallback)).toBe(entryHtml)
        expect(fallback.headers.get('cache-control')).toBe('no-cache')

        const asset = yield* get(port, '/assets/index-DDjKQXnb.js')
        expect(asset.status).toBe(200)
        expect(asset.headers.get('cache-control')).toBe('public, max-age=31536000, immutable')

        // A `public/` passthrough keeps its name across builds, so pinning it
        // alongside the hashed assets would be the very bug being fixed.
        const passthrough = yield* get(port, '/vite.svg')
        expect(passthrough.status).toBe(200)
        expect(passthrough.headers.get('cache-control')).toBe('no-cache')
      }),
    { timeout: 20_000 },
  )

  it.scopedLive(
    'answers a matching conditional request with a bodiless 304',
    () =>
      Effect.gen(function* () {
        const distDir = yield* makeDistDir
        const port = yield* bootServer({ releaseSha: 'test-sha-304', clientDistDir: distDir })

        const first = yield* get(port, '/')
        const etag = first.headers.get('etag') ?? ''
        const lastModified = first.headers.get('last-modified') ?? ''
        expect(etag).not.toBe('')
        expect(lastModified).not.toBe('')

        const byEtag = yield* get(port, '/', { 'if-none-match': etag })
        expect(byEtag.status).toBe(304)
        expect(yield* bodyOf(byEtag)).toBe('')
        // RFC 9110 §15.4.5: a 304 carries the policy the 200 would have.
        expect(byEtag.headers.get('cache-control')).toBe('no-cache')

        const byDate = yield* get(port, '/', { 'if-modified-since': lastModified })
        expect(byDate.status).toBe(304)
        expect(yield* bodyOf(byDate)).toBe('')

        const stale = yield* get(port, '/', { 'if-none-match': '"stale"' })
        expect(stale.status).toBe(200)
        expect(yield* bodyOf(stale)).toBe(entryHtml)
      }),
    { timeout: 20_000 },
  )
})
