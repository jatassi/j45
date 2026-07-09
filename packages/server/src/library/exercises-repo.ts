import { randomUUID } from 'node:crypto'

import { SqlClient } from '@effect/sql'
import {
  Exercise,
  ExerciseNotFound,
  LibraryExercise,
  type ExerciseId,
  type UserId,
} from '@j45/domain'
import * as DateTime from 'effect/DateTime'
import * as Effect from 'effect/Effect'
import * as Schema from 'effect/Schema'

import { seedExercises } from './seed-exercises.js'

type ExercisesTableRow = {
  readonly id: string
  readonly owner_id: string
  readonly body: string
  readonly created_at: string
  readonly updated_at: string
}

/**
 * Decodes an `exercises` row into the domain `LibraryExercise` — `body`'s
 * parsed JSON plus the row's id/timestamps all go through
 * `Schema.decodeUnknown` in one shot, so `Exercise`'s own field validation
 * and `DateTimeUtc`'s ISO parsing both apply. Every row here was written by
 * this module, so a decode failure is a stored-data invariant violation,
 * not a caller-facing failure — it dies rather than returning a typed
 * error.
 */
const decodeRow = (row: ExercisesTableRow) =>
  Schema.decodeUnknown(LibraryExercise)({
    id: row.id,
    exercise: JSON.parse(row.body) as unknown,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }).pipe(Effect.orDie)

type NewRow = {
  readonly id: ExerciseId
  readonly ownerId: UserId
  readonly encoded: typeof Exercise.Encoded
  readonly at: DateTime.Utc
}

/** The single low-level write path — every insert (`insert`, `seedForUser`) funnels through this. */
const insertRow = (sql: SqlClient.SqlClient, row: NewRow) =>
  sql`INSERT INTO exercises ${sql.insert({
    id: row.id,
    owner_id: row.ownerId,
    body: JSON.stringify(row.encoded),
    created_at: DateTime.formatIso(row.at),
    updated_at: DateTime.formatIso(row.at),
  })}`.pipe(Effect.asVoid)

/** Every exercise the given owner has — no ordering guarantee; callers that need one sort after decode. */
const listForOwner = (sql: SqlClient.SqlClient, ownerId: UserId) =>
  sql<ExercisesTableRow>`SELECT * FROM exercises WHERE owner_id = ${ownerId}`.pipe(
    Effect.flatMap((rows) => Effect.forEach(rows, decodeRow)),
  )

/** Inserts a brand-new, caller-owned exercise with a fresh id and matching created/updated timestamps. */
const insert = (sql: SqlClient.SqlClient, ownerId: UserId, exercise: Exercise) =>
  Effect.gen(function* () {
    const at = yield* DateTime.now
    const id = randomUUID() as ExerciseId
    const encoded = yield* Schema.encode(Exercise)(exercise).pipe(Effect.orDie)
    yield* insertRow(sql, { id, ownerId, encoded, at })
    return new LibraryExercise({ id, exercise, createdAt: at, updatedAt: at })
  })

type UpdateInput = {
  readonly id: ExerciseId
  readonly ownerId: UserId
  readonly exercise: Exercise
}

/**
 * Replaces the stored `Exercise` body, bumping `updated_at` and leaving
 * `created_at`; the `RETURNING *` clause makes the ownership check and the
 * write atomic — a foreign id and an absent one both just fail
 * `ExerciseNotFound`.
 */
const update = (sql: SqlClient.SqlClient, input: UpdateInput) =>
  Effect.gen(function* () {
    const at = yield* DateTime.now
    const encoded = yield* Schema.encode(Exercise)(input.exercise).pipe(Effect.orDie)
    const rows = yield* sql<ExercisesTableRow>`
      UPDATE exercises
      SET body = ${JSON.stringify(encoded)}, updated_at = ${DateTime.formatIso(at)}
      WHERE id = ${input.id} AND owner_id = ${input.ownerId}
      RETURNING *
    `
    const row = rows[0]
    if (row === undefined) {
      return yield* Effect.fail(new ExerciseNotFound({ id: input.id }))
    }
    return yield* decodeRow(row)
  })

/** Deletes the caller's own exercise — `RETURNING id` doubles as the "did a row actually exist" check. */
const deleteOwned = (sql: SqlClient.SqlClient, id: ExerciseId, ownerId: UserId) =>
  Effect.gen(function* () {
    const rows = yield* sql<{ readonly id: string }>`
      DELETE FROM exercises WHERE id = ${id} AND owner_id = ${ownerId} RETURNING id
    `
    if (rows.length === 0) {
      return yield* Effect.fail(new ExerciseNotFound({ id }))
    }
  })

/**
 * Inserts the frozen seed exercise catalog as fresh, caller-owned rows
 * sharing one `created_at`/`updated_at` — the one seed-insertion path both
 * registration (a brand-new account) and migration `0004_exercises`
 * (backfilling accounts that predate it) call.
 */
const seedForUser = (sql: SqlClient.SqlClient, userId: UserId) =>
  Effect.gen(function* () {
    const at = yield* DateTime.now
    yield* Effect.forEach(
      seedExercises,
      (encoded) => insertRow(sql, { id: randomUUID() as ExerciseId, ownerId: userId, encoded, at }),
      { discard: true },
    )
  })

/**
 * Persistence for the `exercises` table (migration `0004_exercises`), following
 * the `auth/` idioms: services via `Effect.Service`, persistence only
 * through the generic `SqlClient.SqlClient` tag, timestamps via Effect
 * `DateTime.now`. Every ownership-scoped query is `WHERE id = ? AND
 * owner_id = ?` — a foreign id is indistinguishable from an absent one.
 */
export class ExercisesRepo extends Effect.Service<ExercisesRepo>()('ExercisesRepo', {
  effect: Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient

    return {
      listForOwner: (ownerId: UserId) => listForOwner(sql, ownerId),
      insert: (ownerId: UserId, exercise: Exercise) => insert(sql, ownerId, exercise),
      update: (id: ExerciseId, ownerId: UserId, exercise: Exercise) =>
        update(sql, { id, ownerId, exercise }),
      delete: (id: ExerciseId, ownerId: UserId) => deleteOwned(sql, id, ownerId),
      seedForUser: (userId: UserId) => seedForUser(sql, userId),
    } as const
  }),
}) {}
