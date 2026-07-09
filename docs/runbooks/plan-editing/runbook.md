## plan-editing validation runbook

### Bring-up
- Worktree already assembled on `integrate--plan-editing` (main + plan-editing PR stack).
- Deps present; no `bun install` required for this run.
- Did **not** leave `bun run dev` running; e2e global-setup starts its own server.

### Exercise (observed)
1. **Integrity scan** on `git diff main...HEAD`: no `eslint-disable` / `oxlint-disable` / lint-config edits; no deleted tests (only domain count assertions raised for Create/Update); merge conflict resolutions keep both route list and invite-pool additions.
2. **`bun run check`** — exit 0 (domain, client, server tsc).
3. **`bun run test`** — exit 0; 48 files / 200 tests, including:
   - `packages/server/test/library/handlers.test.ts` Create/Update/List + foreign/absent
   - `packages/server/test/library/workouts-repo.test.ts` update semantics
   - `packages/client/test/workout-draft.test.ts` uniform expand/collapse + decode failures + `27 works · 26:45`
   - `packages/client/test/workout-editor-screen.test.tsx` create path, summary chip, validation UI, edit mutations
4. **`bun run test:e2e`** — exit 0; 35 passed, 1 skipped (passkey webkit).
   - chromium+webkit: plan-editing create-from-scratch (New workout → name/focus/pod/2 stations/sets 3×30″/10″ → Save → detail + library after reload)
   - chromium+webkit: Athletica copy edit (summary `27 works · 26:45`, laps→sets, rename, station-down, Save, detail+reload, empty station name disables Save + visible error)
5. **`bun run deploy:sim`** — exit 0 (`deploy:sim PASSED`); local bare-repo push/healthz/rollback only, no production impact.

### Expected observations (matched)
- CreateWorkout: fresh id, equal timestamps, listed under caller.
- UpdateWorkout: body replaced, updated_at moves, id/created_at stable; foreign/absent → WorkoutNotFound.
- Editor chip + validation + e2e authoring flows as above.

### Teardown
- No long-lived `bun run dev` process started by this judge.
- e2e and deploy:sim cleaned up their own servers/temp dirs.
- No `data/j45.dev.sqlite` created by this judge; tree left unedited (`git status` only showed untracked `node_modules` noise if any).
