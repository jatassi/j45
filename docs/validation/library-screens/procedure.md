# Validation procedure — library-screens

Replays the inherited `walking-skeleton` validation contract against the
integrated Library-tab interiors (workout list, exercises catalog segment,
workout detail). All acceptance evidence comes from the managed Playwright
stack (`bun run test:e2e`), which brings up its own server + seeded SQLite.

## Bring-up

```sh
bun install
bun run test:e2e   # Playwright manages its own server (chromium + webkit)
```

For manual exploration: `bun run dev` (server :3000, Vite client :5173).

## Exercise + expected observations

Full gate — all three exit 0:

- `bun run check` — typecheck across domain/server/client. Observed: exit 0.
- `bun run test` — vitest. Observed: 87 files, 445 tests passed, exit 0.
  Includes `library-screen.test.tsx` "contains no native select or bare
  input elements", drawer create/edit/delete + toast unit coverage.
- `bun run test:e2e` — Playwright chromium + webkit. Observed: 71 passed,
  3 skipped (chromium-only live-session/passkey on webkit), exit 0.

Per-criterion observable behavior (all exercised by the e2e specs above):

1. `library.spec.ts` — `/library` renders 12 workout cards; each carries a
   non-empty `workout-focus-<id>` badge and a `workout-summary-<id>` matching
   `/\d+ works · \d+:\d{2}/`; clicking the Athletica card opens
   `workout-detail-screen`.
2. `exercises.spec.ts` — `/library/exercises` lists 96 seed exercises; the
   `filter-muscle-calves` toggle-group chip narrows to a proper subset; domain
   labels (Full body / Med ball / Jump rope) render and raw kebab literals do
   not; create via `exercise-drawer` persists a reload; editing tags
   (quads→chest) persists a reload; delete behind `delete-dialog`
   (alert-dialog) removes the row; a forced `CreateExercise` WebSocket failure
   surfaces a `[data-sonner-toast]`.
3. `library.spec.ts` + `flow-control.spec.ts` — detail shows `Start`
   (dominant, filled) plus `start-with-reflow-button`; the reflow launch flow
   is exercised; rename via `rename-dialog` persists a reload; `Duplicate`
   creates "Athletica (copy)"; delete behind `delete-dialog` returns to
   `/library`; Athletica shows 3 pods, 9 stations, 26:45.
4. `library.spec.ts` — a logged-out visit to `/workouts/<seed id>` shows
   `login-screen`; completing PIN login renders that workout's detail with no
   further navigation.
5. Static + `library-screen.test.tsx` — the three screens contain no native
   `<select>` / bare `<input>` (controls compose from `@/components/ui/*`);
   `exercise-dialogs.tsx` is deleted.

## Teardown

Ctrl-C the dev process if started manually; `rm -f data/j45.dev.sqlite` to
reset local state. The e2e harness tears down its own managed server.
