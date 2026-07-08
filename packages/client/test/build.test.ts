import { execFile } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"

import { describe, expect, it } from "vitest"

const execFileAsync = promisify(execFile)

const repoRoot = path.dirname(
  path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))))
)
const distDir = path.join(repoRoot, "packages/client/dist")

describe("bun run build / bun run check", () => {
  it("build produces packages/client/dist and check still exits 0", async () => {
    fs.rmSync(distDir, { recursive: true, force: true })
    expect(fs.existsSync(distDir)).toBe(false)

    await execFileAsync("bun", ["run", "build"], { cwd: repoRoot })
    expect(fs.existsSync(path.join(distDir, "index.html"))).toBe(true)

    await expect(execFileAsync("bun", ["run", "check"], { cwd: repoRoot })).resolves.toBeDefined()
  }, 60_000)
})
