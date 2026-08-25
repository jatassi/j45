# Release v2

- **Date:** 2026-08-25
- **Tag:** `v2` = `aea828a` ("Merge pull request #23 from
  jatassi/feature/live-session-lobby-stream")
- **Outcome:** deployed and verified — `https://j45.atassi.org/healthz` returns
  200 serving the released SHA; app root 200 through Caddy + TLS. The
  post-receive hook's own SHA gate passed on the first push.
- **Rollback pointer:** `git push -f deploy v1.1:main` (`v1.1` = `beb426c`).

## Features

Three feature-graph nodes, all flipped `proposed` → `shipped` in this release's
record commit:

- `live-plan-sync` — a running session tracks its plan: content edits apply at
  the next segment boundary, renames apply immediately, deletes end the session
  (issues #4–#12).
- `history-identity` — completions carry a `WorkoutId` and Home resolves history
  to the library by identity, not by name (migration
  `0007_completion_source_workout`).
- `lobby-liveness` — `WatchActiveSessions` replaces the unary poll, with a live
  session count on the tab bar (issues #15–#18, #23).

No `fix-<slug>` nodes were released, so none were pruned.

Also released, outside the feature graph: a cache policy and conditional-request
handling for the client build, an SPA fallback for directory requests, a shared
`taggedError` module in the domain, and the agent-skills doc scaffold (issue
tracker, triage labels, domain docs).

Released range `v1.1..v2`: 127 files changed, +11,048 / −1,453.

### Status caveat

These three nodes were built through the GitHub-issue flow rather than the
loop's Plan → Build → Validate pipeline, so they were still `proposed` at the
gate and none of them has a `docs/validation/<id>/procedure.md`. The human
approved releasing them and flipping all three to `shipped`. Their evidence is
the e2e specs that landed with them — `live-session.spec.ts:226`
(plan change reaches a running session at the boundary),
`live-session.spec.ts:352` (tab-bar count rises with no navigation),
plus the `home.spec.ts` and `history.spec.ts` suites — all green in the
`test:e2e` run below. A later Validate pass would still owe these three a
procedure doc.

## Ready checks

At the pinned tip `aea828a`, working tree clean, with no dev server holding
port 3000:

- `bun run check` — exit 0 (domain, server, client).
- `bun run test` — 117 files, 694 tests passed.
- `bun run test:e2e` — 89 passed, 7 skipped (the chromium-only two-context
  live-session and passkey specs correctly skipping under webkit).
- `bun run lint` — clean apart from the one standing `no-console` warning at
  `packages/client/src/glass/scene.ts:199` (design-mandated, warn-level).

## Validation procedures replayed

All 13 existing procedures are suite-bound, and every backing suite above is
green. The non-suite static checks were replayed directly: no bare `<input>`,
`<select>`, or `<textarea>` in the auth, generate, or secondary screens — the
two source hits are the dev-only `glass-lab` page and a comment in
`station-actions-drawer.tsx`, both untouched since v1.1 — and
`grep -rn LibraryNav packages/` returns nothing.

## Migration note

`0007_completion_source_workout` runs at server startup and is forward-only. It
is additive (a new column on `session_completions`), so a rollback to `v1.1`
leaves the column in place on code that does not read it. That compatibility was
reasoned about, not proven by test, and was flagged to the human at the gate.
