import { SqlClient } from '@effect/sql'
import * as Effect from 'effect/Effect'

/**
 * session-leave progress denormalization — two nullable integer columns on
 * `session_completions` (`docs/designs/session-leave`). `body` remains the
 * Schema-encoded `SessionCompletion` (including optional `progress`); these
 * columns mirror `progress.segmentsCompleted` / `progress.totalSegments` for
 * listing and filtering, the same way `ended_at` mirrors `endedAt`.
 *
 * Forward-only, no backfill: existing rows keep NULL in both columns, which
 * the repo maps to an absent `progress`.
 */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient

  yield* sql`ALTER TABLE session_completions ADD COLUMN progress_segments_completed INTEGER`
  yield* sql`ALTER TABLE session_completions ADD COLUMN progress_total_segments INTEGER`
})
