import { SqlClient } from '@effect/sql'
import * as Effect from 'effect/Effect'

/**
 * session-history's persistence — one `session_completions` table
 * (`docs/designs/session-history`). Each row is a `SessionCompletion`: the
 * body is the Schema-encoded domain object (JSON); `ended_at` is denormalized
 * as the ORDER BY column (also present inside `body`). The composite
 * `session_completions_user` index speeds the per-user newest-first list
 * query the repo runs.
 *
 * Unlike migrations 0003/0004 there is no per-user seeding/backfill step —
 * history starts empty; rows are written only when a progressed session ends.
 */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient

  yield* sql`CREATE TABLE session_completions (
    id          TEXT PRIMARY KEY,
    user_id     TEXT NOT NULL REFERENCES users(id),
    ended_at    TEXT NOT NULL,
    body        TEXT NOT NULL
  )`

  yield* sql`CREATE INDEX session_completions_user ON session_completions(user_id, ended_at)`
})
