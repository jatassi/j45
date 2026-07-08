import { execFileSync, spawn } from "node:child_process"
import { randomUUID } from "node:crypto"
import { mkdtempSync, writeFileSync } from "node:fs"
import { createServer } from "node:net"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

import type { E2eState } from "./state.js"
import { stateFilePath } from "./state.js"

const repoRoot = fileURLToPath(new URL("../../", import.meta.url))

/**
 * Reserves a free TCP port by briefly binding to port 0, then releasing it
 * before the real server (a separate process) binds it. Mirrors
 * `packages/server/test/server.test.ts`'s `getFreePort`.
 */
const getFreePort = (): Promise<number> =>
  new Promise((resolve, reject) => {
    const probe = createServer()
    probe.listen(0, () => {
      const address = probe.address()
      probe.close(() => {
        if (address !== null && typeof address === "object") {
          resolve(address.port)
        } else {
          reject(new Error("could not determine a free port"))
        }
      })
    })
  })

const waitForHealthz = async (port: number, timeoutMs: number): Promise<void> => {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://localhost:${port}/healthz`)
      if (response.ok) return
    } catch {
      // server not accepting connections yet — keep polling
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error(`server did not become healthy on port ${port} within ${timeoutMs}ms`)
}

/**
 * Runs once before every project (chromium + webkit share the one server
 * instance): builds the client, then boots the real server entrypoint on an
 * ephemeral port against a temp SQLite DB with a distinctive `RELEASE_SHA`
 * (proves the value the spec asserts on actually round-tripped through the
 * `ServerInfo` rpc rather than being hardcoded in the client). The base URL
 * and expected sha are published via `process.env` — set here, before
 * Playwright forks worker processes, so the spec files can read them.
 */
export default async function globalSetup(): Promise<void> {
  execFileSync("bun", ["run", "build"], { cwd: repoRoot, stdio: "inherit" })

  const port = await getFreePort()
  const releaseSha = `e2e-${randomUUID().slice(0, 12)}`
  const dbDir = mkdtempSync(path.join(tmpdir(), "j45-e2e-db-"))
  const dbPath = path.join(dbDir, "j45.sqlite")

  const server = spawn("bun", ["run", "packages/server/src/main.ts"], {
    cwd: repoRoot,
    env: {
      ...process.env,
      PORT: String(port),
      RELEASE_SHA: releaseSha,
      DB_PATH: dbPath
    },
    stdio: "ignore"
  })

  if (server.pid === undefined) {
    throw new Error("failed to start the e2e server process")
  }

  await waitForHealthz(port, 20_000)

  const state: E2eState = { pid: server.pid, port, releaseSha, dbDir }
  writeFileSync(stateFilePath, JSON.stringify(state))

  process.env.E2E_BASE_URL = `http://localhost:${port}`
  process.env.E2E_RELEASE_SHA = releaseSha
}
