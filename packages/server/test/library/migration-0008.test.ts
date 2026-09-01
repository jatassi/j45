import { NodeContext } from '@effect/platform-node'
import { SqlClient } from '@effect/sql'
import { SqliteClient } from '@effect/sql-sqlite-node'
import * as Migrator from '@effect/sql/Migrator'
import { describe, expect, it } from '@effect/vitest'
import type { UserId, Username } from '@j45/domain'
import * as Arr from 'effect/Array'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import * as Order from 'effect/Order'

import Migration0001 from '../../migrations/0001_app_meta.js'
import Migration0002 from '../../migrations/0002_auth.js'
import Migration0003 from '../../migrations/0003_library.js'
import Migration0004 from '../../migrations/0004_exercises.js'
import Migration0005 from '../../migrations/0005_history.js'
import Migration0006 from '../../migrations/0006_completion_progress.js'
import Migration0007 from '../../migrations/0007_completion_source_workout.js'
import Migration0008 from '../../migrations/0008_drop_full_body_from_exercises.js'
import { UserRepo } from '../../src/auth/user-repo.js'
import { ExercisesRepo } from '../../src/library/exercises-repo.js'
import { seedExercises } from '../../src/library/seed-exercises.js'
import { preMigrationSeed, type PreMigrationExercise } from './fixtures/seed-exercises-pre-0008.js'

/**
 * The risk of the `full-body` removal is here. `ExercisesRepo`'s `decodeRow`
 * ends in `Effect.orDie`, so one stored row that keeps the value after the
 * vocabulary narrows stops the server at the next read of that catalog. This
 * test runs the migration, then reads every row back through the real repo
 * listing, and not through raw SQL. A row that keeps the value therefore fails
 * in this suite, and not on a user's server.
 *
 * The in-memory loader idiom is the one in `migration-0004.test.ts` and
 * `migration-0007.test.ts`: the real migration modules, statically imported.
 * A fresh database can then stop at 0001-0007, the state in which a row can
 * still hold `full-body`, before 0008 runs.
 */
const migrateThrough0007 = Migrator.make({})({
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

const migrateAll = Migrator.make({})({
  loader: Migrator.fromRecord({
    '0001_app_meta': Migration0001,
    '0002_auth': Migration0002,
    '0003_library': Migration0003,
    '0004_exercises': Migration0004,
    '0005_history': Migration0005,
    '0006_completion_progress': Migration0006,
    '0007_completion_source_workout': Migration0007,
    '0008_drop_full_body_from_exercises': Migration0008,
  }),
})

const TestServicesLive = Layer.mergeAll(UserRepo.Default, ExercisesRepo.Default).pipe(
  Layer.provideMerge(SqliteClient.layer({ filename: ':memory:' })),
  Layer.provideMerge(NodeContext.layer),
)

const FreshDbLive = SqliteClient.layer({ filename: ':memory:' }).pipe(
  Layer.provideMerge(NodeContext.layer),
)

/** The pre-0008 stored body shape. See the fixture module for why it is not `Exercise.Encoded`. */
type PreMigrationBody = PreMigrationExercise

const AT = '2020-06-01T00:00:00.000Z'

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

/**
 * Seeds a historical row with direct SQL. `ExercisesRepo.insert` encodes
 * through the domain `Exercise` schema, which refuses the value that this
 * migration removes. The repo's write path therefore cannot make the rows
 * under test. `migration-0007.test.ts` writes its historical shape by hand
 * for the same reason.
 */
const insertRawExercise = (input: {
  readonly id: string
  readonly ownerId: UserId
  readonly body: PreMigrationBody
}) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    yield* sql`INSERT INTO exercises ${sql.insert({
      id: input.id,
      owner_id: input.ownerId,
      body: JSON.stringify(input.body),
      created_at: AT,
      updated_at: AT,
    })}`
  })

type StoredRow = {
  readonly id: string
  readonly owner_id: string
  readonly body: string
  readonly created_at: string
  readonly updated_at: string
}

const readRawRow = (id: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const rows = yield* sql<StoredRow>`SELECT * FROM exercises WHERE id = ${id}`
    return rows[0]
  })

/** The columns, the index names, and the `CREATE TABLE` text of `exercises`. */
const readExercisesShape = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  const columns = yield* sql<{
    readonly name: string
    readonly type: string
    readonly notnull: number
    readonly pk: number
  }>`PRAGMA table_info(exercises)`
  const indexes = yield* sql<{ readonly name: string }>`
    SELECT name FROM sqlite_master
    WHERE type = 'index' AND tbl_name = 'exercises'
    ORDER BY name
  `
  const table = yield* sql<{ readonly sql: string }>`
    SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'exercises'
  `
  return {
    columns: columns.map((column) => ({
      name: column.name,
      type: column.type,
      notnull: column.notnull,
      pk: column.pk,
    })),
    indexes: indexes.map((index) => index.name),
    table: table[0]?.sql,
  }
})

const OWNER_A = 'user-owner-a' as UserId
const OWNER_B = 'user-owner-b' as UserId

