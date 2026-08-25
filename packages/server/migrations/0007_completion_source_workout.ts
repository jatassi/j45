import { SqlClient } from '@effect/sql'
import * as Effect from 'effect/Effect'

/**
 * history-identity's persistence — one nullable text column on
 * `session_completions` holding the `WorkoutId` the session started from.
 * `body` remains the Schema-encoded `SessionCompletion` (including the
 * optional `sourceWorkoutId`); this column mirrors it, the same way
 * `ended_at` mirrors `endedAt`.
 *
 * Forward-only, and deliberately **not** backfilled. A pre-0007 row records
 * only a workout *name*, and a name is not an identity: two workouts can share
 * one, and a record of someone else's plan carries their name, not yours.
 * Matching on it is the exact defect this column removes, so a guessed id
 * would bake that defect into stored data, where a wrong match becomes
 * indistinguishable from a real one. Old rows keep NULL, keep rendering from
 * their own as-run snapshots, and simply stop feeding the home recent list.
 */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient

  yield* sql`ALTER TABLE session_completions ADD COLUMN source_workout_id TEXT`
})
