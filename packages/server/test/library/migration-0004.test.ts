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
import { UserRepo } from '../../src/auth/user-repo.js'
import { ExercisesRepo } from '../../src/library/exercises-repo.js'
import { seedExercises } from '../../src/library/seed-exercises.js'

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
 * 0001+0002+0003 first — the "migrated through 0003 only" state the first
 * criterion below names — before the rest run; a plain forward-only
 * filesystem loader (used elsewhere in this suite) can't stop partway.
 */
const migrateThrough0003 = Migrator.make({})({
  loader: Migrator.fromRecord({
    '0001_app_meta': Migration0001,
    '0002_auth': Migration0002,
    '0003_library': Migration0003,
  }),
})

const migrateAll = Migrator.make({})({
  loader: Migrator.fromRecord({
    '0001_app_meta': Migration0001,
    '0002_auth': Migration0002,
    '0003_library': Migration0003,
    '0004_exercises': Migration0004,
  }),
})

const TestServicesLive = Layer.mergeAll(UserRepo.Default, ExercisesRepo.Default).pipe(
  Layer.provideMerge(SqliteClient.layer({ filename: ':memory:' })),
  Layer.provideMerge(NodeContext.layer),
)

const FreshDbLive = SqliteClient.layer({ filename: ':memory:' }).pipe(
  Layer.provideMerge(NodeContext.layer),
)

describe('migration 0004_exercises', () => {
  it.effect(
    'creates exercises (id, owner_id, body, created_at, updated_at) and the exercises_owner_id index',
    () =>
      Effect.gen(function* () {
        yield* migrateAll
        const sql = yield* SqlClient.SqlClient

        const table = yield* sql<{ readonly sql: string }>`
          SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'exercises'
        `
        expect(table).toHaveLength(1)
        expect(table[0]?.sql).toContain('REFERENCES users(id)')

        const columns = yield* sql<{
          readonly name: string
          readonly type: string
          readonly notnull: number
          readonly pk: number
        }>`PRAGMA table_info(exercises)`
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
          SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'exercises'
        `
        expect(indexes.map((index) => index.name)).toContain('exercises_owner_id')
      }).pipe(Effect.provide(FreshDbLive)),
  )

  it.effect(
    'migrating through 0003 only, inserting a user, then running the rest backfills that user’s catalog with exactly seedExercises',
    () =>
      Effect.gen(function* () {
        yield* migrateThrough0003

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

        // 0001/0002/0003 are already recorded — only 0004 actually runs here.
        yield* migrateAll

        const exercisesRepo = yield* ExercisesRepo
        const library = yield* exercisesRepo.listForOwner(userId)

        expect(library).toHaveLength(seedExercises.length)
        expect(new Set(library.map((entry) => entry.id)).size).toBe(seedExercises.length)
        expect(new Set(library.map((entry) => entry.exercise.name))).toStrictEqual(
          new Set(seedExercises.map((seed) => seed.name)),
        )
      }).pipe(Effect.provide(TestServicesLive)),
  )

  it.effect('running all migrations against a zero-user database backfills no exercises', () =>
    Effect.gen(function* () {
      yield* migrateAll
      const sql = yield* SqlClient.SqlClient
      const rows = yield* sql<{ readonly id: string }>`SELECT id FROM exercises`
      expect(rows).toHaveLength(0)
    }).pipe(Effect.provide(FreshDbLive)),
  )
})
