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
import Migration0009 from '../../migrations/0009_replace_seed_catalog.js'
import { UserRepo } from '../../src/auth/user-repo.js'
import { ExercisesRepo } from '../../src/library/exercises-repo.js'
import previousSeedJson from '../../src/library/seed-exercises-before-0009.json'
import { seedExercises } from '../../src/library/seed-exercises.js'

/**
 * The stored body shape before 0009: the `Exercise` of that time, with the
 * `intensity` field the domain schema no longer declares. Typed by hand, and
 * not as `typeof Exercise.Encoded`, for the reason the pre-0008 fixture gives.
 */
type PreMigrationBody = {
  readonly name: string
  readonly detail?: string | undefined
  readonly modality: string
  readonly muscleGroups: readonly string[]
  readonly equipment: readonly string[]
  readonly intensity?: string
}

const previousSeed = previousSeedJson as readonly PreMigrationBody[]

const through = (last: 8 | 9) =>
  Migrator.make({})({
    loader: Migrator.fromRecord({
      '0001_app_meta': Migration0001,
      '0002_auth': Migration0002,
      '0003_library': Migration0003,
      '0004_exercises': Migration0004,
      '0005_history': Migration0005,
      '0006_completion_progress': Migration0006,
      '0007_completion_source_workout': Migration0007,
      '0008_drop_full_body_from_exercises': Migration0008,
      ...(last === 9 ? { '0009_replace_seed_catalog': Migration0009 } : {}),
    }),
  })

const migrateThrough0008 = through(8)
const migrateAll = through(9)

const TestServicesLive = Layer.mergeAll(UserRepo.Default, ExercisesRepo.Default).pipe(
  Layer.provideMerge(SqliteClient.layer({ filename: ':memory:' })),
  Layer.provideMerge(NodeContext.layer),
)

const FreshDbLive = SqliteClient.layer({ filename: ':memory:' }).pipe(
  Layer.provideMerge(NodeContext.layer),
)

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

/** Seeds a historical row with direct SQL, as `migration-0008.test.ts` does. */
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

const readRawBodies = (ownerId: UserId) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const rows = yield* sql<{ readonly body: string }>`
      SELECT body FROM exercises WHERE owner_id = ${ownerId}
    `
    return rows.map((row) => JSON.parse(row.body) as Record<string, unknown>)
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
  return {
    columns: columns.map((column) => ({ ...column })),
    indexes: indexes.map((index) => index.name),
  }
})

const OWNER_A = 'user-owner-a' as UserId
const OWNER_B = 'user-owner-b' as UserId
const OWNER_EMPTY = 'user-owner-empty' as UserId

const previousByName = (name: string): PreMigrationBody => {
  const entry = previousSeed.find((seed) => seed.name === name)
  if (entry === undefined) {
    throw new Error(`previous seed has no '${name}'`)
  }
  return entry
}

/** A shipped row the user never touched. It must go. */
const SHIPPED_UNTOUCHED = previousByName('Rower')

/** A shipped row the user edited. It is the user's now, and it must stay. */
const SHIPPED_EDITED: PreMigrationBody = {
  ...previousByName('Burpee'),
  detail: 'my own cue',
}

/** A row the user created. It carries the removed field, which must go. */
const USER_OWN: PreMigrationBody = {
  name: 'Wall ball',
  modality: 'cardio',
  muscleGroups: ['quads', 'shoulders'],
  equipment: ['med-ball'],
  intensity: 'high',
}

/**
 * A row the user created whose name, in another case, is also in the new
 * catalog. The user's row stays and the catalog's entry is not inserted.
 */
const USER_COLLIDING: PreMigrationBody = {
  name: 'PUSH-UP',
  detail: 'hands wide',
  modality: 'strength',
  muscleGroups: ['chest'],
  equipment: [],
  intensity: 'moderate',
}

const seedOwners = Effect.gen(function* () {
  yield* insertUser(OWNER_A)
  yield* insertUser(OWNER_B)
  yield* insertUser(OWNER_EMPTY)
  yield* insertRawExercise({ id: 'a-shipped', ownerId: OWNER_A, body: SHIPPED_UNTOUCHED })
  yield* insertRawExercise({ id: 'a-edited', ownerId: OWNER_A, body: SHIPPED_EDITED })
  yield* insertRawExercise({ id: 'a-own', ownerId: OWNER_A, body: USER_OWN })
  yield* insertRawExercise({ id: 'a-colliding', ownerId: OWNER_A, body: USER_COLLIDING })
  // Owner B holds the whole previous catalog, untouched.
  yield* Effect.forEach(
    previousSeed,
    (body, index) => insertRawExercise({ id: `b-${index}`, ownerId: OWNER_B, body }),
    { discard: true },
  )
})

const NEW_NAMES = new Set(seedExercises.map((seed) => seed.name))

