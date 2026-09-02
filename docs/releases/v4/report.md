# Release v4

- **Date:** 2026-09-02
- **Tag:** `v4` = `a1f8f90` ("Merge pull request #66 from
  jatassi/fix/vite-proxy-test-ports")
- **Outcome:** deployed and verified — `https://j45.atassi.org/healthz` returns
  200 serving the released SHA; app root 200 through Caddy + TLS. The
  post-receive hook's own SHA gate passed on the first push.
- **Rollback pointer:** `git push -f deploy v3:main` (`v3` = `a1cc393`).

## Features

No feature-graph node changed status and none was pruned. As in `v3`, this
release is ungraphed work tracked as GitHub PRs — 26 PRs against the live
player, its supporting docs, and the test suites.

- **Live player motion** (PR #65). Press feedback on the round controls, an
  eased pause desaturation instead of a snap, a phase-tint cross-fade on the
  backdrop, the completion arc drawn closed when a workout ends, and fades
  between the progress strip's mark states. The five plans behind this work are
  recorded under `plans/`.
- **Progress arc reshape** (PR #59, tickets #49–#53). The Progress ring opens
  into a wide half circle and is renamed Progress arc throughout, including the
  loop-owned docs (PR #55). A player-only countdown format lands, the digits
  size by character count, and the arc's children contract is unified.
- **Live-view fixes.** The workout stays on screen while the connection retries
  (PR #47, ticket #44). The strip's cell collapse now counts its gaps (PR #43).
  The timer's run view fits the viewport (PR #60). The dock scrolls a long
  next-up name instead of truncating it (PR #63). The countdown digits
  re-measure when the type scale changes (PR #57, ticket #56). A dead
  `data-[state=on]` class is removed from `ToggleGroupItem` (PR #42).
- **Suite stability.** Two flaky client tests made deterministic (PR #58), the
  timer countdown checks recalibrated and the live-session lobby joins taken
  off the contended hero slot (PR #61), and the vite proxy test given
  OS-assigned ports (PR #66).
- **Docs.** `full-body` dropped from the three stale validation procedures
  (PR #41).

## Verification

- `bun run check`, `bun run lint` — clean on the released tip.
- `bun run test` — 125 files, 819 tests.
- `bun run test:e2e` — 90 passed, 8 skipped, on chromium and webkit.
- 71 files changed against `v3`: +6,720 / -898.

## Notes

- No `docs/validation/<id>/procedure.md` replay: this work has no graph ids, so
  it has no validation procedures. The end-to-end suite is the whole of its
  journey coverage — the same position `v3` recorded.
- No migration is added in this range, so a rollback to `v3` needs no schema
  consideration.
- All three of `v3`'s known follow-ups are closed here: the strip cell collapse
  that ignored the renderer's gaps (PR #43), the unused `chip-row.tsx` duplicate
  control (deleted in `97a1e38`), and the three validation procedures that still
  asserted `Full body` (PR #41).

## Known follow-ups

- `docs/feature-graph.json` still names `full-body` in two criteria — the last
  survivor of `v3`'s vocabulary change.
- The client bundle is 1.22 MB (368 kB gzipped) in one chunk; the build warns
  on it every deploy and no code splitting is configured.
