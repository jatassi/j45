# Validation procedure — design-system

Replays the design-system acceptance against the running system. Inherits the
`walking-skeleton` binding contract.

## Bring-up

- `bun install` at the repo root.
- The exercise commands below manage their own server processes:
  - `bun run test:e2e` boots server + built client via `e2e/support/global-setup.ts`
    and runs Playwright's chromium + webkit projects against it.
  - `bun run test` runs vitest with in-process / jsdom harnesses (no long-lived server).
- For manual inspection: `bun run dev` (server :3000, Vite client :5173) and open
  `http://localhost:5173/design`.

## Exercise + expected observations

1. `bun run check` — typecheck all packages. Expected: exit 0 (domain, server,
   client all "Exited with code 0"). The `Record<Literal, string>` label maps make
   a missing vocabulary label a compile error here.

2. `bun run test` — vitest. Expected: exit 0, 338 tests passing. Key evidence:
   - `packages/domain/test/exercise.test.ts` / `workout.test.ts`: iterate the real
     schema unions (`Modality.literals`, … `FlowType.literals`) asserting every
     literal yields a non-empty label, plus exact hyphenated mappings
     (`full-body → "Full body"`, `jump-rope → "Jump rope"`, `med-ball → "Med ball"`,
     `pull-up-bar → "Pull-up bar"`, `slam-ball → "Slam ball"`).
   - `index-css-tokens.test.ts` + the unchanged `index-css-dark-only.test.ts`:
     `--background` equals `backdrop.ts` `BACKDROP_BASE` (`#08090b`); no `.dark` block.
   - `exercise-library-screen.test.tsx` / `generate-screen.test.tsx`: rows render
     domain labels (`Rower`, `Full body`, `Quads`, `Barbell`) and assert raw literals
     absent (`not.toContain('full-body')`).
   - `query-boundary.test.tsx`: the QueryBoundary feedback-state helper.

3. `bun run test:e2e` — Playwright chromium + webkit. Expected: exit 0, 51 passed,
   3 skipped (chromium-only live-session/passkey specs skipped under webkit). Key
   evidence:
   - `e2e/design.spec.ts`: `/design` loads unauthenticated (login screen has count 0),
     "Gallery" heading visible, `design-glass-surface` reaches
     `data-glass-tier="refract"`; with the WebGL2-disabled init script it reaches
     `data-glass-tier="css"` and mounts no glass canvas; console/pageerror arrays empty
     in both.
   - `e2e/exercises.spec.ts`: catalog filter chips + tag badges render `Full body`,
     `Med ball`, `Jump rope`; rendered text matches none of `\bfull-body\b`,
     `\bmed-ball\b`, `\bjump-rope\b`.
   - `e2e/generate.spec.ts`: generate focus/emphasis/equipment options render the same
     domain labels; raw literals absent from rendered text.
   - `e2e/glass.spec.ts`: existing glass suite unchanged and green.

4. (Optional, inherited binding) `bun run deploy:sim` — local simulated deploy.
   Not required by any design-system criterion; unchanged from walking-skeleton.

## Teardown

- Ctrl-C the `bun run dev` process if started manually. `test`/`test:e2e` tear down
  their own processes.
- Reset local state: `rm -f data/j45.dev.sqlite`.
