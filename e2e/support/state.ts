import { tmpdir } from "node:os"
import path from "node:path"

/**
 * Where `global-setup.ts` records the running server's pid + temp DB
 * directory so `global-teardown.ts` (a separate module invocation) can find
 * and clean them up. A file rather than shared module state because
 * Playwright loads `globalSetup` and `globalTeardown` independently.
 */
export const stateFilePath: string = path.join(tmpdir(), "j45-e2e-state.json")

export interface E2eState {
  readonly pid: number
  readonly port: number
  readonly releaseSha: string
  readonly dbDir: string
}
