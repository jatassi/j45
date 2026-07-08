import { createHash } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { NodeContext } from '@effect/platform-node'
import * as Command from '@effect/platform/Command'
import { SqlClient } from '@effect/sql'
import { SqliteClient } from '@effect/sql-sqlite-node'
import { describe, expect, it } from '@effect/vitest'
import type { UserId, Username } from '@j45/domain'
import * as ConfigProvider from 'effect/ConfigProvider'
import * as Duration from 'effect/Duration'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import * as Option from 'effect/Option'
import * as TestClock from 'effect/TestClock'

import { AuthSessions } from '../../src/auth/auth-sessions.js'
import { SESSION_COOKIE_NAME, sessionClearCookie, sessionSetCookie } from '../../src/auth/cookie.js'
import { UserRepo } from '../../src/auth/user-repo.js'
import { AppOriginConfig, FirstRunInviteConfig } from '../../src/config.js'
import { MigratorLive } from '../../src/sql.js'

const serverDir = fileURLToPath(new URL('../..', import.meta.url))
const hashingModulePath = fileURLToPath(new URL('../../src/auth/hashing.ts', import.meta.url))
const userRepoModulePath = fileURLToPath(new URL('../../src/auth/user-repo.ts', import.meta.url))
const authSessionsModulePath = fileURLToPath(
  new URL('../../src/auth/auth-sessions.ts', import.meta.url),
)
const sqlModulePath = fileURLToPath(new URL('../../src/sql.ts', import.meta.url))

/** Named (not inline) so `Effect.acquireRelease` below doesn't nest a callback five deep. */
const removeDirRecursive = (dir: string) =>
  Effect.promise(() => rm(dir, { recursive: true, force: true }))

/**
 * Writes `source` to a scoped temp file inside `packages/server` (so its
 * bare-specifier imports like `'effect/Effect'` resolve against this
 * package's `node_modules`) and runs it with a genuine `bun run` — the
 * only way to exercise code that touches the `Bun` global (`Bun.password`)
 * from vitest's Node-based worker pool. Mirrors `test/server.test.ts`'s
 * `bootServer`, which spawns the production entrypoint the same way.
 */
const runBunScript = (source: string) =>
  Effect.gen(function* () {
    const tmpDir = yield* Effect.acquireRelease(
      Effect.tryPromise(() => mkdtemp(path.join(serverDir, '.tmp-schema-sessions-'))),
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
 * The exact `MigratorLive` layer the server entrypoint runs at startup,
 * against an in-memory `@effect/sql-sqlite-node` driver — same pattern as
 * `test/sql.test.ts`.
 */
const SqlTestLive = MigratorLive.pipe(
  Layer.provideMerge(SqliteClient.layer({ filename: ':memory:' })),
  Layer.provideMerge(NodeContext.layer),
)

const AuthTestLive = Layer.mergeAll(AuthSessions.Default, UserRepo.Default).pipe(
  Layer.provideMerge(SqlTestLive),
)

/**
 * `auth_sessions.user_id REFERENCES users(id)` is enforced (the sqlite
 * driver has foreign keys on by default) — every test that creates a
 * session needs a real user row to attach it to.
 */
const insertTestUser = (userId: UserId) =>
  Effect.gen(function* () {
    const userRepo = yield* UserRepo
    yield* userRepo.insert({
      id: userId,
      username: `user-${userId}` as Username,
      displayName: 'Test User',
      role: 'owner',
      pinHash: 'irrelevant-for-this-test',
      createdAt: '2020-01-01T00:00:00.000Z',
    })
  })

describe('migration 0002_auth', () => {
  it.effect('creates users, invites, passkey_credentials, and auth_sessions', () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient

      const tables = yield* sql<{ readonly name: string }>`
        SELECT name FROM sqlite_master
        WHERE type = 'table' AND name IN ('users', 'invites', 'passkey_credentials', 'auth_sessions')
        ORDER BY name
      `

      expect(tables.map((table) => table.name)).toEqual([
        'auth_sessions',
        'invites',
        'passkey_credentials',
        'users',
      ])
    }).pipe(Effect.provide(SqlTestLive)),
  )

  it.effect('users.username is UNIQUE COLLATE NOCASE and users.role is CHECK owner|member', () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const insertUser = (id: string, username: string, role: string) =>
        sql`INSERT INTO users ${sql.insert({
          id,
          username,
          display_name: 'Test User',
          role,
          pin_hash: 'irrelevant-for-this-test',
          created_at: '2020-01-01T00:00:00.000Z',
        })}`

      yield* insertUser('user-1', 'Alice', 'owner')

      // COLLATE NOCASE: a different-case username collides on the UNIQUE index.
      const caseCollision = yield* Effect.exit(insertUser('user-2', 'alice', 'member'))
      expect(caseCollision._tag).toBe('Failure')

      // CHECK (role IN ('owner', 'member')): any other value is rejected.
      const badRole = yield* Effect.exit(insertUser('user-3', 'bob', 'admin'))
      expect(badRole._tag).toBe('Failure')
    }).pipe(Effect.provide(SqlTestLive)),
  )
})

