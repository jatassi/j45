# Release v1.1

- **Date:** 2026-08-23
- **Tag:** `v1.1` = `beb426c` ("glass: size the refraction layer to the surface,
  not its drawing buffer")
- **Outcome:** deployed and verified — `https://j45.atassi.org/healthz` returns
  200 serving the released SHA; app root 200 through Caddy + TLS. The
  post-receive hook's own SHA gate passed on the first push (no hook fixes
  needed this time).
- **Rollback pointer:** `git push -f deploy v1:main` (`v1` = `d417434`).

## Features

None. Every node in the feature graph was already `shipped` at v1, and the four
remaining nodes (`exercise-animations`, `public-multi-tenancy`, `llm-generation`,
`per-exercise-tracking`) are still `proposed` — so no status flips and no
`fix-<slug>` nodes to prune. This is a polish release over the v1 feature set:
nine commits of interactive UI and dev-ergonomics work, which is why it takes a
point version rather than v2.

Released commits (`v1..v1.1`, 61 files changed, +1278 / -351):

- `804cb96` dev: API-only backend in dev, LAN-exposed vite, one launch entry
- `f3d3455` login screen updates
- `a95cc32` update live session page design
- `64b6f07` live session: rolling countdown digits, urgency colours, dot pulse,
  backdrop resize fix
- `478dfab` auth: allow dev LAN origins past the CSRF guard, surface unexpected
  login/register failures
- `4bd6aeb` player: track iOS Safari's toolbar — dvh + visualViewport sizing,
  seamless backdrop
- `7cbd4d5` player: wrap the station-map dots on narrow screens
- `1670d10` player: tighten session layout so everything fits without scroll
- `beb426c` glass: size the refraction layer to the surface, not its drawing
  buffer

## Ready checks

At the pinned tip `beb426c`, working tree clean:

- `bun run check` — exit 0 (domain, server, client).
- `bun run test` — 93 files, 510 tests passed.
- `bun run test:e2e` — 87 passed, 5 skipped (the chromium-only two-context
  live-session and passkey specs correctly skipping under webkit).
- `bun run lint` — exit 0, with the one standing `no-console` warning at
  `packages/client/src/glass/scene.ts:199` (design-mandated, warn-level).

The first `bun run test` run failed one file — `packages/client/test/vite-proxy.test.ts`
with `EADDRINUSE` on port 3000, because a local `bun run dev` server held the
port. Environmental, not a code failure: the re-run after that process stopped
was fully green. Worth noting for future releases — run the ready checks with no
dev server up.

## Validation procedures replayed

The three whose features this release's commits touch — `player-screens`,
`glass-live-refraction`, `auth-screens`. All three are suite-bound: every
criterion's backing spec passed inside the `test:e2e` run above, and the
`auth-screens` criterion-4 static check (no bare `<input>` outside `ui/`) still
returns no matches. The other ten procedures cover code untouched since v1 and
were not replayed.