/** A row that holds the removed value between two real groups. */
const MIXED_A: PreMigrationBody = {
  name: 'Thruster',
  detail: 'squat to overhead press',
  modality: 'strength',
  muscleGroups: ['chest', 'full-body', 'triceps'],
  equipment: ['barbell'],
  intensity: 'high',
}

/** A control row that never held the removed value. */
const CONTROL_A: PreMigrationBody = {
  name: 'Kettlebell swing',
  modality: 'strength',
  muscleGroups: ['glutes', 'hamstrings', 'back'],
  equipment: ['kettlebell'],
  intensity: 'moderate',
}

/** A row that holds the removed value alone. This is the case that needs the fallback. */
const SOLE_B: PreMigrationBody = {
  name: 'Sprawl + forward jump + back-pedal',
  modality: 'cardio',
  muscleGroups: ['full-body'],
  equipment: [],
  intensity: 'high',
}

/** A second owner's mixed row, so that the proof does not rest on one user. */
const MIXED_B: PreMigrationBody = {
  name: 'Rower',
  modality: 'cardio',
  muscleGroups: ['full-body', 'back'],
  equipment: ['rower'],
  intensity: 'moderate',
}

/**
 * The muscle groups are clean, but the characters `full-body` occur in the
 * name and in the detail. A migration that selected rows by a text match on
 * the body would rewrite this row. The rule reads the muscle-group list, so
 * this row must stay as it is.
 */
const TEXT_DECOY_B: PreMigrationBody = {
  name: 'Full-body burner finisher',
  detail: 'a full-body effort — every round',
  modality: 'strength',
  muscleGroups: ['core', 'quads'],
  equipment: [],
  intensity: 'high',
}

const seedTwoOwners = Effect.gen(function* () {
  yield* insertUser(OWNER_A)
  yield* insertUser(OWNER_B)
  yield* insertRawExercise({ id: 'ex-mixed-a', ownerId: OWNER_A, body: MIXED_A })
  yield* insertRawExercise({ id: 'ex-control-a', ownerId: OWNER_A, body: CONTROL_A })
  yield* insertRawExercise({ id: 'ex-sole-b', ownerId: OWNER_B, body: SOLE_B })
  yield* insertRawExercise({ id: 'ex-mixed-b', ownerId: OWNER_B, body: MIXED_B })
  yield* insertRawExercise({ id: 'ex-decoy-b', ownerId: OWNER_B, body: TEXT_DECOY_B })
})

