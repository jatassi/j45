import { NodeContext } from '@effect/platform-node'
import { SqlClient } from '@effect/sql'
import { SqliteClient } from '@effect/sql-sqlite-node'
import * as Migrator from '@effect/sql/Migrator'
import { describe, expect, it } from '@effect/vitest'
import type { UserId, Username } from '@j45/domain'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'

import Migration0001 from '../../migrations/0001_app_meta.js'
import Migration0002 from '../../migrations/0002_auth.js'
import Migration0003 from '../../migrations/0003_library.js'
import Migration0004 from '../../migrations/0004_exercises.js'
import Migration0005 from '../../migrations/0005_history.js'
import { UserRepo } from '../../src/auth/user-repo.js'
import { CompletionsRepo } from '../../src/session/completions-repo.js'

/**
 * `Migrator.fromRecord` (an in-memory loader — the real migration modules,
 * statically imported, not read off disk) drives both migrators below.
 * Production (`src/sql.ts`'s `MigratorLive`) loads these same modules off
 * disk instead. `fromRecord` lets a fresh database be driven through
 * *exactly* 0001–0004 first — the "migrated through 0004 only" state the
 * first criterion below names — before 0005 runs.
 */
const migrateThrough0004 = Migrator.make({})({
  loader: Migrator.fromRecord({
    '0001_app_meta': Migration0001,
    '0002_auth': Migration0002,
    '0003_library': Migration0003,
    '0004_exercises': Migration0004,
  }),
})

const migrateAll = Migrator.make({})({
  loader: Migrator.fromRecord({
    '0001_app_meta': Migration0001,
    '0002_auth': Migration0002,
    '0003_library': Migration0003,
    '0004_exercises': Migration0004,
    '0005_history': Migration0005,
  }),
})

const TestServicesLive = Layer.mergeAll(UserRepo.Default, CompletionsRepo.Default).pipe(
  Layer.provideMerge(SqliteClient.layer({ filename: ':memory:' })),
  Layer.provideMerge(NodeContext.layer),
)

const FreshDbLive = SqliteClient.layer({ filename: ':memory:' }).pipe(
  Layer.provideMerge(NodeContext.layer),
)

describe('migration 0005_history', () => {
  it.effect(
    'creates session_completions (id, user_id, ended_at, body) and the session_completions_user index',
    () =>
      Effect.gen(function* () {
        yield* migrateAll
        const sql = yield* SqlClient.SqlClient

        const table = yield* sql<{ readonly sql: string }>`
          SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'session_completions'
        `
        expect(table).toHaveLength(1)
        expect(table[0]?.sql).toContain('REFERENCES users(id)')

        const columns = yield* sql<{
          readonly name: string
          readonly type: string
          readonly notnull: number
          readonly pk: number
        }>`PRAGMA table_info(session_completions)`
        expect(
          columns.map((column) => ({
            name: column.name,
            type: column.type,
            notnull: column.notnull,
            pk: column.pk,
          })),
        ).toStrictEqual([
          { name: 'id', type: 'TEXT', notnull: 0, pk: 1 },
          { name: 'user_id', type: 'TEXT', notnull: 1, pk: 0 },
          { name: 'ended_at', type: 'TEXT', notnull: 1, pk: 0 },
          { name: 'body', type: 'TEXT', notnull: 1, pk: 0 },
        ])

        const indexes = yield* sql<{ readonly name: string }>`
          SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'session_completions'
        `
        expect(indexes.map((index) => index.name)).toContain('session_completions_user')
      }).pipe(Effect.provide(FreshDbLive)),
  )

  it.effect(
    'migrating through 0004 only, inserting a user, then running the rest leaves that user with an empty history',
    () =>
      Effect.gen(function* () {
        yield* migrateThrough0004

        const userRepo = yield* UserRepo
        const userId = 'user-1' as UserId
        yield* userRepo.insert({
          id: userId,
          username: 'preexisting' as Username,
          displayName: 'Pre-Existing User',
          role: 'owner',
          pinHash: 'irrelevant-for-this-test',
          createdAt: '2020-01-01T00:00:00.000Z',
        })

        // 0001–0004 are already recorded — only 0005 actually runs here.
        yield* migrateAll

        const completionsRepo = yield* CompletionsRepo
        const history = yield* completionsRepo.listForUser(userId)
        expect(history).toStrictEqual([])
      }).pipe(Effect.provide(TestServicesLive)),
  )

  it.effect(
    'running all migrations against a zero-user database creates no session_completions rows',
    () =>
      Effect.gen(function* () {
        yield* migrateAll
        const sql = yield* SqlClient.SqlClient
        const rows = yield* sql<{ readonly id: string }>`SELECT id FROM session_completions`
        expect(rows).toHaveLength(0)
      }).pipe(Effect.provide(FreshDbLive)),
  )
})