describe('AuthSessions', () => {
  it.effect(
    'create stores only the token’s SHA-256; lookupAndTouch rejects expired rows; revoke/delete remove rows',
    () =>
      Effect.gen(function* () {
        const authSessions = yield* AuthSessions
        const sql = yield* SqlClient.SqlClient
        const userId = 'user-1' as UserId
        yield* insertTestUser(userId)

        const token = yield* authSessions.create(userId)

        const rows = yield* sql<{ readonly token_hash: string; readonly user_id: string }>`
          SELECT token_hash, user_id FROM auth_sessions
        `
        expect(rows).toHaveLength(1)
        // Criterion 9: the row never stores the raw cookie value...
        expect(rows[0]?.token_hash).not.toBe(token)
        // ...only its SHA-256.
        expect(rows[0]?.token_hash).toBe(createHash('sha256').update(token).digest('hex'))
        expect(rows[0]?.user_id).toBe(userId)

        // Valid immediately after creation.
        const foundBeforeExpiry = yield* authSessions.lookupAndTouch(token)
        expect(Option.isSome(foundBeforeExpiry)).toBe(true)

        // TestClock-driven expiry: past the 365-day lifetime, the row is
        // rejected even though it still physically exists.
        yield* TestClock.adjust(Duration.days(366))
        const foundAfterExpiry = yield* authSessions.lookupAndTouch(token)
        expect(Option.isNone(foundAfterExpiry)).toBe(true)

        const rowsStillPresent = yield* sql`SELECT * FROM auth_sessions`
        expect(rowsStillPresent).toHaveLength(1)

        yield* authSessions.revokeAllForUser(userId)
        const rowsAfterRevoke = yield* sql`SELECT * FROM auth_sessions`
        expect(rowsAfterRevoke).toHaveLength(0)

        const secondToken = yield* authSessions.create(userId)
        yield* authSessions.delete(secondToken)
        const rowsAfterDelete = yield* sql`SELECT * FROM auth_sessions`
        expect(rowsAfterDelete).toHaveLength(0)
      }).pipe(Effect.provide(AuthTestLive)),
  )
})

