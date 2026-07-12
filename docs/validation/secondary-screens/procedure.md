# Validation procedure — secondary-screens

Replays the `walking-skeleton` binding contract against the History and Account
redesign. All exercise commands run a server they manage themselves; no manual
bring-up was needed to observe the criteria (the e2e suite drives real browsers
against a real server + SQLite).

## Bring-up

- `bun install` (repo root) — dependencies resolved, no changes.
- The exercise commands below each provision their own runtime:
  - `bun run test` — vitest against jsdom, no external server.
  - `bun run test:e2e` — Playwright starts and manages its own server
    (chromium + webkit), fresh SQLite per run.
- Interactive bring-up, when needed, is `bun run dev` at the repo root
  (server :3000, Vite client :5173 proxying `/rpc` + `/healthz`).

## Exercise / expected observations

- `bun run check` → exit 0 (domain, server, client all typecheck).
- `bun run lint` → exit 0 (one pre-existing `no-console` warning in
  `glass/scene.ts`, untouched by this feature).
- `bun run test` → 90 files, 468 tests, all pass.
- `bun run test:e2e` → 78 passed, 4 skipped (the skips are the explicit
  chromium-only passkey/live-session tests on webkit).

Criterion-by-criterion observations from the e2e run:

1. **Completion cards + progress + snapshot** —
   `history.spec.ts` "two users independently leave a progressed Apex session"
   (chromium + webkit): asserts workout name (`Apex`), non-empty date, host
   label (`Host: you` / `Host: <name>`), participant pills (both host and guest
   on the deterministic-roster card), a partial `N/M` fraction on the mid-leaver
   vs `Finished` on the finisher (with numerator strictly lower), and the
   expanded accordion revealing the as-run pod/station snapshot
   (`8 combo stations`, `Kettlebell swing`, `Rower`, `Hand-release burpee`).
   Passed both browsers.
2. **Empty state + query-failure alert** —
   `history.spec.ts` empty-state test: `query-boundary-empty` with a
   `Start a workout` CTA linking to and navigating to `/library`, and
   `history-list` / loading / error all absent. Query-failure test injects a
   socket failure on the first `ListHistory`, asserts `query-boundary-error` +
   a Retry button, structurally distinct from `query-boundary-loading`, and
   Retry recovers to real data. Both passed both browsers.
3. **Passkey add/delete, invite mint/redeem/revoke, member gating, logout** —
   `auth-passkey.spec.ts` (chromium, CDP virtual authenticator): enroll +
   usernameless login; delete behind an alert-dialog (passkey persists until
   confirm, then removed). `auth-admin.spec.ts` (chromium + webkit): owner mints
   an invite a second context redeems; a second unspent invite revoked behind
   the confirm dialog; the new member sees no `people-invites` section and a
   direct owner rpc returns `Forbidden`; logout returns to `login-screen`.
   All passed.
4. **No native form elements outside ui/** — source grep across
   `history-screen.tsx`, `account-screen.tsx`, `people-invites.tsx`,
   `server-info-card.tsx`, and `query-boundary.tsx`: no `<form>`, `<input>`,
   `<button>`, `<select>`, or `<textarea>`; every control comes from
   `@/components/ui/*`.
5. **check / test / test:e2e exit 0** — all three green as above.

## Teardown

- Playwright and vitest tear down their own processes on exit.
- For an interactive `bun run dev` session: Ctrl-C the dev process and
  `rm -f data/j45.dev.sqlite` to reset state.
