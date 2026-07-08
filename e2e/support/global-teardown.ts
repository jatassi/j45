import { existsSync, readFileSync, rmSync } from "node:fs"

import type { E2eState } from "./state.js"
import { stateFilePath } from "./state.js"

/** Stops the server `global-setup.ts` started and removes its temp DB dir. */
export default async function globalTeardown(): Promise<void> {
  if (!existsSync(stateFilePath)) return

  const state = JSON.parse(readFileSync(stateFilePath, "utf8")) as E2eState

  try {
    process.kill(state.pid, "SIGTERM")
  } catch {
    // already exited
  }

  rmSync(state.dbDir, { recursive: true, force: true })
  rmSync(stateFilePath, { force: true })
}
