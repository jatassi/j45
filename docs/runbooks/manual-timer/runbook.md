# Runbook — manual-timer

Validated by the Validate agent (mechanics) + grok-4.5 (judgment, ADR-0047)
against integration tree `3dabcb3` (merge of `loop/manual-timer` +
`loop/manual-timer--manual-workout`, `--player-audio`,
`--player-use-countdown`, `--player-wake-lock`, `--timer-screen`,
`--timer-e2e` onto `main` at `6e0bec8`). Bun 1.3.9, macOS (darwin).

## Bring-up

```sh
bun install
```

`node_modules` present, 549 installs across 698 packages, no changes needed.
No long-lived `bun run dev` process was kept running for this pass — the
unit and e2e suites each manage their own server lifecycle
(`e2e/support/global-setup.ts` boots a real server on an ephemeral port with
a temp SQLite DB for e2e; unit tests exercise the domain compiler and
player-kit modules directly with fake timers/rAF).

## Exercise (observed)

1. **Diff / integrity** — `git diff main...HEAD`: 14 files touched, all
   under `packages/client/` and `e2e/`; zero changes to `packages/server` or
   `packages/domain`, and no migration files. `grep`-checked the diff for
   `disable`/`.skip(`/`.only(`/`xit(`/`xdescribe` — none found. No lint
   config edits. No deleted or weakened tests — only additions
   (`manual-workout.test.ts`, `player-audio.test.ts`,
   `player-use-countdown.test.ts`, `timer-screen.test.tsx`,
   `e2e/timer.spec.ts`).
2. **Criterion 1 (unit, synthetic workout)** —
   `packages/client/test/manual-workout.test.ts`: `buildManualWorkout(40,
   20, 9)` is a schema-valid domain `Workout`; `compile(...)` yields tags
   `ready, work, rest, work, rest, ..., work` (9 work / 8 rest),
   `totalDurationMillis === 525_000`, ready segment `5000ms`, every work
   segment `40_000ms`, every rest segment `20_000ms`. `rest=0` compiles to
   `ready` + 9 `work` with zero `rest` segments.
3. **Criterion 2 & 3 (e2e, chromium + webkit)** —
   `e2e/timer.spec.ts` run via `bun run test:e2e`: `/timer` reached via a
   nav link from the library home while logged in; 5s work / 0s rest / 2
   rounds run ready → work → work → Done with the round indicator
   advancing; Pause freezes the displayed count, Resume continues, Reset
   returns to the idle input state. Web Audio instrumented via init script:
   the Start tap sets `data-audio="on"` and at least one beep fires on a
   segment transition. `navigator.wakeLock` instrumented: lock acquired
   while running, released on pause and on Done. Both projects passed.
4. **Criterion 4 (player kit)** —
   `packages/client/src/player/{audio,use-countdown,wake-lock}.ts` exist;
   `grep` for session imports found none (only `react` imports, `audio.ts`
   has a comment enforcing the kit ← screen direction). `player-audio.test.ts`
   (8 tests) and `player-use-countdown.test.ts` (5 tests) pass under
   `bun run test`.
5. **Criterion 5 (client-only)** — `git diff --stat main...HEAD --
   packages/server packages/domain` and `-- '*migration*'` both empty.
6. **Criterion 6 (exit codes)** — ran independently, twice (once before
   dispatching the judge, once after, to confirm the tree wasn't altered by
   judging):
   - `bun run check` → exit 0 (`@j45/domain`, `@j45/server`, `@j45/client`).
   - `bun run lint` (`oxlint --type-aware`) → exit 0, no findings.
   - `bun run test` → exit 0; 46 files / 178 tests passed.
   - `bun run test:e2e` → exit 0; 32 tests, 31 passed, 1 skipped
     (`auth-passkey.spec.ts` webkit — chromium-only by design, pre-existing
     and unrelated to this feature).
   - `git status` / `git rev-parse HEAD` confirmed identical before and
     after the judge ran (only untracked `node_modules`) — the judging pass
     did not alter the tree.

## Teardown

No long-lived `bun run dev` process was left running. e2e server lifecycle
is owned by Playwright's global setup/teardown (ephemeral port, temp
SQLite). No `data/j45.dev.sqlite` existed to remove for this pass.
