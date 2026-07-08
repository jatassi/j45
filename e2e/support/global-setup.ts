import { chromium, expect } from '@playwright/test'
import { execFileSync, spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import type { E2eProjectName, E2eState } from './state.js'
import { stateFilePath } from './state.js'

const repoRoot = fileURLToPath(new URL('../../', import.meta.url))

/**
 * The value pinned via `FIRST_RUN_INVITE` — deterministic (not random, unlike
 * `releaseSha` below) so this module's own owner-registration step, below,
 * can redeem a code it already knows rather than scraping it out of the
 * server's stdout banner (`first-run.ts`'s `FIRST_RUN_BANNER_LABEL`).
 */
const FIRST_RUN_INVITE = 'E2EFRUN01'

/** The one owner account `global-setup.ts` registers — every spec file authenticates as this user for PIN login, and mints further invites off of it. */
const OWNER_USERNAME = 'e2e-owner'
const OWNER_DISPLAY_NAME = 'E2E Owner'
const OWNER_PIN = '135790'

/** The two Playwright projects sharing the one server (`playwright.config.ts`). */
const PROJECT_NAMES: readonly E2eProjectName[] = ['chromium', 'webkit']

/** How many fresh registration invites `auth-register.spec.ts` needs per project (one per test that redeems a still-valid code). */
const REGISTER_INVITES_PER_PROJECT = 2

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
        if (address !== null && typeof address === 'object') {
          resolve(address.port)
        } else {
          reject(new Error('could not determine a free port'))
        }
      })
    })
  })

const waitForHealthz = async (port: number, timeoutMs: number): Promise<void> => {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://localhost:${port}/healthz`)
      if (response.ok) {
        return
      }
    } catch {
      // server not accepting connections yet — keep polling
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error(`server did not become healthy on port ${port} within ${timeoutMs}ms`)
}

/**
 * Registers the owner (redeeming `FIRST_RUN_INVITE`, the single-use code
 * `first-run.ts` minted at server startup) through the real `/register`
 * form, then mints `REGISTER_INVITES_PER_PROJECT` fresh registration
 * invites per Playwright project via the real "Mint invite" button
 * (`people-invites.tsx`'s owner-only `PeopleInvites` section) — the "owner
 * surface" both spec files' further registrations redeem through, so
 * neither ever touches `FIRST_RUN_INVITE` itself (already spent by the time
 * they run) or collides with the other project's codes. Runs once, in this
 * one `globalSetup` process, before Playwright forks any worker — the only
 * way to guarantee the single-use first-run code is redeemed exactly once
 * no matter how many projects/workers subsequently run specs against the
 * one shared server.
 */
const registerOwnerAndMintInvites = async (
  baseUrl: string,
): Promise<Record<E2eProjectName, readonly [string, string]>> => {
  const browser = await chromium.launch()
  try {
    const page = await browser.newPage()
    await page.goto(`${baseUrl}/register?invite=${FIRST_RUN_INVITE}`)
    await page.locator('#register-username').fill(OWNER_USERNAME)
    await page.locator('#register-display-name').fill(OWNER_DISPLAY_NAME)
    await page.locator('#register-pin').fill(OWNER_PIN)
    await page.getByRole('button', { name: 'Create account' }).click()

    await expect(page.getByTestId('enroll-passkey-prompt')).toBeVisible()
    await page.getByTestId('enroll-passkey-skip').click()

    await expect(page.getByTestId('account-screen')).toBeVisible()

    const mintedCodeLocator = page.getByTestId('minted-invite-code')
    const mintOneInvite = async (): Promise<string> => {
      const before =
        (await mintedCodeLocator.count()) > 0 ? await mintedCodeLocator.textContent() : null
      await page.getByTestId('mint-invite-button').click()
      await expect(mintedCodeLocator).not.toHaveText(before ?? '')
      const grouped = await mintedCodeLocator.textContent()
      if (grouped === null) {
        throw new Error('mint-invite-button click produced no minted-invite-code text')
      }
      // `people-invites.tsx`'s `formatCode` renders the raw code grouped as
      // `XXXX-XXXX`; undo that to recover the code `/auth/register` expects.
      return grouped.replaceAll('-', '')
    }

    const invitesByProject = {} as Record<E2eProjectName, readonly [string, string]>
    for (const projectName of PROJECT_NAMES) {
      const codes: string[] = []
      for (let i = 0; i < REGISTER_INVITES_PER_PROJECT; i++) {
        codes.push(await mintOneInvite())
      }
      const first = codes[0]
      const second = codes[1]
      if (first === undefined || second === undefined) {
        throw new Error(`expected ${REGISTER_INVITES_PER_PROJECT} invites for ${projectName}`)
      }
      invitesByProject[projectName] = [first, second]
    }

    return invitesByProject
  } finally {
    await browser.close()
  }
}

