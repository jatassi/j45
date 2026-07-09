import { SqlClient } from '@effect/sql'
import type { UserId } from '@j45/domain'
import * as Effect from 'effect/Effect'

import { WorkoutsRepo } from '../src/library/workouts-repo.js'

/**
 * plan-library's persistence — one `workouts` table
 * (`docs/designs/plan-library/design.md`'s "Data model" section). Each row
 * is a `LibraryWorkout`: the body is the Schema-encoded `Workout` (JSON);
 * the name lives only inside `body`, no denormalized column.
 * `workouts_owner_id` speeds every ownership-scoped query the repo runs.
 *
 * Backfill: every account that predates this migration gets seeded here —
 * through `WorkoutsRepo.seedForUser`, the exact same path a brand-new
 * registration uses, so there is exactly one seed-insertion code path in
 * the whole codebase (`workouts-repo.ts`'s module doc). `WorkoutsRepo`
 * itself only needs `SqlClient.SqlClient`, so providing its layer here
 * keeps this migration's own required environment at `SqlClient.SqlClient`
 * — same as every other migration in this directory.
 */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  const workoutsRepo = yield* WorkoutsRepo

  yield* sql`CREATE TABLE workouts (
    id          TEXT PRIMARY KEY,
    owner_id    TEXT NOT NULL REFERENCES users(id),
    body        TEXT NOT NULL,
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
  )`

  yield* sql`CREATE INDEX workouts_owner_id ON workouts(owner_id)`

  const users = yield* sql<{ readonly id: string }>`SELECT id FROM users`
  yield* Effect.forEach(users, (user) => workoutsRepo.seedForUser(user.id as UserId), {
    discard: true,
  })
}).pipe(Effect.provide(WorkoutsRepo.Default))
