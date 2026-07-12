# nav-shell — validation procedure

Run against the integration worktree (`loop/nav-shell`,
`loop/nav-shell--shell-components`, `loop/nav-shell--screen-moves`,
`loop/nav-shell--route-restructure`, `loop/nav-shell--route-fixups`,
`loop/nav-shell--nav-shell-e2e`, `loop/nav-shell--e2e-landing-swaps`,
`loop/nav-shell--e2e-ia-migration`, `loop/nav-shell--tab-clearance` merged onto
`redesign`), per the walking-skeleton validation-procedure binding.

## Bring-up

`bun install` (no changes — lockfile already satisfied), then `bun run dev` at
the repo root. Confirmed both `curl http://localhost:3000/healthz` (server) and
`curl http://localhost:5173/healthz` (Vite dev proxy to :3000) return 200 with
`{"sha":"dev","version":"0.0.0"}`, and the client index at
`http://localhost:5173/` returns 200. `bun run test:e2e`'s Playwright
global-setup boots its own ephemeral server independently for the browser
criteria — a second, automated bring-up covering criteria 1-4 and 6.

## Exercise

- **Criterion 1** (four glass tabs + avatar chip): `e2e/nav-shell.spec.ts`
  test 1 logs in as owner, asserts the four tabs (`tab-home`, `tab-library`,
  `tab-generate`, `tab-history`) visible, taps each and asserts the URL lands on
  `/`, `/library`, `/generate`, `/history` with exactly the active tab carrying
  both `aria-current="page"` and `data-active="true"` (all others neither), and
  the `avatar-chip` opens `/account`. Ran `bun run test:e2e` — passes on
  chromium and webkit.
- **Criterion 2** (Library IA + redirects): `e2e/nav-shell.spec.ts` test 2
  asserts `/library` renders `workout-list` with cards and the Workouts segment
  active; the Exercises segment navigates to `/library/exercises` with
  `exercise-library-screen` and Library tab still active; `/exercises` redirects
  to `/library/exercises`; an unmatched `/no-such-route` redirects to `/`.
  `e2e/exercises.spec.ts` and `e2e/library.spec.ts` cover the full CRUD stack
  through the new IA (12 seed workouts at `/library`, 96 seed exercises via the
  segment). Ran `bun run test:e2e` — all pass on chromium and webkit.
- **Criterion 3** (push routes, no tab bar, back affordance): `e2e/nav-shell.spec.ts`
  test 3 opens `/workouts/<id>/edit`, `/workouts/<id>/reflow`, `/workouts/new`,
  `/timer`, `/account`, and `/session/<id>` and for each asserts zero tab bar /
  avatar chrome and a visible `back-button` that returns to the prior screen;
  it also asserts `/workouts/<id>` (detail) keeps the tab layout with Library
  active. Ran `bun run test:e2e` — passes on chromium and webkit.
- **Criterion 4** (interim home + glass tiers): `e2e/nav-shell.spec.ts` test 4
  asserts `home-screen` with `home-timer-link` → `/timer` and
  `home-new-workout-link` → `/workouts/new`, the `active-sessions-strip` appears
  after a live session starts, and the `.glass-surface` wrapping the tab bar and
  the app header each expose `data-glass-tier` matching `^(css|refract)$`. Ran
  `bun run test:e2e` — passes on chromium and webkit.
- **Criterion 5** (wordmark + LibraryNav deletion): read
  `packages/client/src/components/wordmark.tsx` (upright Geist-black lockup,
  white `J` + `text-primary` `45`) consumed by `AppHeader`, exercised by
  `packages/client/test/app-header.test.tsx`. Confirmed `LibraryNav` (the old
  header text-link nav, formerly inline in `library-screen.tsx`) is gone —
  `grep -rn LibraryNav packages/` returns nothing. Ran `bun run test` — the
  shell suites (`tab-bar`, `app-header`, `push-header`) pass.
- **Criterion 6** (toolchain gates): ran `bun run check` (exit 0 across
  domain/server/client), `bun run lint` (oxlint --type-aware, exit 0 — one
  pre-existing `no-console` warning in `glass/scene.ts`, outside this diff; diff
  scanned for `eslint-disable`/`oxlint-disable` and `.oxlintrc.json` edits —
  none), `bun run test` (433/433 passed), `bun run test:e2e` (71 passed, 3
  skipped — chromium-only passkey/live-session specs skipped on webkit by
  design, unrelated to this feature).

## Expected observations

All of the above matched: four tabs derive active state from the matched
route's group (exact `/` → Home; `/library*` and `/workouts*` → Library), the
avatar chip and every push route leave the tab IA with a working back
affordance, the workout list moved to `/library` with the Exercises segment and
the `/exercises`→`/library/exercises` and catch-all→`/` redirects both firing,
the interim home exposes the timer / new-workout quick actions and the
active-sessions strip, both chrome surfaces expose `data-glass-tier`, the J45
wordmark renders white-J/orange-45, and `LibraryNav` is deleted. No lint
suppressions, no weakened tests (the one removed test block asserted the deleted
`LibraryNav`'s home history link; `HistoryScreen` interior coverage is
preserved), no config edits found in the diff.

## Teardown

Killed the `bun run dev` process; removed `data/j45.dev.sqlite` to reset local
state (Playwright's own server manages its state independently and cleans up
after `test:e2e`). Worktree left clean (`git status` verified clean).

## Verification runs (independent, by the validating agent)

Run in the integration worktree after merging all nine branches and removing
the plan artifact, on a clean tree:

- `bun run check` — exit 0 (domain, server, client)
- `bun run lint` — exit 0 (oxlint --type-aware)
- `bun run test` — 433 passed (433)
- `bun run test:e2e` — 71 passed, 3 skipped (chromium + webkit), including all
  four `e2e/nav-shell.spec.ts` cases plus the IA-migrated `library`,
  `exercises`, `generate`, `history`, `timer`, `plan-editing`, and auth specs,
  on both browser projects
