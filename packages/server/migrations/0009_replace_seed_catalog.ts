import { randomUUID } from 'node:crypto'

import { SqlClient } from '@effect/sql'
import * as Arr from 'effect/Array'
import * as DateTime from 'effect/DateTime'
import * as Effect from 'effect/Effect'
import * as Order from 'effect/Order'

import previousSeedJson from '../src/library/seed-exercises-before-0009.json'
import { seedExercises } from '../src/library/seed-exercises.js'

/** The field that ADR-0004 removes from `Exercise`. */
const REMOVED_FIELD = 'intensity'

/**
 * A stored body after the removed field is gone, plus whether the body held
 * it. Plain JSON, and not `Schema.decode(Exercise)`, for the reason given in
 * migration 0008: the domain schema is what changed, so a decode of a
 * pre-migration row is the wrong tool inside the migration that changes it.
 */
type Stripped = {
  readonly record: Record<string, unknown>
  readonly hadRemovedField: boolean
}

const strip = (parsed: unknown): Stripped | undefined => {
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return undefined
  }
  const { [REMOVED_FIELD]: removed, ...record } = parsed as Record<string, unknown>
  return { record, hadRemovedField: removed !== undefined }
}

/**
 * A canonical text for one exercise body: the keys in sorted order, so two
 * bodies that hold the same fields compare equal whatever order they were
 * written in. Every row 0008 rewrote kept its key order, but a comparison
 * that depends on that is fragile for no gain.
 */
const canonical = (record: Record<string, unknown>): string =>
  JSON.stringify(
    Object.fromEntries(
      Arr.sort(Object.keys(record), Order.string).map((key) => [key, record[key]]),
    ),
  )

const canonicalBodies = (catalog: readonly unknown[]): ReadonlySet<string> =>
  new Set(
    catalog.flatMap((entry) => {
      const stripped = strip(entry)
      return stripped === undefined ? [] : [canonical(stripped.record)]
    }),
  )

const currentSeedBodies = canonicalBodies(seedExercises)

/**
 * The canonical text of every entry the previous catalog shipped, after the
 * removed field is gone, minus the entries the current catalog ships
 * unchanged. A stored row that matches one of these is a shipped row that
 * the user never edited and that the current catalog no longer holds. A row
 * that both catalogs hold is correct as it is, and it stays; that is also
 * what makes a second run of this rule a no-op.
 */
const previousSeedBodies: ReadonlySet<string> = new Set(
  [...canonicalBodies(previousSeedJson as readonly unknown[])].filter(
    (body) => !currentSeedBodies.has(body),
  ),
)

const lowerName = (record: Record<string, unknown>): string | undefined =>
  typeof record.name === 'string' ? record.name.toLowerCase() : undefined

/** What the migration does with one stored row. */
type RowAction =
  | { readonly kind: 'delete' }
  | { readonly kind: 'rewrite'; readonly body: string }
  | { readonly kind: 'keep' }

const classify = (body: string): RowAction & { readonly name?: string } => {
  const stripped = strip(JSON.parse(body) as unknown)
  if (stripped === undefined) {
    return { kind: 'keep' }
  }
  const name = lowerName(stripped.record)
  if (previousSeedBodies.has(canonical(stripped.record))) {
    return { kind: 'delete' }
  }
  if (stripped.hadRemovedField) {
    return { kind: 'rewrite', body: JSON.stringify(stripped.record), ...(name && { name }) }
  }
  return { kind: 'keep', ...(name && { name }) }
}

/**
 * The stored-data half of ADR-0004. Two things happen to every user's
 * exercise library, in one transaction:
 *
 * 1. The `intensity` field leaves every stored body. The domain schema no
 *    longer declares it. A decode would ignore the extra key, but a row that
 *    carries a field nothing reads is the failure mode ADR-0003 removed
 *    `full-body` for, so the rows are cleaned rather than tolerated.
 *
 * 2. The previous shipped catalog is replaced by the current one. A stored
 *    row whose body equals an entry of the previous catalog, field for field,
 *    is a shipped row the user never touched, and it is deleted. Every other
 *    row is the user's own work (a row they created, or a shipped row they
 *    edited) and it stays. Then every entry of the current catalog whose name
 *    is not already in the user's library, compared case-insensitively, is
 *    inserted. A user who edited "Burpee" keeps their "Burpee"; the catalog's
 *    is not inserted beside it.
 *
 * The comparison is by body, not by name. A name match alone would delete a
 * user's rewrite of a shipped row.
 *
 * The migration must reach every row of every owner, for the reason 0008
 * gives. `migration-0009.test.ts` reads the migrated rows back through the
 * real repo listing to prove it.
 *
 * The migration opens no transaction of its own. `Migrator` runs each
 * migration in `sql.withTransaction`, so a failure part way rolls the whole
 * rewrite back and leaves no mixed state.
 *
 * The table shape does not change: no column, and no index. The migration is
 * forward-only. A fresh database has no rows when it runs, and registration
 * seeds the current catalog directly.
 */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  const keptNamesByOwner = yield* cleanStoredRows(sql)
  yield* insertMissingSeeds(sql, keptNamesByOwner)
})

/**
 * Pass one: every stored row is deleted, rewritten, or kept. Returns, per
 * owner, the lower-cased names of the rows that stay. Every owner in `users`
 * has an entry, so that an owner with no rows at all is still seeded.
 */
const cleanStoredRows = (sql: SqlClient.SqlClient) =>
  Effect.gen(function* () {
    const rows = yield* sql<{
      readonly id: string
      readonly owner_id: string
      readonly body: string
    }>`SELECT id, owner_id, body FROM exercises`
    const users = yield* sql<{ readonly id: string }>`SELECT id FROM users`

    const keptNamesByOwner = new Map<string, Set<string>>(
      users.map((user) => [user.id, new Set<string>()]),
    )
    const remember = (ownerId: string, name: string | undefined) => {
      const names = keptNamesByOwner.get(ownerId) ?? new Set<string>()
      if (name !== undefined) {
        names.add(name)
      }
      keptNamesByOwner.set(ownerId, names)
    }

    yield* Effect.forEach(
      rows,
      (row) => {
        const action = classify(row.body)
        switch (action.kind) {
          case 'delete': {
            remember(row.owner_id, undefined)
            return sql`DELETE FROM exercises WHERE id = ${row.id}`.pipe(Effect.asVoid)
          }
          case 'rewrite': {
            remember(row.owner_id, action.name)
            return sql`UPDATE exercises SET body = ${action.body} WHERE id = ${row.id}`.pipe(
              Effect.asVoid,
            )
          }
          case 'keep': {
            remember(row.owner_id, action.name)
            return Effect.void
          }
        }
      },
      { discard: true },
    )

    return keptNamesByOwner
  })

/** Pass two: each owner gets every catalog entry whose name they do not already hold. */
const insertMissingSeeds = (
  sql: SqlClient.SqlClient,
  keptNamesByOwner: ReadonlyMap<string, ReadonlySet<string>>,
) =>
  Effect.gen(function* () {
    const at = DateTime.formatIso(yield* DateTime.now)
    yield* Effect.forEach(
      [...keptNamesByOwner.entries()],
      ([ownerId, keptNames]) =>
        Effect.forEach(
          seedExercises.filter((seed) => !keptNames.has(seed.name.toLowerCase())),
          (seed) =>
            sql`INSERT INTO exercises ${sql.insert({
              id: randomUUID(),
              owner_id: ownerId,
              body: JSON.stringify(seed),
              created_at: at,
              updated_at: at,
            })}`.pipe(Effect.asVoid),
          { discard: true },
        ),
      { discard: true },
    )
  })