/**
 * Runs once before every project (chromium + webkit share the one server
 * instance): builds the client, then boots the real server entrypoint on an
 * ephemeral port against a temp SQLite DB with a distinctive `RELEASE_SHA`
 * (proves the value the spec asserts on actually round-tripped through the
 * `ServerInfo` rpc rather than being hardcoded in the client), a
 * `DB_PATH`-derived `APP_ORIGIN` matching that same port (the CSRF check
 * `routes.ts`'s `requireValidOrigin` enforces on every `/auth` POST — a
 * browser's automatic `Origin` header only ever matches this when it's set
 * to the port the server actually bound), and a deterministic
 * `FIRST_RUN_INVITE`. Once the server is healthy, this module itself
 * redeems that first-run invite (registering the owner) and mints each
 * project's further registration invites — see
 * `registerOwnerAndMintInvites`'s doc comment. Every value spec files need
 * — the base URL and expected sha as before, plus the auth env — is
 * published via `process.env`, set here, before Playwright forks worker
 * processes, so the spec files can read them (`state.ts`'s `readE2eEnv`).
 */
export default async function globalSetup(): Promise<void> {
  execFileSync('bun', ['run', 'build'], { cwd: repoRoot, stdio: 'inherit' })

  const port = await getFreePort()
  const releaseSha = `e2e-${randomUUID().slice(0, 12)}`
  const dbDir = mkdtempSync(path.join(tmpdir(), 'j45-e2e-db-'))
  const dbPath = path.join(dbDir, 'j45.sqlite')
  const appOrigin = `http://localhost:${port}`

  const server = spawn('bun', ['run', 'packages/server/src/main.ts'], {
    cwd: repoRoot,
    env: {
      ...process.env,
      PORT: String(port),
      RELEASE_SHA: releaseSha,
      DB_PATH: dbPath,
      APP_ORIGIN: appOrigin,
      FIRST_RUN_INVITE,
    },
    stdio: 'ignore',
  })

  if (server.pid === undefined) {
    throw new Error('failed to start the e2e server process')
  }

  await waitForHealthz(port, 20_000)

  const baseUrl = `http://localhost:${port}`
  const registerInvitesByProject = await registerOwnerAndMintInvites(baseUrl)

  const state: E2eState = {
    pid: server.pid,
    port,
    releaseSha,
    dbDir,
    appOrigin,
    firstRunInvite: FIRST_RUN_INVITE,
    owner: { username: OWNER_USERNAME, displayName: OWNER_DISPLAY_NAME, pin: OWNER_PIN },
    registerInvitesByProject,
  }
  writeFileSync(stateFilePath, JSON.stringify(state))

  process.env.E2E_BASE_URL = baseUrl
  process.env.E2E_RELEASE_SHA = releaseSha
  process.env.E2E_APP_ORIGIN = appOrigin
  process.env.E2E_FIRST_RUN_INVITE = FIRST_RUN_INVITE
  process.env.E2E_OWNER_USERNAME = OWNER_USERNAME
  process.env.E2E_OWNER_DISPLAY_NAME = OWNER_DISPLAY_NAME
  process.env.E2E_OWNER_PIN = OWNER_PIN
  process.env.E2E_REGISTER_INVITES_CHROMIUM = registerInvitesByProject.chromium.join(',')
  process.env.E2E_REGISTER_INVITES_WEBKIT = registerInvitesByProject.webkit.join(',')
}
