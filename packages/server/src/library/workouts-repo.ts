import { randomUUID } from 'node:crypto'

import { SqlClient } from '@effect/sql'
import {
  LibraryWorkout,
  Workout,
  WorkoutConflict,
  WorkoutNotFound,
  type UserId,
  type WorkoutId,
} from '@j45/domain'
import * as DateTime from 'effect/DateTime'
import * as Effect from 'effect/Effect'
import * as Schema from 'effect/Schema'

import { seedWorkouts } from './seed-workouts.js'

type WorkoutsTableRow = {
  readonly id: string
  readonly owner_id: string
  readonly body: string
  readonly created_at: string
  readonly updated_at: string
}

/**
 * Decodes a `workouts` row into the domain `LibraryWorkout` — `body`'s
 * parsed JSON plus the row's id/timestamps all go through
 * `Schema.decodeUnknown` in one shot, so `Workout`'s own field validation
 * and `DateTimeUtc`'s ISO parsing both apply. Every row here was written by
 * this module, so a decode failure is a stored-data invariant violation,
 * not a caller-facing failure — it dies rather than returning a typed
 * error.
 */
const decodeRow = (row: WorkoutsTableRow) =>
  Schema.decodeUnknown(LibraryWorkout)({
    id: row.id,
    workout: JSON.parse(row.body) as unknown,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }).pipe(Effect.orDie)

type NewRow = {
  readonly id: WorkoutId
  readonly ownerId: UserId
  readonly encoded: typeof Workout.Encoded
  readonly at: DateTime.Utc
}

/** The single low-level write path — every insert (`insert`, `duplicate`, `seedForUser`) funnels through this. */
const insertRow = (sql: SqlClient.SqlClient, row: NewRow) =>
  sql`INSERT INTO workouts ${sql.insert({
    id: row.id,
    owner_id: row.ownerId,
    body: JSON.stringify(row.encoded),
    created_at: DateTime.formatIso(row.at),
    updated_at: DateTime.formatIso(row.at),
  })}`.pipe(Effect.asVoid)

/** Every workout the given owner has — no ordering guarantee; callers that need one sort after decode. */
const listForOwner = (sql: SqlClient.SqlClient, ownerId: UserId) =>
  sql<WorkoutsTableRow>`SELECT * FROM workouts WHERE owner_id = ${ownerId}`.pipe(
    Effect.flatMap((rows) => Effect.forEach(rows, decodeRow)),
  )

/**
 * The one lookup every ownership-scoped operation below is built on:
 * `WHERE id = ? AND owner_id = ?`, so a foreign id and an absent one both
 * just fail `WorkoutNotFound` — existence is never leaked.
 */
const getOwned = (sql: SqlClient.SqlClient, id: WorkoutId, ownerId: UserId) =>
  Effect.gen(function* () {
    const rows = yield* sql<WorkoutsTableRow>`
      SELECT * FROM workouts WHERE id = ${id} AND owner_id = ${ownerId}
    `
    const row = rows[0]
    if (row === undefined) {
      return yield* Effect.fail(new WorkoutNotFound({ id }))
    }
    return yield* decodeRow(row)
  })

/** Inserts a brand-new, caller-owned workout with a fresh id and matching created/updated timestamps. */
const insert = (sql: SqlClient.SqlClient, ownerId: UserId, workout: Workout) =>
  Effect.gen(function* () {
    const at = yield* DateTime.now
    const id = randomUUID() as WorkoutId
    const encoded = yield* Schema.encode(Workout)(workout).pipe(Effect.orDie)
    yield* insertRow(sql, { id, ownerId, encoded, at })
    return new LibraryWorkout({ id, workout, createdAt: at, updatedAt: at })
  })

type RenameInput = {
  readonly id: WorkoutId
  readonly ownerId: UserId
  readonly name: string
}

/** Decode → update `name` → encode, bumping `updated_at`; the `RETURNING *` clause makes the ownership check and the write atomic. */
const rename = (sql: SqlClient.SqlClient, input: RenameInput) =>
  Effect.gen(function* () {
    const existing = yield* getOwned(sql, input.id, input.ownerId)
    const at = yield* DateTime.now
    const renamed = new Workout({
      name: input.name,
      focus: existing.workout.focus,
      note: existing.workout.note,
      pods: existing.workout.pods,
      flow: existing.workout.flow,
    })
    const encoded = yield* Schema.encode(Workout)(renamed).pipe(Effect.orDie)
    const rows = yield* sql<WorkoutsTableRow>`
      UPDATE workouts
      SET body = ${JSON.stringify(encoded)}, updated_at = ${DateTime.formatIso(at)}
      WHERE id = ${input.id} AND owner_id = ${input.ownerId}
      RETURNING *
    `
    const row = rows[0]
    if (row === undefined) {
      return yield* Effect.fail(new WorkoutNotFound({ id: input.id }))
    }
    return yield* decodeRow(row)
  })

/** `WorkoutsRepo.update`'s input: the target, the new body, and the version the caller read. */
export type UpdateInput = {
  readonly id: WorkoutId
  readonly ownerId: UserId
  readonly workout: Workout
  readonly expectedUpdatedAt: DateTime.Utc
}

