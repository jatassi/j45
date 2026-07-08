import { NodeContext } from '@effect/platform-node'
import * as SqlClient from '@effect/sql/SqlClient'
import { SqliteClient } from '@effect/sql-sqlite-node'
import { describe, it } from '@effect/vitest'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { expect } from 'vitest'

import { MigratorLive } from '../src/sql.js'

/**
 * The exact `MigratorLive` layer the server entrypoint runs at startup,
 * proven here against an in-memory `@effect/sql-sqlite-node` driver instead
 * of the production `bun:sqlite` driver — `MigratorLive` depends only on
 * the generic `SqlClient.SqlClient` tag, so the swap is transparent.
 */
const TestLive = MigratorLive.pipe(
  Layer.provideMerge(SqliteClient.layer({ filename: ':memory:' })),
  Layer.provideMerge(NodeContext.layer),
)

describe('sql', () => {
  it.effect('runs the 0001 migration, creating app_meta', () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient

      const tables = yield* sql<{ readonly name: string }>`
        SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'app_meta'
      `

      expect(tables).toHaveLength(1)
      expect(tables[0]?.name).toBe('app_meta')
    }).pipe(Effect.provide(TestLive)),
  )
})
