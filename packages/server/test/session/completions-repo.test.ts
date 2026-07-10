import { NodeContext } from '@effect/platform-node'
import { SqlClient } from '@effect/sql'
import { SqliteClient } from '@effect/sql-sqlite-node'
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
  type UserId,
  type Username,
} from '@j45/domain'
import * as DateTime from 'effect/DateTime'
import * as Duration from 'effect/Duration'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import * as Schema from 'effect/Schema'
import * as TestClock from 'effect/TestClock'

import { UserRepo } from '../../src/auth/user-repo.js'
import { CompletionsRepo } from '../../src/session/completions-repo.js'
import { MigratorLive } from '../../src/sql.js'

/**
 * The exact `MigratorLive` layer the server entrypoint runs at startup,
 * against an in-memory `@effect/sql-sqlite-node` driver — same pattern as
 * `test/library/exercises-repo.test.ts`.
 */
const SqlTestLive = MigratorLive.pipe(
  Layer.provideMerge(SqliteClient.layer({ filename: ':memory:' })),
  Layer.provideMerge(NodeContext.layer),
)

/** `session_completions.user_id REFERENCES users(id)` — `UserRepo` seeds the owner rows these tests attach completions to. */
const CompletionsRepoTestLive = Layer.mergeAll(UserRepo.Default, CompletionsRepo.Default).pipe(
  Layer.provideMerge(SqlTestLive),
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
  readonly extraParticipants?: readonly Participant[]
}) => {
  const host = new Participant({
    userId: input.hostUserId,
    displayName: 'Host',
  })
  const participants = [host, ...(input.extraParticipants ?? [])] as const
  return new SessionCompletion({
    id: Schema.decodeSync(CompletionId)(input.id),
    sessionId: Schema.decodeSync(SessionId)(input.sessionId),
    workoutName: input.workoutName,
    workout: makeWorkout(input.workoutName),
    host,
    participants,
    startedAt: input.startedAt,
    endedAt: input.endedAt,
  })
}

describe('CompletionsRepo', () => {
  it.effect(
    'insertAll writes one row per pair; ended_at column matches the encoded body endedAt (encode once)',
    () =>
      Effect.gen(function* () {
        const completionsRepo = yield* CompletionsRepo
        const sql = yield* SqlClient.SqlClient
        const userA = 'user-a' as UserId
        const userB = 'user-b' as UserId
        yield* insertUser(userA)
        yield* insertUser(userB)

        const startedAt = yield* DateTime.now
        yield* TestClock.adjust(Duration.seconds(30))
        const endedAt = yield* DateTime.now

        const completionA = makeCompletion({
          id: 'completion-a',
          sessionId: 'session-1',
          workoutName: 'Athletica',
          hostUserId: userA,
          startedAt,
          endedAt,
          extraParticipants: [new Participant({ userId: userB, displayName: 'Guest' })],
        })
        const completionB = makeCompletion({
          id: 'completion-b',
          sessionId: 'session-1',
          workoutName: 'Athletica',
          hostUserId: userA,
          startedAt,
          endedAt,
          extraParticipants: [new Participant({ userId: userB, displayName: 'Guest' })],
        })

        yield* completionsRepo.insertAll([
          { userId: userA, completion: completionA },
          { userId: userB, completion: completionB },
        ])

        const rows = yield* sql<{
          readonly id: string
          readonly user_id: string
          readonly ended_at: string
          readonly body: string
        }>`SELECT id, user_id, ended_at, body FROM session_completions ORDER BY id`

        expect(rows).toHaveLength(2)
        expect(rows.map((row) => ({ id: row.id, user_id: row.user_id }))).toStrictEqual([
          { id: 'completion-a', user_id: userA },
          { id: 'completion-b', user_id: userB },
        ])

        // Column and body timestamp must agree — prove encode-once by reading
        // the stored JSON's endedAt and matching it byte-for-byte to ended_at.
        for (const row of rows) {
          const body = JSON.parse(row.body) as { readonly endedAt: string }
          expect(row.ended_at).toBe(body.endedAt)
          expect(row.ended_at).toBe(DateTime.formatIso(endedAt))
        }
      }).pipe(Effect.provide(CompletionsRepoTestLive)),
  )

  it.effect('listForUser returns only that user’s rows, newest-first by ended_at', () =>
    Effect.gen(function* () {
      const completionsRepo = yield* CompletionsRepo
      const userA = 'user-a' as UserId
      const userB = 'user-b' as UserId
      yield* insertUser(userA)
      yield* insertUser(userB)

      const t0 = yield* DateTime.now
      yield* TestClock.adjust(Duration.seconds(10))
      const t1 = yield* DateTime.now
      yield* TestClock.adjust(Duration.seconds(10))
      const t2 = yield* DateTime.now

      const olderA = makeCompletion({
        id: 'completion-a-old',
        sessionId: 'session-old',
        workoutName: 'Older',
        hostUserId: userA,
        startedAt: t0,
        endedAt: t1,
      })
      const newerA = makeCompletion({
        id: 'completion-a-new',
        sessionId: 'session-new',
        workoutName: 'Newer',
        hostUserId: userA,
        startedAt: t1,
        endedAt: t2,
      })
      const onlyB = makeCompletion({
        id: 'completion-b',
        sessionId: 'session-b',
        workoutName: 'B Only',
        hostUserId: userB,
        startedAt: t0,
        endedAt: t2,
      })

      // Insert out of chronological order to prove ORDER BY ended_at DESC, not insert order.
      yield* completionsRepo.insertAll([
        { userId: userA, completion: newerA },
        { userId: userB, completion: onlyB },
        { userId: userA, completion: olderA },
      ])

      const listA = yield* completionsRepo.listForUser(userA)
      const listB = yield* completionsRepo.listForUser(userB)

      expect(listA.map((c) => c.id)).toStrictEqual(['completion-a-new', 'completion-a-old'])
      expect(listA.map((c) => c.workoutName)).toStrictEqual(['Newer', 'Older'])
      expect(listB).toHaveLength(1)
      expect(listB[0]?.id).toBe('completion-b')
      expect(listB[0]?.workoutName).toBe('B Only')

      // Round-trip: listed rows decode to the original domain objects.
      expect(listA[0]).toStrictEqual(newerA)
      expect(listA[1]).toStrictEqual(olderA)
      expect(listB[0]).toStrictEqual(onlyB)
    }).pipe(Effect.provide(CompletionsRepoTestLive)),
  )

  it.effect('insertAll of an empty list is a no-op', () =>
    Effect.gen(function* () {
      const completionsRepo = yield* CompletionsRepo
      const userId = 'user-empty' as UserId
      yield* insertUser(userId)

      yield* completionsRepo.insertAll([])
      const history = yield* completionsRepo.listForUser(userId)
      expect(history).toStrictEqual([])
    }).pipe(Effect.provide(CompletionsRepoTestLive)),
  )
})
