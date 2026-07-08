import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { NodeContext } from '@effect/platform-node'
import * as Command from '@effect/platform/Command'
import { describe, it } from '@effect/vitest'
import * as Effect from 'effect/Effect'
import * as Schedule from 'effect/Schedule'
import { expect } from 'vitest'

const serverDir = fileURLToPath(new URL('../..', import.meta.url))
const userRepoModulePath = fileURLToPath(new URL('../../src/auth/user-repo.ts', import.meta.url))
const authSessionsModulePath = fileURLToPath(
  new URL('../../src/auth/auth-sessions.ts', import.meta.url),
)

/**
 * Reserves a free TCP port by briefly binding to port 0, then releasing it
 * before the real server (a separate process) binds it. Mirrors
 * `test/server.test.ts`'s `getFreePort`.
 */
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

/** Named (not inline) so `Effect.acquireRelease` below doesn't nest a callback five deep. */
const removeDirRecursive = (dir: string) =>
  Effect.promise(() => rm(dir, { recursive: true, force: true }))

/**
 * Spawns the real production entrypoint (`bun run src/main.ts`) on a free
 * port, pointed at `dbPath` (a scratch sqlite file, so this test's fixture
 * data never touches the dev database and each run starts from an empty
 * schema). Exactly `test/server.test.ts`'s `bootServer`, plus `DB_PATH`.
 */
const bootServer = (options: { readonly releaseSha: string; readonly dbPath: string }) =>
  Effect.gen(function* () {
    const port = yield* getFreePort
    const command = Command.make('bun', 'run', 'src/main.ts').pipe(
      Command.workingDirectory(serverDir),
      Command.env({
        PORT: String(port),
        RELEASE_SHA: options.releaseSha,
        DB_PATH: options.dbPath,
      }),
    )
    yield* Command.start(command)
    yield* waitForHealthz(port)
    return port
  }).pipe(Effect.provide(NodeContext.layer))

/**
 * Writes `source` to a scoped temp file inside `packages/server` (so its
 * bare-specifier imports resolve against this package's `node_modules`) and
 * runs it with a genuine `bun run` — mirrors `test/auth/schema-sessions.test.ts`'s
 * `runBunScript` and `test/auth/middleware.test.ts`'s `runIntegrationScript`.
 */
const runProbeScript = (source: string) =>
  Effect.gen(function* () {
    const tmpDir = yield* Effect.acquireRelease(
      Effect.tryPromise(() => mkdtemp(path.join(serverDir, '.tmp-rpc-serve-'))),
      removeDirRecursive,
    )
    const scriptPath = path.join(tmpDir, 'probe.ts')
    yield* Effect.tryPromise(() => writeFile(scriptPath, source))
    return yield* Command.make('bun', 'run', scriptPath).pipe(
      Command.workingDirectory(serverDir),
      Command.string,
    )
  })

/**
 * The client-side probe: seeds one user directly through `UserRepo`/
 * `AuthSessions` against the *same* sqlite file the just-booted production
 * server (`bootServer`, above) is already serving from — mirroring how a
 * real registration/login would populate a session, without needing the
 * full webauthn ceremony this task's footprint doesn't own. Then drives
 * three real websocket rpc calls against the running server: `ServerInfo`
 * with no cookie at all, `Me` with no cookie, and `Me` with the seeded
 * session's cookie — the exact three scenarios this task's criterion 2
 * names. Bun's global `WebSocket` accepts a `headers` option (a documented
 * Bun extension, not standard) — the only way to attach `Cookie` to a
 * websocket upgrade request client-side; this script runs under a genuine
 * `bun run` (not vitest's Node worker pool) so that constructor is
 * available. One connection per call, exactly `middleware.test.ts`'s
 * pattern.
 */