describe('migration 0008_drop_full_body_from_exercises', () => {
  it.effect('leaves the exercises table shape unchanged — it adds no column and no index', () =>
    Effect.gen(function* () {
      // Read the shape on both sides of 0008. The comparison of the two is
      // the proof that the spec asks for. An assertion made only after the
      // migration cannot fail if the migration adds something.
      yield* migrateThrough0007
      const before = yield* readExercisesShape
      yield* migrateAll
      const after = yield* readExercisesShape

      expect(after).toStrictEqual(before)

      // The shape that 0004 created. This pins what stayed the same.
      expect(after.columns).toStrictEqual([
        { name: 'id', type: 'TEXT', notnull: 0, pk: 1 },
        { name: 'owner_id', type: 'TEXT', notnull: 1, pk: 0 },
        { name: 'body', type: 'TEXT', notnull: 1, pk: 0 },
        { name: 'created_at', type: 'TEXT', notnull: 1, pk: 0 },
        { name: 'updated_at', type: 'TEXT', notnull: 1, pk: 0 },
      ])
      expect(after.indexes).toContain('exercises_owner_id')
    }).pipe(Effect.provide(FreshDbLive)),
  )

  it.effect('a database with no exercise rows migrates without error', () =>
    Effect.gen(function* () {
      yield* migrateThrough0007
      yield* migrateAll

      const sql = yield* SqlClient.SqlClient
      const rows = yield* sql<{ readonly count: number }>`SELECT COUNT(*) AS count FROM exercises`
      expect(rows[0]?.count).toBe(0)
    }).pipe(Effect.provide(FreshDbLive)),
  )

  it.effect(
    'every row of every owner reads back through the real repo decode path, with no full-body survivor',
    () =>
      Effect.gen(function* () {
        yield* migrateThrough0007
        yield* seedTwoOwners

        // 0001–0007 are already recorded — only 0008 actually runs here.
        yield* migrateAll

        const exercisesRepo = yield* ExercisesRepo
        // `listForOwner` ends in `Effect.orDie`. To reach the next line is
        // the proof that the migration was total.
        const ownerA = yield* exercisesRepo.listForOwner(OWNER_A)
        const ownerB = yield* exercisesRepo.listForOwner(OWNER_B)

        expect(ownerA).toHaveLength(2)
        expect(ownerB).toHaveLength(3)

        const all = [...ownerA, ...ownerB]
        for (const entry of all) {
          expect(entry.exercise.muscleGroups).not.toContain('full-body')
          expect(entry.exercise.muscleGroups.length).toBeGreaterThan(0)
        }
      }).pipe(Effect.provide(TestServicesLive)),
  )

  it.effect('the mixed row keeps its two real groups, in their original order', () =>
    Effect.gen(function* () {
      yield* migrateThrough0007
      yield* seedTwoOwners
      yield* migrateAll

      const exercisesRepo = yield* ExercisesRepo
      const ownerA = yield* exercisesRepo.listForOwner(OWNER_A)
      const thruster = ownerA.find((entry) => entry.exercise.name === 'Thruster')

      expect(thruster?.exercise.muscleGroups).toStrictEqual(['chest', 'triceps'])
      // Every other field stays as it was.
      expect(thruster?.exercise.detail).toBe('squat to overhead press')
      expect(thruster?.exercise.modality).toBe('strength')
      expect(thruster?.exercise.equipment).toStrictEqual(['barbell'])
      expect(thruster?.exercise.intensity).toBe('high')
    }).pipe(Effect.provide(TestServicesLive)),
  )

  it.effect('the row that held the value alone holds exactly one group, core', () =>
    Effect.gen(function* () {
      yield* migrateThrough0007
      yield* seedTwoOwners
      yield* migrateAll

      const exercisesRepo = yield* ExercisesRepo
      const ownerB = yield* exercisesRepo.listForOwner(OWNER_B)
      const sprawl = ownerB.find(
        (entry) => entry.exercise.name === 'Sprawl + forward jump + back-pedal',
      )

      expect(sprawl?.exercise.muscleGroups).toStrictEqual(['core'])
    }).pipe(Effect.provide(TestServicesLive)),
  )

  it.effect('a row that never held the value is left byte-for-byte alone', () =>
    Effect.gen(function* () {
      yield* migrateThrough0007
      yield* seedTwoOwners

      const before = yield* readRawRow('ex-control-a')
      yield* migrateAll
      const after = yield* readRawRow('ex-control-a')

      expect(after).toStrictEqual(before)
      expect(after?.body).toBe(JSON.stringify(CONTROL_A))
    }).pipe(Effect.provide(TestServicesLive)),
  )

  it.effect('a row whose name and detail contain the text full-body is not rewritten', () =>
    Effect.gen(function* () {
      yield* migrateThrough0007
      yield* seedTwoOwners

      const before = yield* readRawRow('ex-decoy-b')
      yield* migrateAll
      const after = yield* readRawRow('ex-decoy-b')

      expect(after).toStrictEqual(before)

      const exercisesRepo = yield* ExercisesRepo
      const ownerB = yield* exercisesRepo.listForOwner(OWNER_B)
      const decoy = ownerB.find((entry) => entry.exercise.name === 'Full-body burner finisher')
      expect(decoy?.exercise.muscleGroups).toStrictEqual(['core', 'quads'])
      expect(decoy?.exercise.detail).toBe('a full-body effort — every round')
    }).pipe(Effect.provide(TestServicesLive)),
  )

  it.effect('running the migration twice changes nothing the second time', () =>
    Effect.gen(function* () {
      yield* migrateThrough0007
      yield* seedTwoOwners
      yield* migrateAll

      const sql = yield* SqlClient.SqlClient
      const before = yield* sql<StoredRow>`SELECT * FROM exercises ORDER BY id`

      // The migrator records 0008, so a second run of the migrator does
      // nothing. Apply the module directly instead, to show that the rewrite
      // is idempotent on rows that it already migrated.
      yield* Migration0008
      const after = yield* sql<StoredRow>`SELECT * FROM exercises ORDER BY id`

      expect(after).toStrictEqual(before)
    }).pipe(Effect.provide(TestServicesLive)),
  )

  it.effect(
    "a user seeded with the pre-0008 catalog ends with the shipped seed's muscle groups",
    () =>
      Effect.gen(function* () {
        yield* migrateThrough0007
        yield* insertUser(OWNER_A)

        // The real historical catalog, frozen as a fixture. This is the
        // input that the migration meets on an existing user's server.
        yield* Effect.forEach(
          preMigrationSeed,
          (body, index) =>
            insertRawExercise({ id: `pre-0008-seed-${index}`, ownerId: OWNER_A, body }),
          { discard: true },
        )

        yield* migrateAll

        const exercisesRepo = yield* ExercisesRepo
        const migrated = yield* exercisesRepo.listForOwner(OWNER_A)
        expect(migrated).toHaveLength(seedExercises.length)

        const migratedGroups = new Map(
          migrated.map((entry) => [entry.exercise.name, [...entry.exercise.muscleGroups]]),
        )
        const shippedGroups = new Map(
          seedExercises.map((seed) => [seed.name, [...seed.muscleGroups]]),
        )

        // `Arr.sort`, because `Array#toSorted` needs `lib: es2023`.
        const sorted = (names: Iterable<string>) => Arr.sort([...names], Order.string)
        expect(sorted(migratedGroups.keys())).toStrictEqual(sorted(shippedGroups.keys()))
        for (const [name, groups] of shippedGroups) {
          expect(migratedGroups.get(name), `muscle groups for '${name}'`).toStrictEqual(groups)
        }
      }).pipe(Effect.provide(TestServicesLive)),
  )
})
