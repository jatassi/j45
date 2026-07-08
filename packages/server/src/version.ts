import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

interface PackageJson {
  readonly version: string
}

const packageJsonPath = fileURLToPath(new URL("../package.json", import.meta.url))
const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8")) as PackageJson

/**
 * The `@j45/server` package version, reported by `/healthz` and the
 * `ServerInfo` rpc. Read directly from `package.json` so it stays in sync
 * without a build step (Bun runs this file as TypeScript source).
 */
export const version: string = packageJson.version
