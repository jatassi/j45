# Validation procedure — home-dashboard

Replays the acceptance evidence for the action-first Home dashboard. Commands
are the walking-skeleton binding contract every feature inherits.

## Bring-up

- `bun install`
- Static exercise checks run their own managed server; for interactive
  inspection: `bun run dev` at repo root (server on :3000, Vite on :5173
  proxying `/rpc` ws + `/healthz`).

## Exercise

Run from the integration worktree:

- `bun run check` — typecheck all packages. Expect exit 0.
- `bun run test` — vitest unit/integration. Expect exit 0
  (472 tests). Covers `lib/home` pick/resolve/recent logic
  (`home-data.test.ts`), the hero variants + skeleton + toast path
  (`home-hero.test.tsx`), and the screen composition (`home-screen.test.tsx`).
- `bun run lint` — oxlint. Expect exit 0 (one pre-existing `no-console`
  warning in `glass/scene.ts`, unrelated to this feature; not an error).
- `bun run test:e2e` — Playwright chromium + webkit against a server it
  manages. Expect exit 0 (78 passed, 4 chromium-only tests skipped on webkit).

### Per-criterion observations (all observed by the Validate agent)

1. **Live join (chromium, two contexts)** —
   `home.spec.ts:242`. A starts a seed Apex session; within the 5s poll,
   B's `home-hero` names the workout ("Apex") and A as host; a single tap on
   the session card lands B on `/session/<id>` where `session-phase` and
   `session-context` match A's. Passed (~6.5s). Webkit variant skipped by
   design (two-context live join is chromium-only, matching
   `live-session.spec.ts`).
2. **Start-last / browse fallback (chromium + webkit)** —
   `home.spec.ts:319` finishes an Apex session, then the hero shows
   "Start last" with "Apex" and `hero-start` opens a new `/session/<id>`;
   `home.spec.ts:299` registers a fresh account, the browse-fallback hero
   shows "From your library" with a `hero-browse-link`, and the recent list
   renders exactly 5 library-padded rows — the fold is never empty. Both
   passed on both browsers.
3. **Quick-start tiles** — `home.spec.ts:195` clicks each tile and asserts
   `/timer`, `/generate`, `/workouts/new`. Passed on both browsers.
4. **Failure + skeletons** — `home.spec.ts:195` holds rpc responses and
   asserts `home-hero-skeleton` + `home-recent-skeleton` render before
   resolve; a websocket-intercepted `StartSession` failure surfaces a
   "Could not start session" sonner toast while the page stays at `/` and the
   recent-start button stays enabled (dashboard interactive). Passed on both.
5. **Green gates** — `bun run check`, `bun run test`, `bun run test:e2e` all
   exit 0 (also `bun run lint` exit 0).

## Teardown

- Ctrl-C the dev process if started.
- `rm -f data/j45.dev.sqlite` to reset local state (e2e manages its own
  temp DB and tears it down in globalTeardown).
