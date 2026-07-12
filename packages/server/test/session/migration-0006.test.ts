import { NodeContext } from '@effect/platform-node'
import { SqlClient } from '@effect/sql'
import { SqliteClient } from '@effect/sql-sqlite-node'
import * as Migrator from '@effect/sql/Migrator'
import { describe, expect, it } from '@effect/vitest'
import {
  CompletionId,
  CompletionProgress,
  Flow,
  Participant,
  Pod,
  Round,
  SessionCompletion,
  SessionId,
  Station,
  Workout,
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
import { UserRepo } from '../../src/auth/user-repo.js'
import { CompletionsRepo } from '../../src/session/completions-repo.js'

/**
 * `Migrator.fromRecord` (in-memory loader — real migration modules, statically
 * imported) drives both migrators below. Production (`src/sql.ts`) loads the
 * same modules off disk. `fromRecord` lets a fresh database stop at exactly
 * 0001–0005 — the "migrated through 0005 only" state — before 0006 runs.
 */
const migrateThrough0005 = Migrator.make({})({
  loader: Migrator.fromRecord({
    '0001_app_meta': Migration0001,
    '0002_auth': Migration0002,
    '0003_library': Migration0003,
    '0004_exercises': Migration0004,
    '0005_history': Migration0005,
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
  readonly progress?: CompletionProgress
}) => {
  const host = new Participant({
    userId: input.hostUserId,
    displayName: 'Host',
  })
  return new SessionCompletion({
    id: Schema.decodeSync(CompletionId)(input.id),
    sessionId: Schema.decodeSync(SessionId)(input.sessionId),
    workoutName: input.workoutName,
    workout: makeWorkout(input.workoutName),
    host,
    participants: [host],
    startedAt: input.startedAt,
    endedAt: input.endedAt,
    // Only attach when present so the domain object matches decode (absent key,
    // not `progress: undefined`) for strict equality in the round-trip asserts.
    ...(input.progress === undefined ? {} : { progress: input.progress }),
  })
}

describe('migration 0006_completion_progress', () => {
  it.effect(
    'adds nullable progress_segments_completed and progress_total_segments to session_completions',
    () =>
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
        ])
      }).pipe(Effect.provide(FreshDbLive)),
  )

  it.effect(
    'migrating through 0005 only, inserting a completion, then running 0006 leaves that row readable with progress absent',
    () =>
      Effect.gen(function* () {
        yield* migrateThrough0005

        const userId = 'user-pre-0006' as UserId
        yield* insertUser(userId)

        const startedAt = yield* DateTime.now
        yield* TestClock.adjust(Duration.seconds(30))
        const endedAt = yield* DateTime.now

        const preexisting = makeCompletion({
          id: 'completion-pre-0006',
          sessionId: 'session-pre-0006',
          workoutName: 'Pre-0006 Athletica',
          hostUserId: userId,
          startedAt,
          endedAt,
        })

        // CompletionsRepo.insertAll now also writes the 0006 progress columns.
        // On a 0005-only schema those columns do not exist yet, so seed the
        // historical 4-column shape CompletionsRepo wrote before 0006 — same
        // encode-once body path, without the denormalized progress columns.
        const sql = yield* SqlClient.SqlClient
        const encoded = yield* Schema.encode(SessionCompletion)(preexisting).pipe(Effect.orDie)
        yield* sql`INSERT INTO session_completions ${sql.insert({
          id: preexisting.id,
          user_id: userId,
          ended_at: encoded.endedAt,
          body: JSON.stringify(encoded),
        })}`

        // 0001–0005 are already recorded — only 0006 actually runs here.
        yield* migrateAll

        const columns = yield* sql<{
          readonly name: string
          readonly notnull: number
        }>`PRAGMA table_info(session_completions)`
        expect(columns.map((c) => c.name)).toContain('progress_segments_completed')
        expect(columns.map((c) => c.name)).toContain('progress_total_segments')
        expect(columns.find((c) => c.name === 'progress_segments_completed')?.notnull).toBe(0)
        expect(columns.find((c) => c.name === 'progress_total_segments')?.notnull).toBe(0)

        const raw = yield* sql<{
          readonly id: string
          readonly progress_segments_completed: number | null
          readonly progress_total_segments: number | null
        }>`SELECT id, progress_segments_completed, progress_total_segments FROM session_completions`
        expect(raw).toHaveLength(1)
        expect(raw[0]?.id).toBe('completion-pre-0006')
        expect(raw[0]?.progress_segments_completed).toBeNull()
        expect(raw[0]?.progress_total_segments).toBeNull()

        const completionsRepo = yield* CompletionsRepo
        const history = yield* completionsRepo.listForUser(userId)
        expect(history).toHaveLength(1)
        expect(history[0]?.id).toBe('completion-pre-0006')
        expect(history[0]?.workoutName).toBe('Pre-0006 Athletica')
        expect(history[0]?.progress).toBeUndefined()
      }).pipe(Effect.provide(TestServicesLive)),
  )

  it.effect(
    'insertAll without progress stores NULL columns and listForUser decodes progress absent; with progress round-trips; listForUser returns both side by side',
    () =>
      Effect.gen(function* () {
        yield* migrateAll

        const userId = 'user-progress' as UserId
        yield* insertUser(userId)

        const completionsRepo = yield* CompletionsRepo
        const sql = yield* SqlClient.SqlClient

        const t0 = yield* DateTime.now
        yield* TestClock.adjust(Duration.seconds(10))
        const t1 = yield* DateTime.now
        yield* TestClock.adjust(Duration.seconds(10))
        const t2 = yield* DateTime.now

        const withoutProgress = makeCompletion({
          id: 'completion-no-progress',
          sessionId: 'session-no-progress',
          workoutName: 'No Progress',
          hostUserId: userId,
          startedAt: t0,
          endedAt: t1,
        })
        const withProgress = makeCompletion({
          id: 'completion-with-progress',
          sessionId: 'session-with-progress',
          workoutName: 'With Progress',
          hostUserId: userId,
          startedAt: t1,
          endedAt: t2,
          progress: new CompletionProgress({
            segmentsCompleted: 3,
            totalSegments: 12,
          }),
        })

        yield* completionsRepo.insertAll([
          { userId, completion: withoutProgress },
          { userId, completion: withProgress },
        ])

        const raw = yield* sql<{
          readonly id: string
          readonly progress_segments_completed: number | null
          readonly progress_total_segments: number | null
        }>`SELECT id, progress_segments_completed, progress_total_segments
           FROM session_completions
           ORDER BY id`

        expect(raw).toStrictEqual([
          {
            id: 'completion-no-progress',
            progress_segments_completed: null,
            progress_total_segments: null,
          },
          {
            id: 'completion-with-progress',
            progress_segments_completed: 3,
            progress_total_segments: 12,
          },
        ])

        const history = yield* completionsRepo.listForUser(userId)
        // newest-first by ended_at — withProgress ended later
        expect(history.map((c) => c.id)).toStrictEqual([
          'completion-with-progress',
          'completion-no-progress',
        ])
        expect(history[0]).toStrictEqual(withProgress)
        expect(history[0]?.progress).toStrictEqual(
          new CompletionProgress({ segmentsCompleted: 3, totalSegments: 12 }),
        )
        expect(history[1]).toStrictEqual(withoutProgress)
        expect(history[1]?.progress).toBeUndefined()
      }).pipe(Effect.provide(TestServicesLive)),
  )
})
