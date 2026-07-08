import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { NodeContext } from '@effect/platform-node'
import * as Command from '@effect/platform/Command'
import * as Headers from '@effect/platform/Headers'
import { SqliteClient } from '@effect/sql-sqlite-node'
import { describe, it } from '@effect/vitest'
import { AuthMiddleware, User, type UserId, type Username } from '@j45/domain'
import * as Duration from 'effect/Duration'
import * as Effect from 'effect/Effect'
import * as Either from 'effect/Either'
import * as Layer from 'effect/Layer'
import { expect } from 'vitest'

import { AuthSessions } from '../../src/auth/auth-sessions.js'
import { SESSION_COOKIE_NAME } from '../../src/auth/cookie.js'
import { AuthMiddlewareLive } from '../../src/auth/middleware.js'
import { UserRepo } from '../../src/auth/user-repo.js'
import { MigratorLive } from '../../src/sql.js'

const serverDir = fileURLToPath(new URL('../..', import.meta.url))
const middlewareModulePath = fileURLToPath(new URL('../../src/auth/middleware.ts', import.meta.url))
const accountHandlersModulePath = fileURLToPath(
  new URL('../../src/auth/account-handlers.ts', import.meta.url),
)
const ownerHandlersModulePath = fileURLToPath(
  new URL('../../src/auth/owner-handlers.ts', import.meta.url),
)
const rpcHandlersModulePath = fileURLToPath(new URL('../../src/rpc-handlers.ts', import.meta.url))
const authSessionsModulePath = fileURLToPath(
  new URL('../../src/auth/auth-sessions.ts', import.meta.url),
)
const userRepoModulePath = fileURLToPath(new URL('../../src/auth/user-repo.ts', import.meta.url))
const invitesModulePath = fileURLToPath(new URL('../../src/auth/invites.ts', import.meta.url))
const sqlModulePath = fileURLToPath(new URL('../../src/sql.ts', import.meta.url))

/**
 * The exact `MigratorLive` layer the server entrypoint runs at startup,
 * against an in-memory `@effect/sql-sqlite-node` driver — same pattern as
 * `test/auth/schema-sessions.test.ts`.
 */
const SqlTestLive = MigratorLive.pipe(
  Layer.provideMerge(SqliteClient.layer({ filename: ':memory:' })),
  Layer.provideMerge(NodeContext.layer),
)

const AuthMiddlewareTestLive = AuthMiddlewareLive.pipe(
  Layer.provideMerge(Layer.mergeAll(AuthSessions.Default, UserRepo.Default)),
  Layer.provideMerge(SqlTestLive),
)

describe('AuthMiddlewareLive', () => {
  it.effect(
    'parses j45_session from the headers cookie, hashes it, looks up the session and its user, and provides CurrentUser — fails Unauthorized for no/unknown cookie',
    () =>
      Effect.gen(function* () {
        const ownerId = 'owner-1' as UserId
        const userRepo = yield* UserRepo
        yield* userRepo.insert({
          id: ownerId,
          username: 'owner-account' as Username,
          displayName: 'Owner Account',
          role: 'owner',
          pinHash: 'irrelevant-for-this-test',
          createdAt: '2020-01-01T00:00:00.000Z',
        })

        const authSessions = yield* AuthSessions
        const token = yield* authSessions.create(ownerId)
        const middleware = yield* AuthMiddleware
        const call = (headers: Headers.Headers) =>
          middleware({ clientId: 0, rpc: undefined as never, payload: undefined, headers })

        // No cookie header at all.
        const noCookie = yield* Effect.either(call(Headers.empty))
        expect(Either.isLeft(noCookie)).toBe(true)
        if (Either.isLeft(noCookie)) {
          expect(noCookie.left._tag).toBe('Unauthorized')
        }

        // A cookie header present, but the session token is unknown.
        const badCookie = yield* Effect.either(
          call(Headers.fromInput({ cookie: `${SESSION_COOKIE_NAME}=not-a-real-token` })),
        )
        expect(Either.isLeft(badCookie)).toBe(true)
        if (Either.isLeft(badCookie)) {
          expect(badCookie.left._tag).toBe('Unauthorized')
        }

        // The real, unexpired session token — CurrentUser resolves to its owner.
        const goodCookie = yield* Effect.either(
          call(Headers.fromInput({ cookie: `${SESSION_COOKIE_NAME}=${token}` })),
        )
        expect(Either.isRight(goodCookie)).toBe(true)
        if (Either.isRight(goodCookie)) {
          expect(goodCookie.right).toStrictEqual(
            new User({
              id: ownerId,
              username: 'owner-account' as Username,
              displayName: 'Owner Account',
              role: 'owner',
            }),
          )
        }
      }).pipe(Effect.provide(AuthMiddlewareTestLive)),
  )
})

