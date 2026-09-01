# Validation procedure — generate-screen

Replays the `walking-skeleton` binding contract against the Generate tab
rebuild. Run from the repo root.

## Bring-up

- `bun install`
- `bun run dev` — server on :3000, Vite client on :5173 (proxies `/rpc` ws +
  `/healthz` to :3000).

The e2e suite (`bun run test:e2e`) manages its own server, so the observations
below were captured through Playwright against a managed server rather than the
dev process.

## Exercise + expected observations

### Criterion 5 — check / test / e2e all green

- `bun run check` → exit 0 (domain, server, client all typecheck).
- `bun run test` → exit 0, 461 tests / 90 files passed.
- `bun run test:e2e` → exit 0, 73 passed, 3 skipped (chromium-only
  live-session/passkey specs skipped under webkit — expected).
- `bun run lint` → exit 0 (one pre-existing `no-console` warning in
  `packages/client/src/glass/scene.ts`, untouched by this feature).

### Criterion 1 — full generate → preview → regenerate → save → edit flow

Exercised by `e2e/generate.spec.ts:180` (chromium + webkit):

- Open `/generate` via `tab-generate`; set focus (toggle-group), duration
  (stepper stays 30), emphasis (base-ui Select → None), Generate.
- Observe `generate-preview` visible with `generate-codename` (non-empty) and
  `generate-summary` matching `^\d+ works · \d{1,2}:\d{2}$`.
- Regenerate → `data-seed` on `generate-preview` changes (polled).
- Edit → navigates to `/workouts/new`, editor seeded with the preview
  codename + summary.
- Save (fresh preview) → navigates to `workout-detail-screen` with the
  codename as title; the workout appears on `/library` and survives a reload.

### Criterion 2 — typed GenerationInfeasible → inline alert, form editable

Exercised by `e2e/generate.spec.ts:264` (chromium + webkit):

- Generate a preview, then set Strength + Calves (starves the seed pool) and
  Generate.
- Observe `generate-error` visible with `role="alert"`, text matching
  `/exercise|equipment|station|pool/i` (the typed reason names the starved
  constraint). No toast, no blank preview.
- The prior preview's codename is unchanged (not blanked); focus/duration/
  emphasis controls stay enabled and editable.

### Criterion 3 — domain labels, no raw vocabulary literals

Exercised by `e2e/generate.spec.ts` `assertDomainLabelsOnGenerateScreen` and
`generate-screen.test.tsx`:

- Focus toggles read Cardio/Strength/Hybrid; equipment chips read Med ball /
  Jump rope / Dumbbells; emphasis chips read Core / Hamstrings etc.
- Raw literals `med-ball` and `jump-rope`, the emphasis ids `core` and
  `hamstrings`, and the focus literals do not appear as visible text.

### Criterion 4 — no native `<select>` / bare `<input>` outside ui/

Exercised by `generate-screen.test.tsx` ("contains no native <select> and no
bare <input>...") plus source grep: the only inputs under `generate-screen`
are ui/ `Input` (steppers, `data-slot=input`) and the base-ui Select's
aria-hidden form input; no authored `<select>`/`<input>`.

## Teardown

- Ctrl-C the dev process.
- `rm -f data/j45.dev.sqlite` to reset state.