describe('PIN hashing', () => {
  /**
   * `PinHashingLive` calls `Bun.password`, which only exists inside a
   * genuine Bun process (vitest's worker pool runs under Node — see
   * `test/server.test.ts`'s `bootServer` comment for the same split). This
   * spawns a real `bun run` process, the same way `server.test.ts` spawns
   * the production entrypoint, to exercise the live layer where the
   * runtime allows.
   */
  const pinHashingProbeScript = [
    `import { PinHashing, PinHashingLive } from ${JSON.stringify(hashingModulePath)}`,
    "import * as Effect from 'effect/Effect'",
    '',
    'const program = Effect.gen(function* () {',
    '  const hashing = yield* PinHashing',
    "  const hash = yield* hashing.hash('1234')",
    "  const verifiedCorrect = yield* hashing.verify('1234', hash)",
    "  const verifiedWrong = yield* hashing.verify('9999', hash)",
    '  return { hash, verifiedCorrect, verifiedWrong }',
    '})',
    '',
    'const result = await Effect.runPromise(program.pipe(Effect.provide(PinHashingLive)))',
    'console.log(JSON.stringify(result))',
    '',
  ].join('\n')

  it.scopedLive(
    'the stored hash is never the plaintext PIN and matches the argon2id format',
    () =>
      Effect.gen(function* () {
        const output = yield* runBunScript(pinHashingProbeScript)
        const result = JSON.parse(output.trim()) as {
          readonly hash: string
          readonly verifiedCorrect: boolean
          readonly verifiedWrong: boolean
        }

        expect(result.hash).not.toBe('1234')
        expect(result.hash).toMatch(/^\$argon2id\$/)
        expect(result.verifiedCorrect).toBe(true)
        expect(result.verifiedWrong).toBe(false)
      }).pipe(Effect.provide(NodeContext.layer)),
    { timeout: 20_000 },
  )
})

describe('cookie helper', () => {
  it('renders HttpOnly, SameSite=Lax, Path=/, Max-Age=31536000, and Secure for an https APP_ORIGIN', () => {
    const setCookie = sessionSetCookie('raw-token-value', 'https://j45.atassi.org')
    expect(setCookie).toBe(
      `${SESSION_COOKIE_NAME}=raw-token-value; HttpOnly; SameSite=Lax; Path=/; Max-Age=31536000; Secure`,
    )

    const clearCookie = sessionClearCookie('https://j45.atassi.org')
    expect(clearCookie).toBe(
      `${SESSION_COOKIE_NAME}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0; Secure`,
    )
  })

  it('omits Secure for an http APP_ORIGIN (dev)', () => {
    const setCookie = sessionSetCookie('raw-token-value', 'http://localhost:5173')
    expect(setCookie).toBe(
      `${SESSION_COOKIE_NAME}=raw-token-value; HttpOnly; SameSite=Lax; Path=/; Max-Age=31536000`,
    )
    expect(setCookie).not.toContain('Secure')

    const clearCookie = sessionClearCookie('http://localhost:5173')
    expect(clearCookie).toBe(`${SESSION_COOKIE_NAME}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`)
    expect(clearCookie).not.toContain('Secure')
  })
})

describe('config', () => {
  it.effect(
    'AppOriginConfig defaults to the Vite dev origin; FirstRunInviteConfig defaults to None',
    () =>
      Effect.gen(function* () {
        const appOrigin = yield* AppOriginConfig
        const firstRunInvite = yield* FirstRunInviteConfig
        expect(appOrigin).toBe('http://localhost:5173')
        expect(Option.isNone(firstRunInvite)).toBe(true)
      }).pipe(Effect.withConfigProvider(ConfigProvider.fromMap(new Map()))),
  )

  it.effect(
    'AppOriginConfig and FirstRunInviteConfig read APP_ORIGIN/FIRST_RUN_INVITE when set',
    () =>
      Effect.gen(function* () {
        const appOrigin = yield* AppOriginConfig
        const firstRunInvite = yield* FirstRunInviteConfig
        expect(appOrigin).toBe('https://j45.atassi.org')
        expect(Option.getOrNull(firstRunInvite)).toBe('ABCD-1234')
      }).pipe(
        Effect.withConfigProvider(
          ConfigProvider.fromMap(
            new Map([
              ['APP_ORIGIN', 'https://j45.atassi.org'],
              ['FIRST_RUN_INVITE', 'ABCD-1234'],
            ]),
          ),
        ),
      ),
  )
})

