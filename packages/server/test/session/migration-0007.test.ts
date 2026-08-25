import { NodeContext } from '@effect/platform-node'
import { SqlClient } from '@effect/sql'
import { SqliteClient } from '@effect/sql-sqlite-node'
import * as Migrator from '@effect/sql/Migrator'
import { describe, expect, it } from '@effect/vitest'
import {
  CompletionId,
  Flow,
  Participant,
  Pod,
  Round,
  SessionCompletion,
  SessionId,
  Station,
  Workout,
  WorkoutId,
  type UserId,
  type Username,
} from '@j45/domain'
import * as DateTime from 'effect/DateTime'
import * as Duration from 'effect/Duration'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import * as Schema from 'effect/Schema'
import * as TestClock from 'effect/TestClock'

import Migration0001 from '../../migrations/0001_app_meta.js'
import Migration0002 from '../../migrations/0002_auth.js'
import Migration0003 from '../../migrations/0003_library.js'
import Migration0004 from '../../migrations/0004_exercises.js'
import Migration0005 from '../../migrations/0005_history.js'
import Migration0006 from '../../migrations/0006_completion_progress.js'
import Migration0007 from '../../migrations/0007_completion_source_workout.js'
import { UserRepo } from '../../src/auth/user-repo.js'
import { CompletionsRepo } from '../../src/session/completions-repo.js'

/**
 * Same in-memory loader idiom as `migration-0006.test.ts`: real migration
 * modules, statically imported, so a fresh database can stop at exactly
 * 0001–0006 — the "written before source identity existed" state — before
 * 0007 runs.
 */
const migrateThrough0006 = Migrator.make({})({
  loader: Migrator.fromRecord({
    '0001_app_meta': Migration0001,
    '0002_auth': Migration0002,
    '0003_library': Migration0003,
    '0004_exercises': Migration0004,
    '0005_history': Migration0005,
    '0006_completion_progress': Migration0006,
  }),
})

const migrateAll = Migrator.make({})({
  loader: Migrator.fromRecord({
    '0001_app_meta': Migration0001,
    '0002_auth': Migration0002,
    '0003_library': Migration0003,
    '0004_exercises': Migration0004,
    '0005_history': Migration0005,
    '0006_completion_progress': Migration0006,
    '0007_completion_source_workout': Migration0007,
  }),
})

const TestServicesLive = Layer.mergeAll(UserRepo.Default, CompletionsRepo.Default).pipe(
  Layer.provideMerge(SqliteClient.layer({ filename: ':memory:' })),
  Layer.provideMerge(NodeContext.layer),
)

const FreshDbLive = SqliteClient.layer({ filename: ':memory:' }).pipe(
  Layer.provideMerge(NodeContext.layer),
)

const insertUser = (id: UserId) =>
  Effect.gen(function* () {
    const userRepo = yield* UserRepo
    yield* userRepo.insert({
      id,
      username: `${id}-username` as Username,
      displayName: 'Test User',
      role: 'member',
      pinHash: 'irrelevant-for-this-test',
      createdAt: '2020-01-01T00:00:00.000Z',
    })
  })

const makeWorkout = (name: string) =>
  new Workout({
    name,
    focus: 'cardio',
    pods: [new Pod({ name: 'Pod 1', stations: [new Station({ name: 'Burpee' })] })],
    flow: new Flow({
      type: 'laps',
      rounds: [new Round({ workSeconds: 40, restSeconds: 20 })],
    }),
  })

const makeCompletion = (input: {
  readonly id: string
  readonly sessionId: string
  readonly workoutName: string
  readonly hostUserId: UserId
  readonly startedAt: DateTime.Utc
  readonly endedAt: DateTime.Utc
  readonly sourceWorkoutId?: WorkoutId
}) => {
  const host = new Participant({ userId: input.hostUserId, displayName: 'Host' })
  return new SessionCompletion({
    id: Schema.decodeSync(CompletionId)(input.id),
    sessionId: Schema.decodeSync(SessionId)(input.sessionId),
    workoutName: input.workoutName,
    workout: makeWorkout(input.workoutName),
    host,
    participants: [host],
    startedAt: input.startedAt,
    endedAt: input.endedAt,
    // Attach only when present, so the domain object matches what decode
    // produces (absent key, not `undefined`) under strict equality.
    ...(input.sourceWorkoutId === undefined ? {} : { sourceWorkoutId: input.sourceWorkoutId }),
  })
}

