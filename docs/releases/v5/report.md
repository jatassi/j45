# Release v5

- **Date:** 2026-09-02
- **Tag:** `v5` = `30729b0` ("fix(e2e): move the exercises spec onto the
  ADR-0004 catalog")
- **Outcome:** deployed and verified — `https://j45.atassi.org/healthz` returns
  200 serving the released SHA; app root 200 through Caddy + TLS. The
  post-receive hook's own SHA gate passed. The first `git push deploy main`
  died with `Connection closed by 5.161.67.8 port 22` before the hook ran; the
  identical retry deployed. `ssh vps` was healthy between the two, so this
  reads as a transient SSH drop, not a deploy fault.
- **Rollback pointer:** `git push -f deploy v4:main` (`v4` = `a1f8f90`). Read
  the migration note below before using it.

## Features

No feature-graph node changed status and none was pruned. As in `v3` and `v4`,
this release is ungraphed work tracked as GitHub PRs.

- **Seed exercise catalog replaced; Intensity dropped** (ADR-0004, PR #73). The
  shipped catalog was transcribed from seed workout station text — combo
  stations, cue fragments, and tags the generator acted on wrongly. It becomes
  120 single-movement exercises, each mapped to exact schema literals and cited
  per row in `docs/research/exercise-catalog.md`. `Intensity`,
  `intensityLabel`, and `Exercise.intensity` leave the domain; the client drops
  the intensity badge and select. Migration `0009` strips `intensity` from
  every stored body, deletes untouched shipped rows the new catalog no longer
  holds, keeps every user-created or user-edited row, and inserts the new
  entries each owner lacks by name.
- **A 30s ready countdown** (PR #71). `READY_SECONDS` goes 5 → 30, moving every
  number that counts the lead-in: compile goldens, seed totals, client summary
  chips, server session clock walks, e2e duration assertions, and the design
  docs and runbooks that record them. Two test-side consequences: the flow
  harness gains `holdWatch`, because a default workout now runs past the 60s
  unwatched-collection window; and the Playwright timeout rises to 120s for
  specs that ride the ready segment through to work.
- **Station note editor** (PR #72). The station `detail` field was already
  carried end to end but had no input. One lands under each station name, a
  blank note is dropped from the draft, and the note sits beside the name's
  `Field` rather than inside it, so an invalid name no longer tints it.
- **Progress strip drawn from the leaf up** (PR #74, closes #67). The strip now
  draws Pod, run, work, with the dot always the work — it previously stood for
  a repeat count, not for a thing that runs. Two layouts, Open and Focus, are
  chosen once per compiled plan and held for the whole Session, so the row
  keeps one height and nothing under it shifts. The Pod width ease is kept and
  its design-hook finding scoped-ignored to the one file (PR #75).

## Verification

- `bun run check`, `bun run lint` — clean on the released tip.
- `bun run test` — 127 files, 842 tests.
- `bun run test:e2e` — 90 passed, 8 skipped, on chromium and webkit.
- 76 files changed against `v4`: +3,841 / -1,443.

## The release's own fix

The first ready-check run was red: `e2e/exercises.spec.ts` still described the
pre-ADR-0004 world, so PR #73 merged with `bun run test:e2e` already failing.
Two breaks, both fixed in `30729b0`:

- The seed count constant said 96 against a 120-entry catalog, and the calves
  subset said 7 against 16. Both are now read off `seed-exercises.json`; calves
  stays a proper subset, so the filter check still narrows.
- The create flow still picked an Intensity. That control no longer exists, so
  the click waited out the whole 120s budget. It and its `Moderate` row
  assertion are gone.

The unit suite could not catch this: `seed-exercises.test.ts` was rewritten in
the same PR to assert a per-muscle-group floor rather than a total.

## Notes

- **Migration and rollback.** `0009` is the first migration since `v3`, and
  migrations are forward-only. A rollback to `v4` would run `v4`'s code against
  the 0009 schema, and that code still reads the `intensity` the migration
  strips. Rolling back this release therefore needs a data consideration that
  `v3 → v4` did not.
- No `docs/validation/<id>/procedure.md` replay: this work has no graph ids, so
  it has no validation procedures. The end-to-end suite is the whole of its
  journey coverage — the same position `v3` and `v4` recorded.
- `e2e/auth-passkey.spec.ts:24` failed once in the first full e2e run and
  passed alone and in the clean re-run. It is load-flaky, in the same class as
  the timing contention `v4` recalibrated.

## Known follow-ups

- `docs/feature-graph.json` still names `full-body` in two criteria — carried
  from `v4`, the last survivor of `v3`'s vocabulary change.
- `e2e/generate.spec.ts:395` justifies the strength+calves starvation case as
  "one calves-tagged strength exercise". The new catalog holds five, so the
  test still passes but for a reason its comment no longer states. The real
  starving constraint should be named.
- The client bundle is 1.22 MB (368 kB gzipped) in one chunk; the build warns
  on it every deploy and no code splitting is configured. Carried from `v4`.
- Seven stale worktrees sit under `.claude/worktrees/`, against the git-hygiene
  rule in `CLAUDE.md`.