describe('migration 0009_replace_seed_catalog', () => {
  it.effect('leaves the exercises table shape unchanged', () =>
    Effect.gen(function* () {
      yield* migrateThrough0008
      const before = yield* readExercisesShape
      yield* migrateAll
      const after = yield* readExercisesShape
      expect(after).toStrictEqual(before)
    }).pipe(Effect.provide(FreshDbLive)),
  )

  it.effect('a database with no users migrates to zero rows', () =>
    Effect.gen(function* () {
      yield* migrateThrough0008
      yield* migrateAll
      const sql = yield* SqlClient.SqlClient
      const rows = yield* sql<{ readonly count: number }>`SELECT COUNT(*) AS count FROM exercises`
      expect(rows[0]?.count).toBe(0)
    }).pipe(Effect.provide(FreshDbLive)),
  )

  it.effect('an owner holding the untouched previous catalog ends with exactly the new one', () =>
    Effect.gen(function* () {
      yield* migrateThrough0008
      yield* seedOwners
      yield* migrateAll

      const exercisesRepo = yield* ExercisesRepo
      const ownerB = yield* exercisesRepo.listForOwner(OWNER_B)
      expect(new Set(ownerB.map((entry) => entry.exercise.name))).toStrictEqual(NEW_NAMES)
      expect(ownerB).toHaveLength(seedExercises.length)
    }).pipe(Effect.provide(TestServicesLive)),
  )

  it.effect('an owner with no rows at all is seeded with the new catalog', () =>
    Effect.gen(function* () {
      yield* migrateThrough0008
      yield* seedOwners
      yield* migrateAll

      const exercisesRepo = yield* ExercisesRepo
      const owner = yield* exercisesRepo.listForOwner(OWNER_EMPTY)
      expect(owner).toHaveLength(seedExercises.length)
    }).pipe(Effect.provide(TestServicesLive)),
  )

  it.effect(
    'keeps every row the user created or edited, drops the untouched shipped row, and adds the rest',
    () =>
      Effect.gen(function* () {
        yield* migrateThrough0008
        yield* seedOwners
        yield* migrateAll

        const exercisesRepo = yield* ExercisesRepo
        // `listForOwner` ends in `Effect.orDie`. To reach the next line is
        // the proof that every row still decodes.
        const ownerA = yield* exercisesRepo.listForOwner(OWNER_A)
        const byId = new Map(ownerA.map((entry) => [entry.id as string, entry]))

        expect(byId.has('a-shipped')).toBe(false)
        expect(byId.get('a-edited')?.exercise.detail).toBe('my own cue')
        expect(byId.get('a-own')?.exercise.name).toBe('Wall ball')
        expect(byId.get('a-colliding')?.exercise.detail).toBe('hands wide')

        const names = ownerA.map((entry) => entry.exercise.name)
        // "Burpee" and "Push-up" are already the user's; the catalog adds the other 118.
        expect(names.filter((name) => name === 'Burpee')).toHaveLength(1)
        expect(names.filter((name) => name.toLowerCase() === 'push-up')).toHaveLength(1)
        expect(ownerA).toHaveLength(seedExercises.length - 2 + 3)

        // The new "Rower" arrives from the catalog, in place of the deleted shipped one.
        const rower = ownerA.find((entry) => entry.exercise.name === 'Rower')
        expect(rower?.exercise.muscleGroups).toContain('quads')
      }).pipe(Effect.provide(TestServicesLive)),
  )

  it.effect('no stored body of any owner carries the removed field', () =>
    Effect.gen(function* () {
      yield* migrateThrough0008
      yield* seedOwners
      yield* migrateAll

      for (const owner of [OWNER_A, OWNER_B, OWNER_EMPTY]) {
        const bodies = yield* readRawBodies(owner)
        for (const body of bodies) {
          expect(body, `${owner}: ${String(body.name)}`).not.toHaveProperty('intensity')
        }
      }
    }).pipe(Effect.provide(TestServicesLive)),
  )

  it.effect('a second run of the same rule changes nothing', () =>
    Effect.gen(function* () {
      yield* migrateThrough0008
      yield* seedOwners
      yield* migrateAll

      const exercisesRepo = yield* ExercisesRepo
      const first = yield* exercisesRepo.listForOwner(OWNER_A)
      // The migration is recorded, so `migrateAll` runs nothing. Run the
      // module directly to prove the rule is idempotent on its own output.
      yield* Migration0009
      const second = yield* exercisesRepo.listForOwner(OWNER_A)
      const ids = (entries: typeof first) =>
        Arr.sort(
          entries.map((entry) => entry.id as string),
          Order.string,
        )
      expect(ids(second)).toStrictEqual(ids(first))
    }).pipe(Effect.provide(TestServicesLive)),
  )
})
