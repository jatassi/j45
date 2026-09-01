import { SqlClient } from '@effect/sql'
import * as Effect from 'effect/Effect'

/** The muscle group that ADR-0003 removes. */
const REMOVED_GROUP = 'full-body'

/** The group to write when the removal would empty an exercise's list. */
const FALLBACK_GROUP = 'core'

/**
 * Rewrites one stored `exercises.body`. Returns `undefined` when the row needs
 * no write.
 *
 * This uses plain JSON, and not `Schema.decode(Exercise)`. The domain schema
 * is what stops accepting `full-body`. A decode of a pre-migration row would
 * die in the migration that removes the value.
 *
 * The rule reads the muscle-group list only. It does not match text in the
 * body, because a name or a detail can hold the same characters. A text match
 * would rewrite a row whose muscle groups are already correct.
 *
 * The spread keeps every other field, and it keeps the order of the groups
 * that stay: an overridden key holds its original position.
 */
const rewriteBody = (body: string): string | undefined => {
  const parsed: unknown = JSON.parse(body)
  if (typeof parsed !== 'object' || parsed === null) {
    return undefined
  }

  const record = parsed as Record<string, unknown>
  const stored: unknown = record.muscleGroups
  const groups: readonly unknown[] = Array.isArray(stored) ? (stored as readonly unknown[]) : []

  const kept = groups.filter((group) => group !== REMOVED_GROUP)
  // The list did not change, so the row keeps its stored bytes.
  if (kept.length === groups.length) {
    return undefined
  }

  return JSON.stringify({
    ...record,
    muscleGroups: kept.length === 0 ? [FALLBACK_GROUP] : kept,
  })
}

/**
 * The stored-data half of ADR-0003 (issue #27). Every stored exercise loses
 * `full-body` from its muscle groups. Where the removal would leave the list
 * empty, the migration writes a single `core`, because `Exercise.muscleGroups`
 * is a `NonEmptyArray` and that invariant does not change.
 *
 * `seed-exercises.json` gets the identical edit in this commit. An existing
 * user's migrated rows and a new user's seeded rows therefore hold the same
 * tags.
 *
 * The rule stays mechanical, with no curated table of better tags. Users hold
 * rows that they wrote themselves, and a migration cannot write a replacement
 * for an exercise that it has never seen. A curated table would correct the
 * shipped catalog and still fail every user-authored row.
 *
 * The migration must reach every row. `ExercisesRepo`'s `decodeRow` ends in
 * `Effect.orDie`, so one row that keeps the value stops the server at the next
 * read of that catalog. This visits the rows of every owner. It does not visit
 * only the rows that match the shipped seed, or only the first user's rows.
 * `migration-0008.test.ts` proves this: it reads the migrated rows back
 * through the real repo listing.
 *
 * The migration opens no transaction of its own. `Migrator` runs each
 * migration in `sql.withTransaction`, so a failure part way rolls the whole
 * rewrite back and leaves no mixed state.
 *
 * The table shape does not change: no column, and no index. The migration is
 * forward-only, like all the others here. There is no way back to the removed
 * value.
 */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient

  const rows = yield* sql<{
    readonly id: string
    readonly body: string
  }>`SELECT id, body FROM exercises`

  yield* Effect.forEach(
    rows,
    (row) => {
      const rewritten = rewriteBody(row.body)
      if (rewritten === undefined) {
        return Effect.void
      }
      return sql`UPDATE exercises SET body = ${rewritten} WHERE id = ${row.id}`.pipe(Effect.asVoid)
    },
    { discard: true },
  )
})
