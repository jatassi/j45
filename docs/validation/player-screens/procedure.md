# Validation procedure — player-screens

Replayable record of the independent validation pass for the immersive session
player and manual timer. Inherits the `walking-skeleton` binding contract.

## Bring-up

- `bun install` (repo root) — 550 installs, no changes; clean.
- The exercise commands below each manage their own server: `test:e2e`
  (Playwright `global-setup.ts`) boots a built client + server and mints its own
  invite codes, so no separate `bun run dev` was needed to observe the criteria.
  For manual bring-up: `bun run dev` (server :3000, Vite :5173 proxying `/rpc` +
  `/healthz`).

## Exercise / expected observations

Run from the integration worktree.

- `bun run check` → exit 0. domain/server/client all typecheck.
- `bun run lint` → exit 0. One pre-existing `no-console` warning in
  `src/glass/scene.ts` (outside this feature's diff); no new suppressions.
- `bun run test` → 90 files, 460 tests passed. Includes the new player-kit unit
  suites (`player-progress-arc`, `player-control-dock`, `player-phase-backdrop`)
  and the reworked `session-screen` / `timer-screen` suites.
- `bun run test:e2e` (chromium + webkit) → 71 passed, 3 skipped. The 3 skips are
  the chromium-only specs (auth-passkey, the two-context live-session) correctly
  skipping under the webkit project via `test.skip(browserName !== 'chromium')`.

Per-criterion observable behavior, exercised by the e2e suite:

1. `live-session.spec.ts` — two logged-in contexts land on the same segment;
   `session-count` renders inside `player-progress-arc`; the `session-screen`
   root's `data-phase` tracks ready→work→rest as it advances; B's pause shows
   `Paused` on A; `session-next-up` names the following work station
   (`Sandbag/dumbbell clean`). PASS.
2. `live-session.spec.ts` — `session-leave` opens `session-leave-dialog`;
   confirm lands the leaver on `home-screen` while B keeps running with A gone
   from `session-participants`; done state offers `session-finish` with no
   confirm; both participants' History tab shows the Apex row. PASS.
3. `live-session.spec.ts` (+ timer) — Start/join tap sets `data-audio="on"`;
   `__beepCount` increases across a Skip transition; `__wakeLockAcquired` true
   while running, false + release count ≥1 on pause; instrumented assertions
   preserved verbatim. PASS.
4. `live-session.spec.ts` — `[data-slot="exercise-demo"]` present and visible on
   the player; renders "Form guide coming soon" placeholder when the seed
   exercise has no `detail` (does not look broken empty). PASS.
5. `timer.spec.ts` (chromium + webkit) — idle composes `work/rest/rounds` from
   ui/ fields (`data-slot="field"` / `"input"`, no native number rows); a 5/0/2
   run advances ready→work→work→Done with `timer-context` round indicator; Pause
   freezes `timer-count`, Resume continues, Reset returns to idle; Start unlocks
   audio. PASS.
6. Static/structural — `git diff` touches no `src/player/` kit file and adds no
   rpc or migration; no session imports under `src/components/player/`. PASS.
7. `check` / `test` / `test:e2e` all exit 0. PASS.

## Teardown

- Playwright tears down its managed server automatically at suite end.
- For manual runs: Ctrl-C the dev process; `rm -f data/j45.dev.sqlite` to reset
  local state.