const probeScript = (dbPath: string, port: number) =>
  [
    "import { SqliteClient } from '@effect/sql-sqlite-bun'",
    "import { RpcClient, RpcSerialization } from '@effect/rpc'",
    "import * as Socket from '@effect/platform/Socket'",
    "import { J45Rpcs } from '@j45/domain'",
    "import * as Effect from 'effect/Effect'",
    "import * as Either from 'effect/Either'",
    "import * as Layer from 'effect/Layer'",
    '',
    `import { UserRepo } from ${JSON.stringify(userRepoModulePath)}`,
    `import { AuthSessions } from ${JSON.stringify(authSessionsModulePath)}`,
    '',
    "const SESSION_COOKIE_NAME = 'j45_session'",
    `const DB_PATH = ${JSON.stringify(dbPath)}`,
    `const PORT = ${port}`,
    '',
    'const SeedLive = Layer.mergeAll(UserRepo.Default, AuthSessions.Default).pipe(',
    '  Layer.provideMerge(SqliteClient.layer({ filename: DB_PATH })),',
    ')',
    '',
    'const wsConstructorFor = (cookieHeader) =>',
    '  Layer.succeed(',
    '    Socket.WebSocketConstructor,',
    '    (url) =>',
    '      new WebSocket(',
    '        url,',
    '        cookieHeader === undefined ? undefined : { headers: { Cookie: cookieHeader } },',
    '      ),',
    '  )',
    '',
    'const callWithCookie = (cookieHeader, use) =>',
    '  Effect.gen(function* () {',
    '    const client = yield* RpcClient.make(J45Rpcs)',
    '    return yield* use(client)',
    '  }).pipe(',
    '    Effect.either,',
    '    Effect.provide(',
    '      RpcClient.layerProtocolSocket().pipe(',
    '        Layer.provide(Socket.layerWebSocket(`ws://localhost:${PORT}/rpc`)),',
    '        Layer.provide(wsConstructorFor(cookieHeader)),',
    '        Layer.provide(RpcSerialization.layerNdjson),',
    '      ),',
    '    ),',
    '    Effect.scoped,',
    '  )',
    '',
    'const summarize = (either) =>',
    '  Either.isLeft(either) ? { ok: false, tag: either.left._tag } : { ok: true, value: either.right }',
    '',
    'const program = Effect.gen(function* () {',
    '  const userRepo = yield* UserRepo',
    '  const authSessions = yield* AuthSessions',
    '',
    "  const userId = 'rpc-serve-user-1'",
    '  yield* userRepo.insert({',
    '    id: userId,',
    "    username: 'rpc-serve-user',",
    "    displayName: 'Rpc Serve User',",
    "    role: 'member',",
    "    pinHash: 'irrelevant-for-this-test',",
    "    createdAt: '2020-01-01T00:00:00.000Z',",
    '  })',
    '  const token = yield* authSessions.create(userId)',
    '  const cookie = `${SESSION_COOKIE_NAME}=${token}`',
    '',
    '  const serverInfoNoCookie = yield* callWithCookie(undefined, (client) => client.ServerInfo())',
    '  const meNoCookie = yield* callWithCookie(undefined, (client) => client.Me())',
    '  const meWithCookie = yield* callWithCookie(cookie, (client) => client.Me())',
    '',
    '  return {',
    '    serverInfoNoCookie: summarize(serverInfoNoCookie),',
    '    meNoCookie: summarize(meNoCookie),',
    '    meWithCookie: summarize(meWithCookie),',
    '  }',
    '}).pipe(Effect.provide(SeedLive))',
    '',
    'const result = await Effect.runPromise(program)',
    'console.log(JSON.stringify(result))',
    'process.exit(0)',
    '',
  ].join('\n')

describe('the production ServerLive composition (server.ts, spawned via main.ts)', () => {
  it.scopedLive(
    'serves the full J45Rpcs merge at /rpc: ServerInfo succeeds with no auth, Me fails Unauthorized with no cookie, and Me returns the logged-in user when the websocket upgrade carries a valid session cookie',
    () =>
      Effect.gen(function* () {
        const dbDir = yield* Effect.acquireRelease(
          Effect.tryPromise(() => mkdtemp(path.join(serverDir, '.tmp-rpc-serve-db-'))),
          removeDirRecursive,
        )
        const dbPath = path.join(dbDir, 'rpc-serve.sqlite')

        const port = yield* bootServer({ releaseSha: 'test-sha-rpc-serve', dbPath })

        const output = yield* runProbeScript(probeScript(dbPath, port))
        const result = JSON.parse(output.trim()) as {
          readonly serverInfoNoCookie: { readonly ok: boolean; readonly tag?: string }
          readonly meNoCookie: { readonly ok: boolean; readonly tag?: string }
          readonly meWithCookie: {
            readonly ok: boolean
            readonly value?: { readonly id: string; readonly role: string }
          }
        }

        expect(result.serverInfoNoCookie.ok).toBe(true)

        expect(result.meNoCookie).toEqual({ ok: false, tag: 'Unauthorized' })

        expect(result.meWithCookie.ok).toBe(true)
        expect(result.meWithCookie.value?.id).toBe('rpc-serve-user-1')
        expect(result.meWithCookie.value?.role).toBe('member')
      }).pipe(Effect.provide(NodeContext.layer)),
    { timeout: 20_000 },
  )
})
