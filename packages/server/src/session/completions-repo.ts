import { randomUUID } from 'node:crypto'

import { SqlClient } from '@effect/sql'
import {
  CompletionId,
  SessionCompletion,
  type CompletionProgress,
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
  /** Denormalized from `progress`; NULL when the completion has no progress (pre-0006 rows, or post-0006 writes without it). */
  readonly progress_segments_completed: number | null
  readonly progress_total_segments: number | null
}

/**
 * Decodes a `session_completions` row into the domain `SessionCompletion`.
 * Starts from `body`'s JSON, then applies the denormalized progress columns
 * as the authority for `progress`: both non-null → that
 * `CompletionProgress`; either NULL → progress absent (covers pre-0006 rows
 * and writes without progress). The merged value goes through
 * `Schema.decodeUnknown` so field validation and `DateTimeUtc` ISO parsing
 * both apply. Every row here was written by this module (or by a pre-0006
 * insert of the same body shape), so a decode failure is a stored-data
 * invariant violation — it dies rather than returning a typed error.
 */
const decodeRow = (row: CompletionsTableRow) => {
  const body = JSON.parse(row.body) as Record<string, unknown>
  const hasProgressColumns =
    row.progress_segments_completed !== null && row.progress_total_segments !== null

  if (hasProgressColumns) {
    body.progress = {
      segmentsCompleted: row.progress_segments_completed,
      totalSegments: row.progress_total_segments,
    }
  } else {
    // NULL columns → absent progress (even if a legacy body somehow carried one).
    delete body.progress
  }

  return Schema.decodeUnknown(SessionCompletion)(body).pipe(Effect.orDie)
}

type InsertRow = {
  readonly userId: UserId
  readonly completion: SessionCompletion
}

/**
 * The as-ended facts of one session, minus the per-participant identity.
 * `progress` is how far the session had run when the row is written (absent for
 * legacy call sites); it rides onto every `SessionCompletion` this record mints.
 */
export type SessionRecord = {
  readonly sessionId: SessionId
  readonly workoutName: string
  readonly workout: Workout
  readonly host: Participant
  readonly participants: readonly Participant[]
  readonly startedAt: DateTime.Utc
  readonly endedAt: DateTime.Utc
  readonly progress?: CompletionProgress
}

/** Mints one `SessionCompletion` from a record — the shared row shape. */
const completionFor = (record: SessionRecord, participants: readonly Participant[]) =>
  new SessionCompletion({
    id: freshCompletionId(randomUUID()),
    sessionId: record.sessionId,
    workoutName: record.workoutName,
    workout: record.workout,
    host: record.host,
    // `participants` is validated non-empty by every caller below.
    participants: participants as readonly [Participant, ...Participant[]],
    startedAt: record.startedAt,
    endedAt: record.endedAt,
    progress: record.progress,
  })

/**
 * One `insertAll` row per ever-participant of an ended session: each carries a
 * freshly minted `CompletionId` and is filed under that participant's user id,
 * but all share the same as-run snapshot, host, participant list, span, and
 * progress. An empty roster yields no rows (nothing to persist) — the schema's
 * participant list would be empty, which `SessionCompletion` forbids anyway.
 */
export const completionRowsForSession = (record: SessionRecord): readonly InsertRow[] => {
  const participants = record.participants
  if (!Arr.isNonEmptyReadonlyArray(participants)) {
    return []
  }
  return participants.map((participant) => ({
    userId: participant.userId,
    completion: completionFor(record, participants),
  }))
}

/**
 * A single completion row filed under `userId` — the leaver's row, written the
 * moment they leave a progressed session. `participants` is the roster at write
 * time (the still-present ever-participants), so the leaver sees who they left
 * behind. An empty roster yields no row, mirroring `completionRowsForSession`.
 */
export const completionRowForUser = (
  record: SessionRecord,
  userId: UserId,
): readonly InsertRow[] => {
  if (!Arr.isNonEmptyReadonlyArray(record.participants)) {
    return []
  }
  return [{ userId, completion: completionFor(record, record.participants) }]
}

/**
 * Writes every (userId, completion) pair in one SQL transaction. Row `id`
 * is the caller-minted `completion.id`. Each completion is Schema-encoded
 * exactly once; denormalized columns (`ended_at`, progress segment counts)
 * are taken from that same encoded value so column and body stay identical.
 *
 * When `progress` is present the denormalized progress columns are filled;
 * when absent they are written as NULL (post-0006). Omitting them only when
 * the table predates 0006 is unnecessary in production — MigratorLive always
 * runs 0006 — but writing NULL explicitly keeps the "no progress" state
 * visible in the row.
 */
const insertAll = (sql: SqlClient.SqlClient, rows: readonly InsertRow[]) =>
  sql.withTransaction(
    Effect.gen(function* () {
      yield* Effect.forEach(
        rows,
        ({ userId, completion }) =>
          Effect.gen(function* () {
            const encoded = yield* Schema.encode(SessionCompletion)(completion).pipe(Effect.orDie)
            const progress = encoded.progress
            yield* sql`INSERT INTO session_completions ${sql.insert({
              id: completion.id,
              user_id: userId,
              ended_at: encoded.endedAt,
              body: JSON.stringify(encoded),
              progress_segments_completed: progress?.segmentsCompleted ?? null,
              progress_total_segments: progress?.totalSegments ?? null,
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
 * Persistence for the `session_completions` table (migrations `0005_history`
 * + `0006_completion_progress`), following the `library/` idioms: services
 * via `Effect.Service`, persistence only through the generic
 * `SqlClient.SqlClient` tag. Encode once on write / decode on read;
 * caller-facing failures are only `SqlError` — decode defects die.
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
