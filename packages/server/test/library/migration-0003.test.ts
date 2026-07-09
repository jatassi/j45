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
import { UserRepo } from '../../src/auth/user-repo.js'
import { seedWorkouts } from '../../src/library/seed-workouts.js'
import { WorkoutsRepo } from '../../src/library/workouts-repo.js'

/**
 * `Migrator.fromRecord` (an in-memory loader — the real migration modules,
 * statically imported, not read off disk) drives both migrators below.
 * Production (`src/sql.ts`'s `MigratorLive`) loads these same modules off
 * disk instead, via `@effect/sql/Migrator/FileSystem`'s dynamic `import()`
 * — proven equivalent in practice by `test/server.test.ts` and
 * `test/auth/rpc-serve.test.ts`/`first-run.test.ts`, which boot the real
 * production entrypoint (a genuine spawned `bun run`) through every
 * migration including this one. `fromRecord` sidesteps that dynamic loader
 * here only because it lets a fresh database be driven through *exactly*
 * 0001+0002 first — the "migrated through 0002 only" state the first
 * criterion below names — before the rest run; a plain forward-only
 * filesystem loader (used elsewhere in this suite) can't stop partway.
 */
const migrateThrough0002 = Migrator.make({})({
  loader: Migrator.fromRecord({
    '0001_app_meta': Migration0001,
    '0002_auth': Migration0002,
  }),
})

const migrateAll = Migrator.make({})({
  loader: Migrator.fromRecord({
    '0001_app_meta': Migration0001,
    '0002_auth': Migration0002,
    '0003_library': Migration0003,
  }),
})

const TestServicesLive = Layer.mergeAll(UserRepo.Default, WorkoutsRepo.Default).pipe(
  Layer.provideMerge(SqliteClient.layer({ filename: ':memory:' })),
  Layer.provideMerge(NodeContext.layer),
)

const FreshDbLive = SqliteClient.layer({ filename: ':memory:' }).pipe(
  Layer.provideMerge(NodeContext.layer),
)

describe('migration 0003_library', () => {
  it.effect(
    'creates workouts (id, owner_id, body, created_at, updated_at) and the workouts_owner_id index',
    () =>
      Effect.gen(function* () {
        yield* migrateAll
        const sql = yield* SqlClient.SqlClient

        const table = yield* sql<{ readonly sql: string }>`
          SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'workouts'
        `
        expect(table).toHaveLength(1)
        expect(table[0]?.sql).toContain('REFERENCES users(id)')

        const columns = yield* sql<{
          readonly name: string
          readonly type: string
          readonly notnull: number
          readonly pk: number
        }>`PRAGMA table_info(workouts)`
        expect(
          columns.map((column) => ({
            name: column.name,
            type: column.type,
            notnull: column.notnull,
            pk: column.pk,
          })),
        ).toStrictEqual([
          { name: 'id', type: 'TEXT', notnull: 0, pk: 1 },
          { name: 'owner_id', type: 'TEXT', notnull: 1, pk: 0 },
          { name: 'body', type: 'TEXT', notnull: 1, pk: 0 },
          { name: 'created_at', type: 'TEXT', notnull: 1, pk: 0 },
          { name: 'updated_at', type: 'TEXT', notnull: 1, pk: 0 },
        ])

        const indexes = yield* sql<{ readonly name: string }>`
          SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'workouts'
        `
        expect(indexes.map((index) => index.name)).toContain('workouts_owner_id')
      }).pipe(Effect.provide(FreshDbLive)),
  )

  it.effect(
    'migrating through 0002 only, inserting a user, then running the rest backfills that user’s library with exactly the 12 seed workouts',
    () =>
      Effect.gen(function* () {
        yield* migrateThrough0002

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

        // 0001/0002 are already recorded — only 0003 actually runs here.
        yield* migrateAll

        const workoutsRepo = yield* WorkoutsRepo
        const library = yield* workoutsRepo.listForOwner(userId)

        expect(library).toHaveLength(12)
        expect(new Set(library.map((entry) => entry.id)).size).toBe(12)
        expect(new Set(library.map((entry) => entry.workout.name))).toStrictEqual(
          new Set(seedWorkouts.map((seed) => seed.name)),
        )
      }).pipe(Effect.provide(TestServicesLive)),
  )

  it.effect('running all migrations against a zero-user database backfills no workouts', () =>
    Effect.gen(function* () {
      yield* migrateAll
      const sql = yield* SqlClient.SqlClient
      const rows = yield* sql<{ readonly id: string }>`SELECT id FROM workouts`
      expect(rows).toHaveLength(0)
    }).pipe(Effect.provide(FreshDbLive)),
  )
})
