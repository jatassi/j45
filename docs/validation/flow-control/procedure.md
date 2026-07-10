# flow-control — validation procedure

Run against the integration worktree (`loop/flow-control`,
`loop/flow-control--domain-reflow`, `loop/flow-control--rpc-start-session`,
`loop/flow-control--cross-pod-move`, `loop/flow-control--launch-mode` merged
onto `main`), per the walking-skeleton validation-procedure binding.

## Bring-up

`bun install`, then `bun run dev` at the repo root (server on `:3000`, Vite
client dev server on `:5173`, proxying `/rpc` ws + `/healthz` to `:3000`).
Confirmed with `curl http://localhost:5173/healthz` and
`curl http://localhost:3000/healthz`, both returning 200 with
`{"sha":"dev","version":"0.0.0"}`. `bun run test:e2e`'s own Playwright
global-setup also boots an ephemeral server independently for the browser
criteria (4-6), which is a second, automated bring-up covering those.

## Exercise

- **Criterion 1** (golden regroup-to-laps): read
  `packages/domain/test/reflow.test.ts`'s golden test — push-up/sit-up/squat
  regrouped into one laps pod produces an exact compiled segment sequence
  (stations interleaved per lap) with source `name`/`focus`/`note`/`rounds`
  carried over. Ran `bun run test` — passes (part of 271/271).
- **Criterion 2** (reorder/drop/rounds-override/invalid): same file asserts
  cross-pod reorder, dropped unreferenced stations absent from the compiled
  result, a rounds override replacing `flow.rounds` vs. an absent override
  carrying the source rounds, and out-of-range / duplicated station indexes
  returning `ReflowInvalid` (not throwing). Ran `bun run test` — passes.
- **Criterion 3** (StartSession + reflow): read
  `packages/server/test/session/handlers.test.ts` — `StartSession` with a
  reflow spec compiles to `compile(applyReflow(source, spec))`, the library
  row is left unchanged, an out-of-range/duplicated spec fails
  `ReflowInvalid`, and a foreign/unknown workout id fails `WorkoutNotFound`
  with or without a reflow payload. Ran `bun run test` — passes.
- **Criteria 4-5** (e2e Start-with-reflow / Save-to-plan): read
  `e2e/flow-control.spec.ts` — from a workout detail screen, "Start with
  reflow" opens launch mode; regrouping stations into one pod and flipping
  sets→laps updates the "N works · MM:SS" chip; Start lands on `/session/<id>`
  running the reflowed structure with the library workout unchanged after
  reload; the same edits via Save to plan persist to the detail screen after
  reload. Ran `bun run test:e2e` — both specs pass on chromium and webkit.
- **Criterion 6** (launch-mode read-only / cross-pod move): same spec asserts
  zero station-name inputs and zero add-station controls in launch mode;
  `e2e/plan-editing.spec.ts` exercises the normal editor's cross-pod move and
  its persistence after save + reload. Ran `bun run test:e2e` — both pass on
  chromium and webkit.
- **Criterion 7** (toolchain gates): ran `bun run check` (exit 0 across
  domain/server/client), `bun run lint` (oxlint --type-aware, exit 0; diff
  scanned for `eslint-disable`/`oxlint-disable` and `.oxlintrc.json` edits —
  none found), `bun run test` (271/271 passed), `bun run test:e2e` (43 passed,
  3 skipped — chromium-only passkey/live-session specs skipped on webkit by
  design, unrelated to this feature).

## Expected observations

All of the above matched: golden compile sequence exact, dropped stations
absent, rounds-override semantics correct, invalid specs fail closed with
`ReflowInvalid`, session state mirrors `compile(applyReflow(...))` while the
library row is untouched, foreign/unknown ids still fail `WorkoutNotFound`,
both e2e flows (Start and Save-to-plan) land the reflowed structure and
persist correctly, launch mode is read-only for content, and the normal
editor's cross-pod move persists. No lint suppressions, no weakened tests, no
config edits found in the diff.

## Teardown

Killed the `bun run dev` background process. No `data/j45.dev.sqlite` was left
behind (Playwright's own server manages its own state independently, cleaned
up after `test:e2e` finished). Git worktree left clean of tracked changes
throughout (`git status` verified clean before and after every run).

## Verification runs (independent, by the validating agent)

Re-run independently of the judging executor's own runs, after confirming the
tree was unaltered by it (`git status` clean):

- `bun run check` — exit 0 (domain, server, client)
- `bun run lint` — exit 0 (oxlint --type-aware)
- `bun run test` — 271 passed (271)
- `bun run test:e2e` — 43 passed, 3 skipped (chromium + webkit), including
  both `e2e/flow-control.spec.ts` cases and the cross-pod-move case in
  `e2e/plan-editing.spec.ts`, on both browser projects
