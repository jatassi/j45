import { randomUUID } from 'node:crypto'

import { SqlClient } from '@effect/sql'
import {
  CompletionId,
  SessionCompletion,
  type Participant,
  type SessionId,
  type UserId,
  type Workout,
} from '@j45/domain'
import * as Arr from 'effect/Array'
import type * as DateTime from 'effect/DateTime'
import * as Effect from 'effect/Effect'
import * as Schema from 'effect/Schema'

/** Mints a fresh branded `CompletionId` for each row. */
const freshCompletionId = Schema.decodeSync(CompletionId)

type CompletionsTableRow = {
  readonly id: string
  readonly user_id: string
  readonly ended_at: string
  readonly body: string
}

/**
 * Decodes a `session_completions` row into the domain `SessionCompletion` —
 * `body`'s parsed JSON goes through `Schema.decodeUnknown` so field
 * validation and `DateTimeUtc`'s ISO parsing both apply. Every row here was
 * written by this module, so a decode failure is a stored-data invariant
 * violation, not a caller-facing failure — it dies rather than returning a
 * typed error.
 */
const decodeRow = (row: CompletionsTableRow) =>
  Schema.decodeUnknown(SessionCompletion)(JSON.parse(row.body) as unknown).pipe(Effect.orDie)

type InsertRow = {
  readonly userId: UserId
  readonly completion: SessionCompletion
}

/** The as-ended facts of one session, minus the per-participant identity. */
export type SessionRecord = {
  readonly sessionId: SessionId
  readonly workoutName: string
  readonly workout: Workout
  readonly host: Participant
  readonly participants: readonly Participant[]
  readonly startedAt: DateTime.Utc
  readonly endedAt: DateTime.Utc
}

/**
 * One `insertAll` row per ever-participant of an ended session: each carries a
 * freshly minted `CompletionId` and is filed under that participant's user id,
 * but all share the same as-run snapshot, host, participant list, and span. An
 * empty roster yields no rows (nothing to persist) — the schema's participant
 * list would be empty, which `SessionCompletion` forbids anyway.
 */
export const completionRowsForSession = (record: SessionRecord): readonly InsertRow[] => {
  const participants = record.participants
  if (!Arr.isNonEmptyReadonlyArray(participants)) {
    return []
  }
  return participants.map((participant) => ({
    userId: participant.userId,
    completion: new SessionCompletion({
      id: freshCompletionId(randomUUID()),
      sessionId: record.sessionId,
      workoutName: record.workoutName,
      workout: record.workout,
      host: record.host,
      participants,
      startedAt: record.startedAt,
      endedAt: record.endedAt,
    }),
  }))
}

/**
 * Writes every (userId, completion) pair in one SQL transaction. Row `id`
 * is the caller-minted `completion.id`. Each completion is Schema-encoded
 * exactly once; the denormalized `ended_at` column is taken from that same
 * encoded value's `endedAt` field so column and body timestamp are identical.
 */
const insertAll = (sql: SqlClient.SqlClient, rows: readonly InsertRow[]) =>
  sql.withTransaction(
    Effect.gen(function* () {
      yield* Effect.forEach(
        rows,
        ({ userId, completion }) =>
          Effect.gen(function* () {
            const encoded = yield* Schema.encode(SessionCompletion)(completion).pipe(Effect.orDie)
            yield* sql`INSERT INTO session_completions ${sql.insert({
              id: completion.id,
              user_id: userId,
              ended_at: encoded.endedAt,
              body: JSON.stringify(encoded),
            })}`
          }),
        { discard: true },
      )
    }),
  )

/** This user's completions, newest-first by the denormalized `ended_at` column. */
const listForUser = (sql: SqlClient.SqlClient, userId: UserId) =>
  sql<CompletionsTableRow>`
    SELECT * FROM session_completions
    WHERE user_id = ${userId}
    ORDER BY ended_at DESC
  `.pipe(Effect.flatMap((rows) => Effect.forEach(rows, decodeRow)))

/**
 * Persistence for the `session_completions` table (migration `0005_history`),
 * following the `library/` idioms: services via `Effect.Service`,
 * persistence only through the generic `SqlClient.SqlClient` tag. Encode
 * once on write / decode on read; caller-facing failures are only
 * `SqlError` — decode defects die.
 */
export class CompletionsRepo extends Effect.Service<CompletionsRepo>()('CompletionsRepo', {
  effect: Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient

    return {
      insertAll: (rows: readonly InsertRow[]) => insertAll(sql, rows),
      listForUser: (userId: UserId) => listForUser(sql, userId),
    } as const
  }),
}) {}
