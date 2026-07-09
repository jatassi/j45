import { tmpdir } from 'node:os'
import path from 'node:path'

/**
 * Where `global-setup.ts` records the running server's pid + temp DB
 * directory so `global-teardown.ts` (a separate module invocation) can find
 * and clean them up. A file rather than shared module state because
 * Playwright loads `globalSetup` and `globalTeardown` independently.
 */
export const stateFilePath: string = path.join(tmpdir(), 'j45-e2e-state.json')

/**
 * The two Playwright projects (`playwright.config.ts`) that share the one
 * server `global-setup.ts` boots — and, with it, the one single-use
 * first-run invite. Each project gets its own pre-minted registration
 * invites (see `registerInvitesByProject`, `libraryInvitesByProject`, and
 * `exercisesInvitesByProject`) so the auth-register, library, and exercises
 * specs never redeem the same code twice across the two projects.
 */
export type E2eProjectName = 'chromium' | 'webkit'

export type E2eState = {
  readonly pid: number
  readonly port: number
  readonly releaseSha: string
  readonly dbDir: string
  /** `http://localhost:<port>` — threaded into the server as `APP_ORIGIN`. */
  readonly appOrigin: string
  /** The value pinned via `FIRST_RUN_INVITE`, already redeemed by `global-setup.ts` itself. */
  readonly firstRunInvite: string
  readonly owner: {
    readonly username: string
    readonly displayName: string
    readonly pin: string
  }
  /**
   * Two fresh, unspent registration invites per project, minted through the
   * owner's real "Mint invite" UI (`people-invites.tsx`) once `global-setup.ts`
   * has registered the owner — see that module's doc comment for why this
   * lives in `global-setup.ts` rather than either spec file.
   */
  readonly registerInvitesByProject: Record<E2eProjectName, readonly [string, string]>
  /**
   * A second, independent pair of fresh invites per project — `library.spec.ts`'s
   * own per-project accounts (one per test in that file), kept out of
   * `registerInvitesByProject`'s pool so the two spec files never race for
   * the same codes. Minted the same way, in the same `global-setup.ts` pass.
   */
  readonly libraryInvitesByProject: Record<E2eProjectName, readonly [string, string]>
  /**
   * A third, independent pair of fresh invites per project — `timer.spec.ts`'s
   * own per-project accounts (one per test in that file), kept out of the
   * other two pools so the spec files never race for the same codes.
   * Minted the same way, in the same `global-setup.ts` pass.
   */
  readonly timerInvitesByProject: Record<E2eProjectName, readonly [string, string]>
  /**
   * A fourth, independent pair of fresh invites per project —
   * `plan-editing.spec.ts`'s own per-project accounts (one per test in that
   * file), kept out of the other pools so the spec files never race for the
   * same codes. Minted the same way, in the same `global-setup.ts` pass.
   */
  readonly planEditingInvitesByProject: Record<E2eProjectName, readonly [string, string]>
  /**
   * A fifth, independent invite per project — `exercises.spec.ts`'s own
   * per-project account (one registration in that file), kept out of the
   * other pools so no spec ever races another for the same code. Minted the
   * same way, in the same `global-setup.ts` pass.
   */
  readonly exercisesInvitesByProject: Record<E2eProjectName, string>
}

/**
 * What `global-setup.ts` publishes via `process.env` for the spec files to
 * read (a separate worker process per test, so `process.env` — not shared
 * module state — is the actual transport; this type/reader just centralizes
 * the parsing both spec files would otherwise duplicate). Throws with a
 * clear message if any variable is missing, the same "did global-setup.ts
 * run?" posture `server-info.spec.ts` already uses for `E2E_BASE_URL`.
 */
export type E2eEnv = {
  readonly baseUrl: string
  readonly releaseSha: string
  readonly appOrigin: string
  readonly firstRunInvite: string
  readonly owner: {
    readonly username: string
    readonly displayName: string
    readonly pin: string
  }
  readonly registerInvitesByProject: Record<E2eProjectName, readonly [string, string]>
  readonly libraryInvitesByProject: Record<E2eProjectName, readonly [string, string]>
  readonly timerInvitesByProject: Record<E2eProjectName, readonly [string, string]>
  readonly planEditingInvitesByProject: Record<E2eProjectName, readonly [string, string]>
  readonly exercisesInvitesByProject: Record<E2eProjectName, string>
}

const requireEnv = (name: string): string => {
  const value = process.env[name]
  if (value === undefined || value === '') {
    throw new Error(`${name} is unset — did global-setup.ts run?`)
  }
  return value
}

const parseInvitePair = (name: string): readonly [string, string] => {
  const raw = requireEnv(name)
  const codes = raw.split(',')
  const first = codes[0]
  const second = codes[1]
  if (codes.length !== 2 || first === undefined || second === undefined) {
    throw new Error(`${name} must be exactly two comma-separated invite codes, got: ${raw}`)
  }
  return [first, second]
}

/** Reads and validates every `E2eEnv` field `global-setup.ts` publishes. */
export function readE2eEnv(): E2eEnv {
  return {
    baseUrl: requireEnv('E2E_BASE_URL'),
    releaseSha: requireEnv('E2E_RELEASE_SHA'),
    appOrigin: requireEnv('E2E_APP_ORIGIN'),
    firstRunInvite: requireEnv('E2E_FIRST_RUN_INVITE'),
    owner: {
      username: requireEnv('E2E_OWNER_USERNAME'),
      displayName: requireEnv('E2E_OWNER_DISPLAY_NAME'),
      pin: requireEnv('E2E_OWNER_PIN'),
    },
    registerInvitesByProject: {
      chromium: parseInvitePair('E2E_REGISTER_INVITES_CHROMIUM'),
      webkit: parseInvitePair('E2E_REGISTER_INVITES_WEBKIT'),
    },
    libraryInvitesByProject: {
      chromium: parseInvitePair('E2E_LIBRARY_INVITES_CHROMIUM'),
      webkit: parseInvitePair('E2E_LIBRARY_INVITES_WEBKIT'),
    },
    timerInvitesByProject: {
      chromium: parseInvitePair('E2E_TIMER_INVITES_CHROMIUM'),
      webkit: parseInvitePair('E2E_TIMER_INVITES_WEBKIT'),
    },
    planEditingInvitesByProject: {
      chromium: parseInvitePair('E2E_PLAN_EDITING_INVITES_CHROMIUM'),
      webkit: parseInvitePair('E2E_PLAN_EDITING_INVITES_WEBKIT'),
    },
    exercisesInvitesByProject: {
      chromium: requireEnv('E2E_EXERCISES_INVITES_CHROMIUM'),
      webkit: requireEnv('E2E_EXERCISES_INVITES_WEBKIT'),
    },
  }
}