describe('users.pin_hash and auth_sessions.token_hash storage', () => {
  /**
   * The end-to-end version of both storage properties together, through
   * the real `Bun.password`-backed `PinHashingLive` (see the "PIN hashing"
   * describe block above for why this needs a spawned `bun run`): a PIN
   * hashed by `PinHashing` and inserted via `UserRepo` lands in
   * `users.pin_hash` as an argon2id hash, never the plaintext PIN; a
   * session token minted by `AuthSessions.create` lands in
   * `auth_sessions.token_hash` as its SHA-256, never the raw token.
   */
  const storageProbeScript = [
    `import { PinHashing, PinHashingLive } from ${JSON.stringify(hashingModulePath)}`,
    `import { UserRepo } from ${JSON.stringify(userRepoModulePath)}`,
    `import { AuthSessions } from ${JSON.stringify(authSessionsModulePath)}`,
    `import { MigratorLive } from ${JSON.stringify(sqlModulePath)}`,
    "import { BunContext } from '@effect/platform-bun'",
    "import { SqlClient } from '@effect/sql'",
    "import { SqliteClient } from '@effect/sql-sqlite-bun'",
    "import * as Effect from 'effect/Effect'",
    "import * as Layer from 'effect/Layer'",
    '',
    '// `@effect/sql-sqlite-node` (better-sqlite3) is a Node native addon and',
    "// doesn't load under Bun — this script runs as a genuine Bun process, so",
    '// it uses the production `bun:sqlite` driver instead (`@effect/sql-sqlite-bun`).',
    'const DbLive = MigratorLive.pipe(',
    "  Layer.provideMerge(SqliteClient.layer({ filename: ':memory:' })),",
    '  Layer.provideMerge(BunContext.layer),',
    ')',
    '',
    'const program = Effect.gen(function* () {',
    '  const hashing = yield* PinHashing',
    '  const userRepo = yield* UserRepo',
    '  const authSessions = yield* AuthSessions',
    '  const sql = yield* SqlClient.SqlClient',
    '',
    "  const plainPin = '4242'",
    '  const pinHash = yield* hashing.hash(plainPin)',
    '  yield* userRepo.insert({',
    "    id: 'user-1',",
    "    username: 'carol',",
    "    displayName: 'Carol',",
    "    role: 'owner',",
    '    pinHash,',
    "    createdAt: '2020-01-01T00:00:00.000Z',",
    '  })',
    "  const userRows = yield* sql`SELECT pin_hash FROM users WHERE id = 'user-1'`",
    '',
    "  const rawToken = yield* authSessions.create('user-1')",
    '  const sessionRows = yield* sql`SELECT token_hash FROM auth_sessions`',
    '',
    '  return {',
    '    plainPin,',
    '    storedPinHash: userRows[0].pin_hash,',
    '    rawToken,',
    '    storedTokenHash: sessionRows[0].token_hash,',
    '  }',
    '})',
    '',
    'const result = await Effect.runPromise(',
    '  program.pipe(',
    '    Effect.provide(AuthSessions.Default),',
    '    Effect.provide(UserRepo.Default),',
    '    Effect.provide(PinHashingLive),',
    '    Effect.provide(DbLive),',
    '  ),',
    ')',
    'console.log(JSON.stringify(result))',
    '',
  ].join('\n')

  it.scopedLive(
    'users.pin_hash stores a Bun.password hash (never the PIN); auth_sessions.token_hash stores only a SHA-256 (never the cookie value)',
    () =>
      Effect.gen(function* () {
        const output = yield* runBunScript(storageProbeScript)
        const result = JSON.parse(output.trim()) as {
          readonly plainPin: string
          readonly storedPinHash: string
          readonly rawToken: string
          readonly storedTokenHash: string
        }

        expect(result.storedPinHash).not.toBe(result.plainPin)
        expect(result.storedPinHash).toMatch(/^\$argon2id\$/)

        expect(result.storedTokenHash).not.toBe(result.rawToken)
        expect(result.storedTokenHash).toBe(
          createHash('sha256').update(result.rawToken).digest('hex'),
        )
      }).pipe(Effect.provide(NodeContext.layer)),
    { timeout: 20_000 },
  )
})
