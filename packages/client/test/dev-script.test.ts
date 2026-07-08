import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterEach, describe, expect, it } from 'vitest'

const repoRoot = path.dirname(
  path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url)))),
)

const CLIENT_URL = 'http://localhost:5173/'
const HEALTHZ_URL = 'http://localhost:3000/healthz'

async function waitFor(predicate: () => Promise<boolean>, timeoutMs: number): Promise<void> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (await predicate()) {
      return
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error(`timed out after ${timeoutMs}ms`)
}

describe('bun run dev', () => {
  let child: ReturnType<typeof spawn> | undefined

  afterEach(async () => {
    if (child?.pid) {
      process.kill(-child.pid, 'SIGTERM')
    }
    child = undefined
    // Give the OS a moment to release the port before the next test file
    // (if any) tries to bind it.
    await new Promise((resolve) => setTimeout(resolve, 200))
  })

  it('starts the workspace dev scripts and serves the client page on :5173 and /healthz on :3000', async () => {
    child = spawn('bun', ['run', 'dev'], {
      cwd: repoRoot,
      detached: true,
      stdio: 'ignore',
    })

    await waitFor(async () => {
      try {
        const response = await fetch(CLIENT_URL)
        return response.ok
      } catch {
        return false
      }
    }, 20_000)

    const response = await fetch(CLIENT_URL)
    expect(response.status).toBe(200)
    const html = await response.text()
    expect(html).toContain('<div id="root">')

    // The server half of the dev contract: the Bun server must come up on
    // :3000 alongside Vite, serving /healthz with the release SHA.
    await waitFor(async () => {
      try {
        const healthz = await fetch(HEALTHZ_URL)
        return healthz.ok
      } catch {
        return false
      }
    }, 20_000)

    const healthz = await fetch(HEALTHZ_URL)
    expect(healthz.status).toBe(200)
    const info = (await healthz.json()) as { sha?: unknown }
    expect(typeof info.sha).toBe('string')
    expect((info.sha as string).length).toBeGreaterThan(0)
  }, 50_000)
})