describe('migration 0007_completion_source_workout', () => {
  it.effect('adds a nullable source_workout_id column to session_completions', () =>
    Effect.gen(function* () {
      yield* migrateAll
      const sql = yield* SqlClient.SqlClient

      const columns = yield* sql<{
        readonly name: string
        readonly type: string
        readonly notnull: number
        readonly pk: number
      }>`PRAGMA table_info(session_completions)`

      expect(
        columns.map((column) => ({
          name: column.name,
          type: column.type,
          notnull: column.notnull,
          pk: column.pk,
        })),
      ).toStrictEqual([
        { name: 'id', type: 'TEXT', notnull: 0, pk: 1 },
        { name: 'user_id', type: 'TEXT', notnull: 1, pk: 0 },
        { name: 'ended_at', type: 'TEXT', notnull: 1, pk: 0 },
        { name: 'body', type: 'TEXT', notnull: 1, pk: 0 },
        { name: 'progress_segments_completed', type: 'INTEGER', notnull: 0, pk: 0 },
        { name: 'progress_total_segments', type: 'INTEGER', notnull: 0, pk: 0 },
        { name: 'source_workout_id', type: 'TEXT', notnull: 0, pk: 0 },
      ])
    }).pipe(Effect.provide(FreshDbLive)),
  )

  it.effect(
    'a row written before 0007 reads with no source workout on either schema, and survives the migration — no backfill by name',
    () =>
      Effect.gen(function* () {
        yield* migrateThrough0006

        const userId = 'user-pre-0007' as UserId
        yield* insertUser(userId)

        const startedAt = yield* DateTime.now
        yield* TestClock.adjust(Duration.seconds(30))
        const endedAt = yield* DateTime.now

        const preexisting = makeCompletion({
          id: 'completion-pre-0007',
          sessionId: 'session-pre-0007',
          workoutName: 'Pre-0007 Athletica',
          hostUserId: userId,
          startedAt,
          endedAt,
        })

        // `CompletionsRepo.insertAll` now also writes the 0007 column, which a
        // 0006-only schema does not have — so seed the historical six-column
        // shape directly, through the same encode-once body path.
        const sql = yield* SqlClient.SqlClient
        const encoded = yield* Schema.encode(SessionCompletion)(preexisting).pipe(Effect.orDie)
        yield* sql`INSERT INTO session_completions ${sql.insert({
          id: preexisting.id,
          user_id: userId,
          ended_at: encoded.endedAt,
          body: JSON.stringify(encoded),
          progress_segments_completed: null,
          progress_total_segments: null,
        })}`

        // Read it back on the 0006 schema first. `SELECT *` returns no
        // `source_workout_id` key at all there, which must read the same way a
        // NULL does: no source workout.
        const completionsRepo = yield* CompletionsRepo
        const before = yield* completionsRepo.listForUser(userId)
        expect(before).toHaveLength(1)
        expect(before[0]?.sourceWorkoutId).toBeUndefined()

        // 0001–0006 are already recorded — only 0007 actually runs here.
        yield* migrateAll

        const raw = yield* sql<{
          readonly id: string
          readonly source_workout_id: string | null
        }>`SELECT id, source_workout_id FROM session_completions`
        expect(raw).toHaveLength(1)
        expect(raw[0]?.id).toBe('completion-pre-0007')
        expect(raw[0]?.source_workout_id).toBeNull()

        const history = yield* completionsRepo.listForUser(userId)
        expect(history).toHaveLength(1)
        expect(history[0]?.workoutName).toBe('Pre-0007 Athletica')
        expect(history[0]?.sourceWorkoutId).toBeUndefined()
      }).pipe(Effect.provide(TestServicesLive)),
  )

  it.effect(
    'insertAll stores the source workout id in its own column and listForUser round-trips it; without one the column is NULL',
    () =>
      Effect.gen(function* () {
        yield* migrateAll

        const userId = 'user-source' as UserId
        yield* insertUser(userId)

        const completionsRepo = yield* CompletionsRepo
        const sql = yield* SqlClient.SqlClient

        const t0 = yield* DateTime.now
        yield* TestClock.adjust(Duration.seconds(10))
        const t1 = yield* DateTime.now
        yield* TestClock.adjust(Duration.seconds(10))
        const t2 = yield* DateTime.now

        const withoutSource = makeCompletion({
          id: 'completion-no-source',
          sessionId: 'session-no-source',
          workoutName: 'No Source',
          hostUserId: userId,
          startedAt: t0,
          endedAt: t1,
        })
        const withSource = makeCompletion({
          id: 'completion-with-source',
          sessionId: 'session-with-source',
          workoutName: 'With Source',
          hostUserId: userId,
          startedAt: t1,
          endedAt: t2,
          sourceWorkoutId: Schema.decodeSync(WorkoutId)('workout-athletica'),
        })

        yield* completionsRepo.insertAll([
          { userId, completion: withoutSource },
          { userId, completion: withSource },
        ])

        const raw = yield* sql<{
          readonly id: string
          readonly source_workout_id: string | null
        }>`SELECT id, source_workout_id FROM session_completions ORDER BY id`

        expect(raw).toStrictEqual([
          { id: 'completion-no-source', source_workout_id: null },
          { id: 'completion-with-source', source_workout_id: 'workout-athletica' },
        ])

        const history = yield* completionsRepo.listForUser(userId)
        // newest-first by ended_at — withSource ended later.
        expect(history[0]).toStrictEqual(withSource)
        expect(history[0]?.sourceWorkoutId).toBe('workout-athletica')
        expect(history[1]).toStrictEqual(withoutSource)
        expect(history[1]?.sourceWorkoutId).toBeUndefined()
      }).pipe(Effect.provide(TestServicesLive)),
  )
})
