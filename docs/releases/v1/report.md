# Release v1

- **Date:** 2026-07-13
- **Tag:** `v1` = `d417434` ("deploy: run the client build with --bun in the push hook")
- **Outcome:** deployed and verified — `https://j45.atassi.org/healthz` returns 200
  serving the released SHA; `j45` systemd user unit active; app root 200 through
  Caddy + TLS.
- **Rollback pointer:** none — first release. Rollback for this release is stopping
  the `j45` unit (the URL returns to Caddy's 502); from v2 onward it is
  `git push -f deploy v1:main`.

## Features (23 — the full validated set)

walking-skeleton, workout-domain, auth-accounts, plan-library, live-session,
plan-editing, flow-control, session-history, exercise-library,
workout-generation, manual-timer, liquid-glass-ui, design-system,
glass-live-refraction, nav-shell, session-leave, home-dashboard,
library-screens, editor-screens, player-screens, generate-screen, auth-screens,
secondary-screens

No `fix-<slug>` nodes in this release; nothing pruned from the graph.

## Notes

First release, so this run also completed the one-time VPS bootstrap from
`deploy/README.md` (bare repo + hook, systemd user unit, `deploy` remote; the
Caddy site block and `/opt/j45` had been prepared by hand, with the pending
`systemctl reload caddy` run at release time). Two deploy-hook fixes were found
and shipped by the failed first pushes — both keep the pipeline's "Bun only, no
system node" premise honest:

- `bun install --frozen-lockfile --ignore-scripts` — better-sqlite3 (dev-only
  node test driver) has no business native-building on the VPS (`e067d4b`).
- `bun run --bun build` — vite's `#!/usr/bin/env node` shebang must not resolve
  to the deploy box's system node 18 (`d417434`).

Ready checks: `check` + `test` (350 tests) + `test:e2e` (87 passed / 5
documented webkit skips) green at the released tip; all 13 validation
procedures replayed (suite-bound criteria plus the static no-native-inputs /
no-suppression / deleted-files checks). Two e2e timing flakes were fixed en
route (`09d285e`).
