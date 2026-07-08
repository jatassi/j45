import { SqlClient } from "@effect/sql"
import * as Effect from "effect/Effect"

/**
 * The first migration, trivial by design — proves the SqlClient +
 * Migrator seam. `app_meta` is a generic key/value table for small pieces
 * of server-managed state (nothing writes to it yet).
 */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  yield* sql`CREATE TABLE app_meta (
    key TEXT PRIMARY KEY,
    value TEXT
  )`
})
