import { tmpdir } from "node:os"
import path from "node:path"

import { defineConfig, devices } from "@playwright/test"

/**
 * `bun run test:e2e` — chromium and webkit against the real built client
 * served by the real server. `globalSetup` builds the client, starts the
 * server on an ephemeral port with a temp SQLite DB, and publishes
 * `E2E_BASE_URL`/`E2E_RELEASE_SHA` via `process.env` for the spec files;
 * `globalTeardown` stops the server and cleans up the temp DB. Webkit is a
 * first-class project — it's the standing CI proxy for iOS Safari.
 */
export default defineConfig({
  testDir: "./e2e",
  // Keeps generated artifacts (traces, screenshots on failure) out of the
  // repo tree — the root `.gitignore` isn't in this feature's footprint, so
  // this avoids ever needing an untracked `test-results/` directory.
  outputDir: path.join(tmpdir(), "j45-playwright-results"),
  timeout: 30_000,
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  reporter: "list",
  globalSetup: "./e2e/support/global-setup.ts",
  globalTeardown: "./e2e/support/global-teardown.ts",
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } }
  ]
})
