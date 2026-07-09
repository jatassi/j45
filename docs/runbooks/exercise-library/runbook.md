# exercise-library — validation runbook

Replays the runtime probe used to validate `exercise-library` (a first-class,
per-user tagged exercise catalog seeded from program content). Binding: the
`walking-skeleton` validation runbook every feature inherits.

## Bring-up

- `bun install` (worktree `node_modules` symlinks the repo root; no new
  top-level dependency was added by this feature).
- The e2e harness (`e2e/support/global-setup.ts`) is a self-managing probe: it
  runs `bun run --filter '@j45/client' build`, then boots the real server on
  an ephemeral port with a temp SQLite DB (migrations, including
  `0004_exercises`, run at startup), registers the owner, and mints
  per-project invites — including `exercisesInvitesByProject` for
  `e2e/exercises.spec.ts` — publishing `E2E_*` env for the specs. No manual
  `bun run dev` is required for the automated exercise below.

## Exercise (commands run, all exit 0)

- `bun run check` — typecheck all three packages (`@j45/domain`,
  `@j45/server`, `@j45/client`). Exit 0.
- `bun run lint` — `oxlint --type-aware`. Exit 0. The diff has no
  `eslint-disable`/`oxlint-disable`, no lint-config edits, and no `.only`.
- `bun run test` — vitest: 54 files, 219 tests passed. Covers criteria 1–4:
  - `packages/server/test/library/seed-exercises.test.ts` (6 tests) — every
    seed entry decodes as `Exercise`; names are unique case-insensitively;
    the catalog has ≥ 80 entries (actual 96); every `MuscleGroup` and
    `Equipment` literal is used by at least one entry; `Rower`
    (cardio, equipment `rower`), `Barbell front squat` (strength, equipment
    `barbell`), and `Burpee` (empty equipment) spot-checks (criterion 1).
    Independently re-verified against `seed-exercises.json`: 96 unique
    names, 11/11 muscle groups used, 16/16 equipment literals used, and the
    three spot-check entries match.
  - `packages/server/test/library/registration-seeding.test.ts` (2 tests) —
    `Accounts.register` seeds the user row, 12 workouts, and the full
    exercise catalog inside one `sql.withTransaction`; an unknown invite or
    `UsernameTaken` collision rolls back all three (zero users, zero
    workouts, zero exercises); two accounts get distinct-id copies of both
    catalogs; deleting a workout/exercise from one account leaves the
    other's catalog untouched (criterion 2).
  - `packages/server/test/library/migration-0004.test.ts` (3 tests) — the
    `exercises` table (`id`/`owner_id REFERENCES users(id)`/`body`/
    `created_at`/`updated_at`) and its `exercises_owner_id` index; migrating
    through 0003 only, inserting a user, then running 0004 backfills that
    user's catalog with exactly `seedExercises`' names/ids; a zero-user
    database backfills nothing (criterion 3).
  - `packages/server/test/library/exercise-handlers.test.ts` (2 tests, via
    `RpcTest`) — `ListExercises` returns only the caller's rows, sorted
    case-insensitively by name; `UpdateExercise`/`DeleteExercise` against
    another owner's or an unknown exercise id each fail `ExerciseNotFound`,
    and the foreign row is left untouched (criterion 4). Mirrored at the
    repo layer in `exercises-repo.test.ts`.
  - `packages/domain/test/exercise.test.ts`,
    `packages/client/test/exercise-library-screen.test.tsx` — domain
    schema round-trip and the client list/filter/create surface.
- `bun run test:e2e` — Playwright, chromium + webkit: 37 passed / 1 skipped
  (the webkit passkey case is chromium-only by design). Exit 0. Covers
  criterion 5:
  - `e2e/exercises.spec.ts` (chromium + webkit) — registers its own account
    via a pre-minted `exercisesInvitesByProject` invite; from the library
    home, `exercises-nav-link` reaches `/exercises` and lists the 96 seeded
    exercises; the `filter-muscle-calves` chip narrows the list to 7;
    creating an exercise with tags shows it in the list and it persists
    across a reload; editing its muscle tags persists across a reload;
    Delete removes it and restores the count to 96.
  - Pre-existing suites (`library`, `auth-*`, `timer`, `plan-editing`,
    `glass`, `server-info`) all still pass — `global-setup.ts`'s only change
    is minting an additional, independent invite pool, so no spec races
    another for a code and no existing auth assertion was weakened.

## Expected observations

- `bun run check`, `bun run test`, `bun run test:e2e`, `bun run lint` each
  exit 0.
- The seed catalog has exactly 96 entries; registration and the 0004
  migration each produce a full private copy with fresh ids per owner.
- `ListExercises` is ownership-scoped and case-insensitive name-sorted; a
  foreign or unknown exercise id is indistinguishable (`ExerciseNotFound`).
- UI path: home nav → full catalog → muscle-group filter → create/edit/
  delete, each with reload durability, on both chromium and webkit.

## Teardown

- The e2e `globalTeardown` stops the managed server and removes its temp
  SQLite DB and state file automatically.
- For a manual `bun run dev` session: Ctrl-C the dev process and
  `rm -f data/j45.dev.sqlite` to reset local state.
