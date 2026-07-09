import { SqlClient } from '@effect/sql'
import type { UserId } from '@j45/domain'
import * as Effect from 'effect/Effect'

import { ExercisesRepo } from '../src/library/exercises-repo.js'

/**
 * exercise-library's persistence — one `exercises` table
 * (`docs/designs/exercise-library`). Each row is a `LibraryExercise`: the
 * body is the Schema-encoded `Exercise` (JSON); the name lives only inside
 * `body`, no denormalized column. `exercises_owner_id` speeds every
 * ownership-scoped query the repo runs.
 *
 * Backfill: every account that predates this migration gets seeded here —
 * through `ExercisesRepo.seedForUser`, the exact same path a brand-new
 * registration uses, so there is exactly one seed-insertion code path in
 * the whole codebase (`exercises-repo.ts`'s module doc). `ExercisesRepo`
 * itself only needs `SqlClient.SqlClient`, so providing its layer here
 * keeps this migration's own required environment at `SqlClient.SqlClient`
 * — same as every other migration in this directory.
 */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  const exercisesRepo = yield* ExercisesRepo

  yield* sql`CREATE TABLE exercises (
    id          TEXT PRIMARY KEY,
    owner_id    TEXT NOT NULL REFERENCES users(id),
    body        TEXT NOT NULL,
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
  )`

  yield* sql`CREATE INDEX exercises_owner_id ON exercises(owner_id)`

  const users = yield* sql<{ readonly id: string }>`SELECT id FROM users`
  yield* Effect.forEach(users, (user) => exercisesRepo.seedForUser(user.id as UserId), {
    discard: true,
  })
}).pipe(Effect.provide(ExercisesRepo.Default))
