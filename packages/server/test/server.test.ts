import * as Command from "@effect/platform/Command"
import { NodeContext, NodeSocket } from "@effect/platform-node"
import { RpcClient, RpcSerialization } from "@effect/rpc"
import { describe, it } from "@effect/vitest"
import { J45Rpcs, ServerInfo } from "@j45/domain"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Schedule from "effect/Schedule"
import * as Schema from "effect/Schema"
import { createServer } from "node:http"
import { fileURLToPath } from "node:url"
import { expect } from "vitest"

import { version } from "../src/version.js"

const serverDir = fileURLToPath(new URL("..", import.meta.url))

/**
 * Reserves a free TCP port by briefly binding to port 0, then releasing it
 * before the real server (a separate process) binds it.
 */
const getFreePort = Effect.async<number, Error>((resume) => {
  const probe = createServer()
  probe.listen(0, () => {
    const address = probe.address()
    probe.close(() => {
      if (address !== null && typeof address === "object") {
        resume(Effect.succeed(address.port))
      } else {
        resume(Effect.fail(new Error("could not determine a free port")))
      }
    })
  })
})

const waitForHealthz = (port: number) =>
  Effect.tryPromise(() => fetch(`http://localhost:${port}/healthz`)).pipe(
    Effect.filterOrFail(
      (response) => response.status === 200,
      () => new Error("server not ready")
    ),
    Effect.retry({ schedule: Schedule.spaced("100 millis"), times: 100 })
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
}) =>
  Effect.gen(function* () {
    const port = yield* getFreePort
    const command = Command.make("bun", "run", "src/main.ts").pipe(
      Command.workingDirectory(serverDir),
      Command.env({
        PORT: String(port),
        RELEASE_SHA: options.releaseSha,
        ...(options.clientDistDir === undefined
          ? {}
          : { CLIENT_DIST_DIR: options.clientDistDir })
      })
    )
    yield* Command.start(command)
    yield* waitForHealthz(port)
    return port
  }).pipe(Effect.provide(NodeContext.layer))

describe("server", () => {
  it.scopedLive(
    "GET /healthz returns 200 JSON with sha and version",
    () =>
      Effect.gen(function* () {
        const port = yield* bootServer({ releaseSha: "test-sha-healthz" })

        const response = yield* Effect.tryPromise(() => fetch(`http://localhost:${port}/healthz`))
        expect(response.status).toBe(200)

        const body = yield* Effect.tryPromise(() => response.json())
        expect(body).toEqual({ sha: "test-sha-healthz", version })
      }),
    { timeout: 20_000 }
  )

  it.scopedLive(
    "the ServerInfo rpc (imported from @j45/domain) responds over /rpc",
    () =>
      Effect.gen(function* () {
        const port = yield* bootServer({ releaseSha: "test-sha-rpc" })

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
              Layer.provide(RpcSerialization.layerNdjson)
            )
          )
        )

        expect(Schema.is(ServerInfo)(info)).toBe(true)
        expect(info.sha).toBe("test-sha-rpc")
        expect(info.version).toBe(version)
      }),
    { timeout: 20_000 }
  )

  it.scopedLive(
    "serves static files from packages/client/dist, falling back to index.html",
    () =>
      Effect.gen(function* () {
        const fs = yield* Effect.promise(() => import("node:fs/promises"))
        const os = yield* Effect.promise(() => import("node:os"))
        const path = yield* Effect.promise(() => import("node:path"))

        const distDir = yield* Effect.tryPromise(() =>
          fs.mkdtemp(path.join(os.tmpdir(), "j45-client-dist-"))
        )
        yield* Effect.tryPromise(() =>
          fs.writeFile(path.join(distDir, "index.html"), "<h1>fallback</h1>")
        )
        yield* Effect.tryPromise(() =>
          fs.writeFile(path.join(distDir, "app.js"), "console.log('hi')")
        )

        const port = yield* bootServer({ releaseSha: "test-sha-static", clientDistDir: distDir })

        const asset = yield* Effect.tryPromise(() => fetch(`http://localhost:${port}/app.js`))
        expect(asset.status).toBe(200)
        expect(yield* Effect.tryPromise(() => asset.text())).toBe("console.log('hi')")

        const fallback = yield* Effect.tryPromise(() =>
          fetch(`http://localhost:${port}/some/spa/route`)
        )
        expect(fallback.status).toBe(200)
        expect(yield* Effect.tryPromise(() => fallback.text())).toBe("<h1>fallback</h1>")
      }),
    { timeout: 20_000 }
  )
})
