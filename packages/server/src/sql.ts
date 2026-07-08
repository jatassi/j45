import { fileURLToPath } from 'node:url'

import type { PlatformError } from '@effect/platform/Error'
import * as FileSystem from '@effect/platform/FileSystem'
import * as Path from '@effect/platform/Path'
import type { MigrationError } from '@effect/sql/Migrator'
import * as Migrator from '@effect/sql/Migrator'
import * as MigratorFileSystem from '@effect/sql/Migrator/FileSystem'
import type * as SqlClient from '@effect/sql/SqlClient'
import type { SqlError } from '@effect/sql/SqlError'
import * as Config from 'effect/Config'
import type { ConfigError } from 'effect/ConfigError'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'

/**
 * Where the SQLite database file lives. Defaults to `data/j45.dev.sqlite`
 * (relative to the process's working directory); the deploy hook overrides
 * it via systemd `EnvironmentFile` (`DB_PATH=/opt/j45/data/j45.sqlite`).
 */
export const DbPathConfig: Config.Config<string> = Config.string('DB_PATH').pipe(
  Config.withDefault('data/j45.dev.sqlite'),
)

/**
 * `packages/server/migrations/` — resolved from this module's location so
 * it works regardless of the process's working directory.
 */
const migrationsDir = fileURLToPath(new URL('../migrations', import.meta.url))

/**
 * Runs every `NNNN_name.ts` migration in `packages/server/migrations/`
 * (forward-only, tracked in an `effect_sql_migrations` table) against
 * whichever `SqlClient.SqlClient` is provided. Depends only on the generic
 * `SqlClient.SqlClient` tag — never a concrete driver — so the exact same
 * layer runs against the production `bun:sqlite` driver and, in tests,
 * an in-memory `@effect/sql-sqlite-node` driver.
 */
export const MigratorLive: Layer.Layer<
  never,
  SqlError | MigrationError,
  SqlClient.SqlClient | FileSystem.FileSystem
> = Layer.effectDiscard(
  Migrator.make({})({
    loader: MigratorFileSystem.fromFileSystem(migrationsDir),
  }),
)

/**
 * The production `SqlClient.SqlClient` layer: SQLite via `bun:sqlite`
 * (`@effect/sql-sqlite-bun`), with the database file at `DbPathConfig`
 * (its parent directory is created if missing — bun:sqlite does not do
 * this itself). The one place in this package that names a concrete
 * driver — imported dynamically so this module stays loadable under Node
 * (`bun:sqlite` isn't a real module outside Bun; tests never build this
 * layer, but a static import would still fail to resolve at module-load
 * time under vitest).
 */
export const SqliteClientLive: Layer.Layer<
  SqlClient.SqlClient,
  ConfigError | PlatformError,
  FileSystem.FileSystem | Path.Path
> = Layer.unwrapEffect(
  Effect.gen(function* () {
    const filename = yield* DbPathConfig
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    yield* fs.makeDirectory(path.dirname(filename), { recursive: true })
    const { SqliteClient } = yield* Effect.promise(() => import('@effect/sql-sqlite-bun'))
    return SqliteClient.layer({ filename })
  }),
)

/**
 * The full persistence layer wired into the server entrypoint: the
 * production SQLite driver, with migrations run once at layer construction
 * (i.e. at server startup). Requires `FileSystem.FileSystem` and
 * `Path.Path` (the entrypoint provides `BunContext.layer`).
 */
export const SqlLive: Layer.Layer<
  SqlClient.SqlClient,
  SqlError | MigrationError | ConfigError | PlatformError,
  FileSystem.FileSystem | Path.Path
> = MigratorLive.pipe(Layer.provideMerge(SqliteClientLive))
