# Release v3

- **Date:** 2026-09-01
- **Tag:** `v3` = `a1cc393` ("Merge pull request #40 from
  jatassi/feature/generate-form")
- **Outcome:** deployed and verified — `https://j45.atassi.org/healthz` returns
  200 serving the released SHA; app root 200 through Caddy + TLS. The
  post-receive hook's own SHA gate passed on the first push that reached it.
- **Rollback pointer:** `git push -f deploy v2:main` (`v2` = `aea828a`).

## Features

Three features, tracked as GitHub specs rather than feature-graph nodes. The
owner decided during design that this work did not earn graph entries, so no
node changed status in this release and none was pruned.

- **Remove `full-body` from the muscle-group vocabulary** (spec #24, tickets
  #27 and #30). Migration `0008` rewrites every stored exercise row — drop the
  tag, write `core` where that empties the list — and the shipped seed catalog
  takes the identical rule, so migrated and seeded rows agree. The literal then
  narrows to ten values. Recorded in ADR-0003.
- **Generate form: a multi-select Emphasis and legible equipment chips** (spec
  #26, tickets #28, #31, #32, #33, #34). Emphasis carries an optional nonempty
  muscle-group list under a union rule, and is disabled with a note under a
  cardio Focus. The shared facet control gained a bulk row and a summary slot;
  all six chip groups now show selection plainly.
- **Live view: the Progress strip and a 270-degree arc** (spec #25, tickets
  #29, #35, #36, #37). One bar per group and one dot per Round replace up to 48
  dots; the compiled plan carries its Flow type so the strip can group by Pod on
  `laps` and by Station on `sets`. The timer ring opens into a 270-degree arc and
  the digits grow from 64px to 81px.

## Verification

- `bun run check`, `bun run lint` — clean on the released tip.
- `bun run test` — 121 files, 763 tests.
- `bun run test:e2e` — 89 passed, 7 skipped, on chromium and webkit.
- 49 files changed against `v2`: +4,395 / -710.

The three feature branches had never shared a tree before the merge, so the
whole suite was re-run on integrated `main` rather than trusted from the
branches.

## Notes

- No `docs/validation/<id>/procedure.md` replay: these features have no graph
  ids, so they have no validation procedures. The end-to-end suite is the whole
  of their journey coverage.
- Migration `0008` is forward-only, like every migration here. A rollback to
  `v2` leaves the exercise rows migrated, which is safe: `v2`'s vocabulary still
  accepts every value those rows now hold.
- Two defects that pre-dated this work were found and fixed on the way. The
  glass digit proxy painted the countdown at 172px while the digits rendered at
  64px, and the manual timer's digit component is shared with its idle view, so
  the digit growth leaked to a screen with no ring.

## Known follow-ups

- `STRIP_BUDGET` divides 280px among the bars, but the renderer adds gaps the
  budget does not model, so a rendered cell can fall under the 4px floor while
  the derivation still keeps its cells.
- `packages/client/src/components/chip-row.tsx` is an unused duplicate chip
  control with no call sites.
- `docs/validation/{design-system,library-screens,generate-screen}/procedure.md`
  still describe `Full body` assertions, and `docs/feature-graph.json` still
  names `full-body` in a criterion.
