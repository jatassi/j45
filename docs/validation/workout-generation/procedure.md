# workout-generation — validation procedure

Run against the integration worktree (`loop/workout-generation`,
`loop/workout-generation--gen-templates`, `loop/workout-generation--gen-core`,
`loop/workout-generation--gen-rpc-server`,
`loop/workout-generation--editor-initial-draft`,
`loop/workout-generation--gen-client-screen`,
`loop/workout-generation--gen-e2e` merged onto `main` at pre-merge tip
`d5ef0da`), per the validation-procedure binding. Diff isolated via
`git diff d5ef0da...HEAD` (19 files, +2368/−33). `docs/plans/workout-generation/plan.md`
was already removed before this judge run.

## Bring-up

`bun install` (549 installs, no changes), then `bun run dev` at the repo root
(server on `:3000`, Vite client on `:5173`, proxying `/rpc` ws + `/healthz` to
`:3000`). Confirmed with `curl http://localhost:5173/healthz` and
`curl http://localhost:3000/healthz`, both returning 200 with
`{"sha":"dev","version":"0.0.0"}`. `bun run test:e2e`'s Playwright global-setup
also boots an ephemeral server independently for criterion 6 (chromium +
webkit).

## Exercise

- **Criterion 1** (determinism + decode + compile): read
  `packages/domain/test/generation.test.ts` — same catalog/recent/constraints/seed
  yield `toStrictEqual` workouts; a different seed differs; every focus ×
  {15,30,45} result `Schema.decode(Workout)` round-trips and `compile` does not
  throw. PRNG is mulberry32 in `packages/domain/src/generation.ts` (no
  `Math.random` / `Date.now` in domain generation). Ran `bun run test` — passes
  (part of 319/319); targeted re-run of generation suites 24/24.
- **Criterion 2** (station validity: equipment subset, modality, emphasis,
  recent exclusion): same file — bodyweight under empty allowed equipment
  asserts catalog equipment `[]`; cardio/strength modality match (hybrid
  either); uniqueness of station names; emphasis `core` with strength focus
  asserts every pick is strength with `muscleGroups` containing `core`; recent
  names `['bUrPeE','ROWER','kettlebell swing']` absent case-insensitively.
  Ran `bun run test` — passes.
- **Criterion 3** (duration ±10% for 15–45 in 5-min steps): same file loops
  `[15,20,25,30,35,40,45]`, compiles each hybrid result, asserts
  `|actualMinutes - target| <= target * 0.1`. Template catalog tests in
  `packages/domain/test/templates.test.ts` independently assert a template
  exists within ±10% for each target. Ran `bun run test` — passes.
- **Criterion 4** (infeasible, never crash): equipment-empty pool returns
  `GenerationInfeasible` with reason matching `/equipment/`; recent starvation
  below station count matches `/recent/`; `targetMinutes: 1` matches
  `/duration|target|minutes/`; all via `Either.left`, not throw. Server
  handler test also surfaces infeasible as `GenerationInfeasible` over RpcTest.
  Ran `bun run test` — passes.
- **Criterion 5** (GenerateWorkout assembly + no persist): read
  `packages/server/test/generation/handlers.test.ts` — caller catalog + newest
  `noRepeatSessions` completions exclude a recent station name; identical
  history on another account leaves the first caller's result
  `toStrictEqual`; `noRepeatSessions: 0` allows a recently-completed name;
  `ListWorkouts` before/after GenerateWorkout is identical (nothing persisted).
  Handler code wires `ExercisesRepo.listForOwner` + `CompletionsRepo.listForUser`
  into pure `generate` with no insert. Ran `bun run test` — passes (5/5 in
  that file).
- **Criterion 6** (e2e `/generate` flow): read `e2e/generate.spec.ts` closely —
  library home `generate-nav-link` → `/generate`; sets focus hybrid, target 30,
  emphasis empty (equipment left at default-all-selected chips); Generate shows
  `generate-preview` with non-empty `generate-codename` and summary matching
  `/^\d+ works · \d{1,2}:\d{2}$/`; Regenerate changes `data-seed` via poll;
  Edit opens `/workouts/new` with `editor-name` = codename and
  `editor-summary` = chip; Save lands on detail with matching title, library
  card present, and card survives `page.reload()`. Ran `bun run test:e2e` —
  pass on chromium and webkit (test #10 and #35).
- **Criterion 7** (toolchain gates): `bun run check` exit 0 (domain, server,
  client); `bun run lint` exit 0 (oxlint --type-aware); `bun run test` 319
  passed (319); `bun run test:e2e` 47 passed, 3 skipped (chromium-only
  passkey/live-session specs skipped on webkit by design, unrelated to this
  feature).

## Integrity gates

Diff scanned for `eslint-disable` / `oxlint-disable` (any form), `.oxlintrc.json`
edits, `@ts-ignore` / `@ts-expect-error`, and `.only`/`.skip` on new tests —
none found. No test files deleted (`git diff --diff-filter=D` empty for the
feature range). Pre-existing `history.test.ts` / `rpc.test.ts` only bump
`J45Rpcs.requests.size` 26→27 and assert `GenerateWorkout` is present
(strengthened, not weakened). Feature tests assert real shapes/content
(strict equality, duration tolerance, reason regexes, codename chip format,
data-seed change, catalog membership) rather than mere non-throw smoke.

## Expected observations

All of the above matched: deterministic pure generate, valid Workout decode +
compile, station constraints enforced, duration coverage within ±10%,
infeasible reasons name the starving constraint, Rpc assembly is caller-scoped
and non-persisting, e2e generate/regenerate/edit/save/reload holds on both
engines, and check/lint/unit/e2e are green with no integrity violations.

## Teardown

Killed the `bun run dev` background process. Removed local sqlite if present
(`rm -f data/j45.dev.sqlite`). Playwright's own server managed its state
independently and cleaned up after `test:e2e`. Only uncommitted write intended
by this judge: this procedure file
(`docs/validation/workout-generation/procedure.md`); no `git add` / commit
performed.

## Verification runs (by the judging agent)

- `bun run check` — exit 0 (domain, server, client)
- `bun run lint` — exit 0 (oxlint --type-aware)
- `bun run test` — 319 passed (319)
- `bun run test:e2e` — 47 passed, 3 skipped (chromium + webkit), including
  `e2e/generate.spec.ts` on both projects
- Targeted: `generation.test.ts` + `templates.test.ts` +
  `generation/handlers.test.ts` + `generate-screen.test.tsx` — 24 passed
