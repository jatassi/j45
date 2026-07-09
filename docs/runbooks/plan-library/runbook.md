# plan-library — validation runbook

Replays the runtime probe used to validate `plan-library` (per-user workout
libraries, 12 legacy seeds copied per account). Binding: the
`walking-skeleton` validation runbook every feature inherits.

## Bring-up

- `bun install` (worktree `node_modules` symlinks the repo root; the router
  dependency `@tanstack/react-router` was newly added by this feature — the
  install pulls it in).
- The e2e harness (`e2e/support/global-setup.ts`) is a self-managing probe: it
  runs `bun run --filter '@j45/client' build`, then boots the real server on an
  ephemeral port with a temp SQLite DB (migrations, including `0003_library`,
  run at startup), publishing `E2E_BASE_URL` for the specs. No manual
  `bun run dev` is required for the automated exercise below.

## Exercise (commands run, all exit 0)

- `bun run check` — typecheck all three packages. Exit 0.
- `bun run test` — vitest: 42 files, 154 tests passed. Covers criteria 1–4:
  - `packages/server/test/library/seed-workouts.test.ts` — each of the 12
    frozen seed bodies decodes as `Workout` and compiles to its golden
    (works, total-seconds) pair (criterion 2).
  - `packages/server/test/library/registration-seeding.test.ts` — a fresh DB
    registration creates exactly 12 named workouts atomically; a UsernameTaken
    failure rolls back (user count stays 1, no extra workouts); two accounts
    get distinct-id copies; deleting one leaves the other's 12 intact
    (criterion 1).
  - `packages/server/test/library/migration-0003.test.ts` — migrate through
    0002, insert a user, run 0003: that user's library is backfilled with the
    12 seeds (criterion 3).
  - `packages/server/test/library/workouts-repo.test.ts` — get/rename/delete/
    duplicate against a foreign owner id all fail `WorkoutNotFound`
    (criterion 4).
  - `packages/client/test/router-fallback.test.tsx` — an authenticated
    navigation to `/register?invite=…` (unmatched) redirects to `/`
    (criterion 7).
- `bun run test:e2e` — Playwright, chromium + webkit, 27 passed / 1 skipped
  (the webkit passkey case is chromium-only by design). Covers criteria 5–8:
  - `e2e/library.spec.ts` — after PIN login `/` lists the 12 seeds; Athletica
    detail shows 3 pods, 9 stations, duration `26:45`; Duplicate creates
    `Athletica (copy)`; rename persists across reload; Delete removes it
    (criterion 5). A logged-out `/workouts/<seed id>` shows the login screen,
    PIN login renders that detail without further navigation, `/account`
    reachable via nav (criterion 6).
  - `e2e/auth-register.spec.ts` — registration via `/register?invite=<code>`
    lands on the library home (never blank), the catch-all redirect firing on
    the authenticated-but-unmatched `/register` path (criterion 7).
  - `e2e/glass.spec.ts` — unchanged from `main`; `/glass` still renders
    unauthenticated (criterion 8).
  - `e2e/auth-login.spec.ts`, `auth-passkey.spec.ts`, `auth-admin.spec.ts`,
    `server-info.spec.ts` — pre-existing auth suites pass; edits are navigation
    only (assert the library landing, then `goto /account` before
    AccountScreen-scoped assertions); no auth assertion weakened or removed
    (criterion 8).
- `bun run lint` — oxlint --type-aware. Exit 0.

## Expected observations

- `bun run check`, `bun run test`, `bun run test:e2e`, `bun run lint` each
  exit 0.
- Athletica compiles to 27 works / 1605 s (displayed `26:45`), 3 pods, 9
  stations — matching both the golden table and the rendered detail.
- Registration and the 0003 backfill each produce exactly 12 named seeds
  (Athletica, Romans, Miami Nights, Panthers, Docklands, Red Diamond,
  Crossfire, Hammer, Pipeline, Medusa, SoCal, Apex) with distinct ids per
  account; a foreign workout id is indistinguishable from an absent one
  (`WorkoutNotFound`).

## Teardown

- The e2e `globalTeardown` stops the managed server and removes its temp
  SQLite DB automatically.
- For a manual `bun run dev` session: Ctrl-C the dev process and
  `rm -f data/j45.dev.sqlite` to reset local state.
