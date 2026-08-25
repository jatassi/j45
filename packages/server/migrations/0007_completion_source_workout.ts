import { SqlClient } from '@effect/sql'
import * as Effect from 'effect/Effect'

/**
 * history-identity's persistence — one nullable text column on
 * `session_completions` holding the `WorkoutId` the session started from.
 * `body` remains the Schema-encoded `SessionCompletion` (including the
 * optional `sourceWorkoutId`); this column mirrors it, the same way
 * `ended_at` mirrors `endedAt`.
 *
 * Forward-only, and not backfilled. A pre-0007 row records only a workout
 * name. A name is not an identity: two workouts can hold one name, and a
 * record of somebody else's plan holds their name. A match on the name is the
 * defect this column removes. A guessed id would put that defect into stored
 * data, where a wrong id looks the same as a true one. Old rows keep NULL.
 * They render from their own as-run snapshots, and no longer feed the home
 * recent list.
 */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient

  yield* sql`ALTER TABLE session_completions ADD COLUMN source_workout_id TEXT`
})
