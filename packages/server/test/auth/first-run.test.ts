import { mkdtemp, rm } from 'node:fs/promises'
import { createServer } from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { NodeContext } from '@effect/platform-node'
import * as Command from '@effect/platform/Command'
import { SqliteClient } from '@effect/sql-sqlite-node'
import { describe, expect, it } from '@effect/vitest'
import type { InviteCode } from '@j45/domain'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import * as Ref from 'effect/Ref'
import * as Schedule from 'effect/Schedule'
import * as Stream from 'effect/Stream'

import { FIRST_RUN_BANNER_LABEL } from '../../src/auth/first-run.js'
import { Invites } from '../../src/auth/invites.js'

const serverDir = fileURLToPath(new URL('../..', import.meta.url))

/** Narrows an optional string without a forbidden non-null assertion. */
function assertDefined<A>(value: A | undefined, message: string): asserts value is A {
  if (value === undefined) {
    throw new Error(message)
  }
}

/** Same free-port trick `test/server.test.ts` uses. */
const getFreePort = Effect.async<number, Error>((resume) => {
  const probe = createServer()
  probe.listen(0, () => {
    const address = probe.address()
    probe.close(() => {
      if (address !== null && typeof address === 'object') {
        resume(Effect.succeed(address.port))
      } else {
        resume(Effect.fail(new Error('could not determine a free port')))
      }
    })
  })
})

const waitForHealthz = (port: number) =>
  Effect.tryPromise(() => fetch(`http://localhost:${port}/healthz`)).pipe(
    Effect.filterOrFail(
      (response) => response.status === 200,
      () => new Error('server not ready'),
    ),
    Effect.retry({ schedule: Schedule.spaced('100 millis'), times: 100 }),
  )

const removeDirRecursive = (dir: string) =>
  Effect.promise(() => rm(dir, { recursive: true, force: true }))

/**
 * Boots the real production entrypoint (`bun run src/main.ts`, the same
 * spawn pattern `test/server.test.ts`'s `bootServer` uses) against
 * `dbPath`, draining its stdout into a `Ref` via a scoped background fiber,
 * and resolves once `/healthz` reports ready. Readiness can't happen until
 * the whole `MainLive` layer graph (`SqlLive`, then `FirstRunLive`, then
 * `ServerLive`) has finished building — `Layer.mergeAll` awaits every
 * member's build effect, so by the time `/healthz` answers, `FirstRunLive`'s
 * bootstrap (mint-or-skip, then log) has already run to completion.
 * `Effect.scoped` around a call to this releases the process (see
 * `CommandExecutor`'s "the child is killed automatically when the
 * enclosing scope closes"), so two calls against the same `dbPath` model
 * two sequential startups of one server.
 */
const bootServerCapturingStdout = (options: {
  readonly dbPath: string
  readonly firstRunInvite?: string
}) =>
  Effect.gen(function* () {
    const port = yield* getFreePort
    const command = Command.make('bun', 'run', 'src/main.ts').pipe(
      Command.workingDirectory(serverDir),
      Command.env({
        PORT: String(port),
        DB_PATH: options.dbPath,
        ...(options.firstRunInvite !== undefined && { FIRST_RUN_INVITE: options.firstRunInvite }),
      }),
    )
    const childProcess = yield* Command.start(command)
    const outputRef = yield* Ref.make('')
    yield* childProcess.stdout.pipe(
      Stream.decodeText(),
      Stream.runForEach((chunk) => Ref.update(outputRef, (buffer) => buffer + chunk)),
      Effect.forkScoped,
    )
    yield* waitForHealthz(port)
    return yield* Ref.get(outputRef)
  }).pipe(Effect.provide(NodeContext.layer))

/** `Invites`, pointed at the same sqlite file a booted server just wrote to. */
const withDbInvites = (dbPath: string) =>
  Invites.Default.pipe(Layer.provideMerge(SqliteClient.layer({ filename: dbPath })))

const makeTmpDbPath = Effect.gen(function* () {
  const tmpDir = yield* Effect.acquireRelease(
    Effect.tryPromise(() => mkdtemp(path.join(serverDir, '.tmp-first-run-'))),
    removeDirRecursive,
  )
  return path.join(tmpDir, 'db.sqlite')
})

describe('FirstRunLive (wired into src/main.ts, after SqlLive)', () => {
  it.scopedLive(
    'given FIRST_RUN_INVITE unset, startup mints a random first-run invite and logs it loudly; the code is redeemable, and a restart while it is still unspent mints nothing new',
    () =>
      Effect.gen(function* () {
        const dbPath = yield* makeTmpDbPath

        const firstBootOutput = yield* Effect.scoped(bootServerCapturingStdout({ dbPath }))
        const bannerRegex = new RegExp(
          String.raw`${FIRST_RUN_BANNER_LABEL}:\s*([23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{8})`,
        )
        const match = bannerRegex.exec(firstBootOutput)
        if (match === null) {
          throw new Error(`expected a ${FIRST_RUN_BANNER_LABEL} banner, got:\n${firstBootOutput}`)
        }
        const firstCode = match[1]
        assertDefined(firstCode, 'banner regex capture group missing')
        expect(firstCode).toMatch(/^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{8}$/)

        // Restarting before the invite is ever redeemed must not mint a
        // second one — the DB still has an unspent registration invite.
        const secondBootOutput = yield* Effect.scoped(bootServerCapturingStdout({ dbPath }))
        expect(secondBootOutput).not.toContain(FIRST_RUN_BANNER_LABEL)

        // The code the first boot minted is still genuinely redeemable —
        // proving the restart left it untouched.
        const remainingAfterRedeem = yield* Effect.gen(function* () {
          const invites = yield* Invites
          yield* invites.redeemForRegistration(firstCode as InviteCode)
          return yield* invites.list()
        }).pipe(Effect.provide(withDbInvites(dbPath)))
        expect(remainingAfterRedeem).toHaveLength(0)
      }),
    { timeout: 30_000 },
  )

  it.scopedLive(
    'given FIRST_RUN_INVITE set, startup mints and logs exactly that code, and it is redeemable',
    () =>
      Effect.gen(function* () {
        const dbPath = yield* makeTmpDbPath
        const pinnedCode = 'PINNED-FIRST-RUN-CODE'

        const bootOutput = yield* Effect.scoped(
          bootServerCapturingStdout({ dbPath, firstRunInvite: pinnedCode }),
        )
        expect(bootOutput).toContain(`${FIRST_RUN_BANNER_LABEL}: ${pinnedCode}`)

        const remainingAfterRedeem = yield* Effect.gen(function* () {
          const invites = yield* Invites
          yield* invites.redeemForRegistration(pinnedCode as InviteCode)
          return yield* invites.list()
        }).pipe(Effect.provide(withDbInvites(dbPath)))
        expect(remainingAfterRedeem).toHaveLength(0)
      }),
    { timeout: 30_000 },
  )
})