/** Named (not inline) so `Effect.acquireRelease` below doesn't nest a callback five deep. */
const removeDirRecursive = (dir: string) =>
  Effect.promise(() => rm(dir, { recursive: true, force: true }))

/**
 * Writes `source` to a scoped temp file inside `packages/server` and runs it
 * with a genuine `bun run` — the websocket upgrade support `RpcServer.layerProtocolWebsocket`
 * needs only exists under a real Bun process (vitest's worker pool runs under
 * Node); this test-local composition's server *and* client both run inside
 * that one spawned process. Mirrors `test/server.test.ts`'s `bootServer` and
 * `test/auth/schema-sessions.test.ts`'s `runBunScript`.
 */
const runIntegrationScript = (source: string) =>
  Effect.gen(function* () {
    const tmpDir = yield* Effect.acquireRelease(
      Effect.tryPromise(() => mkdtemp(path.join(serverDir, '.tmp-middleware-'))),
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
 * The full integration script: builds the merged `J45Rpcs` (`PublicRpcs` +
 * `AccountRpcs` + `OwnerRpcs`) over a real websocket, provided with
 * `AuthMiddlewareLive`, this task's real `MeHandlerLive`/`OwnerHandlersLive`,
 * and test-local stub handlers for the `AccountRpcs` members outside this
 * task's footprint (the passkey rpcs — another task's job; needed here only
 * to type-complete `J45Rpcs` for this test's own server composition). Seeds
 * an owner and a member directly through `UserRepo`/`AuthSessions` (sharing
 * one in-memory sqlite connection with the server via `Layer.build`), then
 * drives every scenario from a real `RpcClient` connecting over a real
 * websocket, one connection per cookie header under test.
 */
const integrationScript = [
  "import { BunHttpServer } from '@effect/platform-bun'",
  "import * as HttpRouter from '@effect/platform/HttpRouter'",
  "import * as Socket from '@effect/platform/Socket'",
  "import { RpcClient, RpcSerialization, RpcServer } from '@effect/rpc'",
  "import { AccountRpcs, J45Rpcs } from '@j45/domain'",
  "import { SqliteClient } from '@effect/sql-sqlite-bun'",
  "import { BunContext } from '@effect/platform-bun'",
  "import * as Context from 'effect/Context'",
  "import * as DateTime from 'effect/DateTime'",
  "import * as Effect from 'effect/Effect'",
  "import * as Either from 'effect/Either'",
  "import * as Layer from 'effect/Layer'",
  "import * as Net from 'node:net'",
  '',
  `import { AuthMiddlewareLive } from ${JSON.stringify(middlewareModulePath)}`,
  `import { MeHandlerLive } from ${JSON.stringify(accountHandlersModulePath)}`,
  `import { OwnerHandlersLive } from ${JSON.stringify(ownerHandlersModulePath)}`,
  `import { RpcHandlersLive } from ${JSON.stringify(rpcHandlersModulePath)}`,
  `import { AuthSessions } from ${JSON.stringify(authSessionsModulePath)}`,
  `import { UserRepo } from ${JSON.stringify(userRepoModulePath)}`,
  `import { Invites } from ${JSON.stringify(invitesModulePath)}`,
  `import { MigratorLive } from ${JSON.stringify(sqlModulePath)}`,
  '',
  "const SESSION_COOKIE_NAME = 'j45_session'",
  '',
  '// Test-local stubs for the four AccountRpcs members outside this task',
  '// (the passkey rpcs, a different task) — only needed to type-complete',
  '// J45Rpcs for this test-local server composition.',
  'const PasskeyStubsLive = Layer.mergeAll(',
  "  AccountRpcs.toLayerHandler('ListPasskeys', () => Effect.succeed([])),",
  "  AccountRpcs.toLayerHandler('DeletePasskey', () => Effect.succeed(undefined)),",
  "  AccountRpcs.toLayerHandler('PasskeyEnrollStart', () => Effect.succeed({})),",
  "  AccountRpcs.toLayerHandler('PasskeyEnrollFinish', () => Effect.dieMessage('stub handler, unused by this test')),",
  ')',
  '',
  'const getFreePort = Effect.async((resume) => {',
  '  const probe = Net.createServer()',
  '  probe.listen(0, () => {',
  '    const address = probe.address()',
  '    probe.close(() => {',
  '      resume(Effect.succeed(address.port))',
  '    })',
  '  })',
  '})',
  '',
  'const DbLive = MigratorLive.pipe(',
  "  Layer.provideMerge(SqliteClient.layer({ filename: ':memory:' })),",
  '  Layer.provideMerge(BunContext.layer),',
  ')',
  '',
  'const AuthServicesLive = Layer.mergeAll(AuthSessions.Default, UserRepo.Default, Invites.Default).pipe(',
  '  Layer.provideMerge(DbLive),',
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
  'const callWithCookie = (port, cookieHeader, use) =>',
  '  Effect.gen(function* () {',
  '    const client = yield* RpcClient.make(J45Rpcs)',
  '    return yield* use(client)',
  '  }).pipe(',
  '    Effect.either,',
  '    Effect.provide(',
  '      RpcClient.layerProtocolSocket().pipe(',
  '        Layer.provide(Socket.layerWebSocket(`ws://localhost:${port}/rpc`)),',
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
  '  const port = yield* getFreePort',
  '  const authServicesContext = yield* Layer.build(AuthServicesLive)',
  '  const authSessions = Context.get(authServicesContext, AuthSessions)',
  '  const userRepo = Context.get(authServicesContext, UserRepo)',
  '',
  "  const ownerId = 'owner-1'",
  "  const memberId = 'member-1'",
  '  yield* userRepo.insert({',
  '    id: ownerId,',
  "    username: 'owner-account',",
  "    displayName: 'Owner Account',",
  "    role: 'owner',",
  "    pinHash: 'irrelevant-for-this-test',",
  "    createdAt: '2020-01-01T00:00:00.000Z',",
  '  })',
  '  yield* userRepo.insert({',
  '    id: memberId,',
  "    username: 'member-account',",
  "    displayName: 'Member Account',",
  "    role: 'member',",
  "    pinHash: 'irrelevant-for-this-test',",
  "    createdAt: '2020-01-01T00:00:00.000Z',",
  '  })',
  '  const ownerToken = yield* authSessions.create(ownerId)',
  '  const memberToken = yield* authSessions.create(memberId)',
  '',
  '  const AuthServicesProvided = Layer.succeedContext(authServicesContext)',
  '',
  "  const RpcProtocolLive = RpcServer.layerProtocolWebsocket({ path: '/rpc' }).pipe(",
  '    Layer.provide(RpcSerialization.layerNdjson),',
  '  )',
  '  const RpcLive = RpcServer.layer(J45Rpcs).pipe(',
  '    Layer.provide(RpcHandlersLive),',
  '    Layer.provide(MeHandlerLive),',
  '    Layer.provide(PasskeyStubsLive),',
  '    Layer.provide(OwnerHandlersLive),',
  '    Layer.provide(AuthMiddlewareLive),',
  '    Layer.provide(AuthServicesProvided),',
  '    Layer.provide(RpcProtocolLive),',
  '  )',
  '  const ServerLive = HttpRouter.Default.serve().pipe(',
  '    Layer.provide(RpcLive),',
  '    Layer.provide(BunHttpServer.layer({ port })),',
  '  )',
  '',
  '  yield* Layer.launch(ServerLive).pipe(Effect.forkScoped)',
  "  yield* Effect.sleep('300 millis')",
  '',
  '  const ownerCookie = `${SESSION_COOKIE_NAME}=${ownerToken}`',
  '  const memberCookie = `${SESSION_COOKIE_NAME}=${memberToken}`',
  '  const garbageCookie = `${SESSION_COOKIE_NAME}=not-a-real-token`',
  '',
  '  const meNoCookie = yield* callWithCookie(port, undefined, (client) => client.Me())',
  '  const meBadCookie = yield* callWithCookie(port, garbageCookie, (client) => client.Me())',
  '  const meOwner = yield* callWithCookie(port, ownerCookie, (client) => client.Me())',
  '',
  '  const listUsersMember = yield* callWithCookie(port, memberCookie, (client) => client.ListUsers())',
  '  const listUsersOwner = yield* callWithCookie(port, ownerCookie, (client) => client.ListUsers())',
  '  const createInviteMember = yield* callWithCookie(port, memberCookie, (client) =>',
  '    client.CreateInvite({ resetUserId: memberId }),',
  '  )',
  '  const createInviteOwner = yield* callWithCookie(port, ownerCookie, (client) =>',
  '    client.CreateInvite({ resetUserId: memberId }),',
  '  )',
  '',
  '  return {',
  '    meNoCookie: summarize(meNoCookie),',
  '    meBadCookie: summarize(meBadCookie),',
  '    meOwner: summarize(meOwner),',
  '    listUsersMemberTag: Either.isLeft(listUsersMember) ? listUsersMember.left._tag : null,',
  '    listUsersOwnerIds: Either.isRight(listUsersOwner)',
  '      ? listUsersOwner.right.map((user) => user.id).sort()',
  '      : null,',
  '    createInviteMemberTag: Either.isLeft(createInviteMember) ? createInviteMember.left._tag : null,',
  '    createInviteOwner: Either.isRight(createInviteOwner)',
  '      ? {',
  '          resetUserId: createInviteOwner.right.resetUserId,',
  '          lifetimeMillis:',
  '            DateTime.toEpochMillis(createInviteOwner.right.expiresAt) -',
  '            DateTime.toEpochMillis(createInviteOwner.right.createdAt),',
  '        }',
  '      : null,',
  '  }',
  '}).pipe(Effect.scoped)',
  '',
  'const result = await Effect.runPromise(program)',
  'console.log(JSON.stringify(result))',
  'process.exit(0)',
  '',
].join('\n')

describe('the merged J45Rpcs over a real websocket (test-local composition)', () => {
  it.scopedLive(
    'Me fails Unauthorized with no/invalid cookie and returns the logged-in User with a valid one; ListUsers/CreateInvite check role and fail Forbidden for members; CreateInvite with resetUserId mints a 24h reset code',
    () =>
      Effect.gen(function* () {
        const output = yield* runIntegrationScript(integrationScript)
        const result = JSON.parse(output.trim()) as {
          readonly meNoCookie: { readonly ok: boolean; readonly tag?: string }
          readonly meBadCookie: { readonly ok: boolean; readonly tag?: string }
          readonly meOwner: {
            readonly ok: boolean
            readonly value?: { readonly id: string; readonly role: string }
          }
          readonly listUsersMemberTag: string | null
          readonly listUsersOwnerIds: readonly string[] | null
          readonly createInviteMemberTag: string | null
          readonly createInviteOwner: {
            readonly resetUserId: string
            readonly lifetimeMillis: number
          } | null
        }

        // Criterion 6 (via criterion 2 of this task): Me over a real websocket.
        expect(result.meNoCookie).toEqual({ ok: false, tag: 'Unauthorized' })
        expect(result.meBadCookie).toEqual({ ok: false, tag: 'Unauthorized' })
        expect(result.meOwner.ok).toBe(true)
        expect(result.meOwner.value?.id).toBe('owner-1')
        expect(result.meOwner.value?.role).toBe('owner')

        // Criterion 7's rpc half: OwnerRpcs' role check, wired through
        // toLayerHandler-composed handler layers.
        expect(result.listUsersMemberTag).toBe('Forbidden')
        expect(result.listUsersOwnerIds).toEqual(['member-1', 'owner-1'])
        expect(result.createInviteMemberTag).toBe('Forbidden')

        // CreateInvite with resetUserId mints a 24h (not 7-day) reset code.
        expect(result.createInviteOwner?.resetUserId).toBe('member-1')
        const twentyFourHoursMillis = Duration.toMillis(Duration.hours(24))
        expect(result.createInviteOwner?.lifetimeMillis).toBeGreaterThan(
          twentyFourHoursMillis - 5000,
        )
        expect(result.createInviteOwner?.lifetimeMillis).toBeLessThan(twentyFourHoursMillis + 5000)
      }).pipe(Effect.provide(NodeContext.layer)),
    { timeout: 20_000 },
  )
})