/**
 * Whole-body replacement under an optimistic-concurrency precondition:
 * encode the given workout, write it, bump `updated_at`, and let
 * `RETURNING *` prove ownership *and* freshness atomically — no pre-read
 * needed (unlike rename, which must preserve the rest of the body).
 *
 * `WHERE ... AND owner_id = ?` proves the row is the caller's; `AND
 * updated_at = ?` proves the caller's read is still current. Without the
 * second clause a whole-body replace built on a stale read silently
 * discards whatever landed in between. Comparing the stored column against
 * `DateTime.formatIso` is exact, not approximate: every write path in this
 * module stamps `updated_at` through that same formatter.
 *
 * An empty `RETURNING *` means one of two things, and they are not the same
 * failure: the row isn't the caller's (or doesn't exist), or it moved on
 * since the caller read it. `getOwned` tells them apart.
 *
 * Known limit of using the timestamp as the version token: two writes landing
 * inside the same millisecond leave `updated_at` unchanged, so the second
 * still overwrites the first. Two humans editing one workout from two devices
 * do not collide that finely, and the alternative (a monotonic `version`
 * column) is a migration this defect did not warrant — but a caller that ever
 * writes in a tight programmatic loop cannot rely on this guard.
 */
const update = (sql: SqlClient.SqlClient, input: UpdateInput) =>
  Effect.gen(function* () {
    const at = yield* DateTime.now
    const encoded = yield* Schema.encode(Workout)(input.workout).pipe(Effect.orDie)
    const rows = yield* sql<WorkoutsTableRow>`
      UPDATE workouts
      SET body = ${JSON.stringify(encoded)}, updated_at = ${DateTime.formatIso(at)}
      WHERE id = ${input.id}
        AND owner_id = ${input.ownerId}
        AND updated_at = ${DateTime.formatIso(input.expectedUpdatedAt)}
      RETURNING *
    `
    const row = rows[0]
    if (row === undefined) {
      yield* getOwned(sql, input.id, input.ownerId)
      return yield* Effect.fail(new WorkoutConflict({ id: input.id }))
    }
    return yield* decodeRow(row)
  })

/** Deletes the caller's own workout — `RETURNING id` doubles as the "did a row actually exist" check. */
const deleteOwned = (sql: SqlClient.SqlClient, id: WorkoutId, ownerId: UserId) =>
  Effect.gen(function* () {
    const rows = yield* sql<{ readonly id: string }>`
      DELETE FROM workouts WHERE id = ${id} AND owner_id = ${ownerId} RETURNING id
    `
    if (rows.length === 0) {
      return yield* Effect.fail(new WorkoutNotFound({ id }))
    }
  })

/** Inserts a caller-owned copy of an owned workout, its name suffixed `" (copy)"`, with a fresh id/timestamps. */
const duplicate = (sql: SqlClient.SqlClient, id: WorkoutId, ownerId: UserId) =>
  Effect.gen(function* () {
    const existing = yield* getOwned(sql, id, ownerId)
    const copy = new Workout({
      name: `${existing.workout.name} (copy)`,
      focus: existing.workout.focus,
      note: existing.workout.note,
      pods: existing.workout.pods,
      flow: existing.workout.flow,
    })
    return yield* insert(sql, ownerId, copy)
  })

/**
 * Inserts the 12 frozen legacy seeds as fresh, caller-owned rows sharing one
 * `created_at`/`updated_at` — the one seed-insertion path both registration
 * (a brand-new account) and migration `0003_library` (backfilling accounts
 * that predate it) call.
 */
const seedForUser = (sql: SqlClient.SqlClient, userId: UserId) =>
  Effect.gen(function* () {
    const at = yield* DateTime.now
    yield* Effect.forEach(
      seedWorkouts,
      (encoded) => insertRow(sql, { id: randomUUID() as WorkoutId, ownerId: userId, encoded, at }),
      { discard: true },
    )
  })

/**
 * Persistence for the `workouts` table (migration `0003_library`), following
 * the `auth/` idioms: services via `Effect.Service`, persistence only
 * through the generic `SqlClient.SqlClient` tag, timestamps via Effect
 * `DateTime.now`. Every ownership-scoped query is `WHERE id = ? AND
 * owner_id = ?` — a foreign id is indistinguishable from an absent one.
 */
export class WorkoutsRepo extends Effect.Service<WorkoutsRepo>()('WorkoutsRepo', {
  effect: Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient

    return {
      listForOwner: (ownerId: UserId) => listForOwner(sql, ownerId),
      getOwned: (id: WorkoutId, ownerId: UserId) => getOwned(sql, id, ownerId),
      insert: (ownerId: UserId, workout: Workout) => insert(sql, ownerId, workout),
      rename: (id: WorkoutId, ownerId: UserId, name: string) => rename(sql, { id, ownerId, name }),
      // The one method here taking a record rather than positionals: with the
      // optimistic-concurrency precondition it carries four arguments, and
      // `(id, ownerId, workout, expectedUpdatedAt)` is exactly the positional
      // list a caller can silently mis-order.
      update: (input: UpdateInput) => update(sql, input),
      delete: (id: WorkoutId, ownerId: UserId) => deleteOwned(sql, id, ownerId),
      duplicate: (id: WorkoutId, ownerId: UserId) => duplicate(sql, id, ownerId),
      seedForUser: (userId: UserId) => seedForUser(sql, userId),
    } as const
  }),
}) {}
