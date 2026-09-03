# Validation procedure — editor-screens

Replays the observable behavior behind each acceptance criterion. The Playwright
suite (`bun run test:e2e`) is the exercise vehicle: it brings up the server +
client itself, drives the criteria in chromium and webkit, and tears the stack
down. The manual bring-up below is the equivalent for hand-checks.

## Bring-up

- `bun install`
- `bun run dev` at the repo root — server on :3000, Vite client on :5173
  (proxies `/rpc` ws + `/healthz` to :3000).
- For the automated path: `bun run test:e2e` manages its own server; no manual
  bring-up needed.

## Exercise + expected observations

Static/toolchain gates (criterion 7 and its integrity siblings):

- `bun run check` → exit 0 (all three packages typecheck).
- `bun run test` → 505 unit/integration tests pass; the rewritten
  `workout-editor-screen`, `reflow-screen`, `workout-draft`, and `push-header`
  suites assert against the kit controls (toggle-groups, drawers) not native
  elements.
- `bun run lint` (oxlint --type-aware) → exit 0 (one pre-existing
  `glass/scene.ts` console warning, untouched by this feature).
- `bun run test:e2e` → 87 passed, 5 skipped (chromium-only live/passkey specs
  skipped under webkit).

Per criterion (all observed green in chromium + webkit unless noted):

1. **New workout** — `plan-editing.spec.ts:124`. Fill name, pick focus via
   toggle-group, add a second station through the station-actions drawer (no
   inline add), switch flow to sets, 3 rounds of 30″/10″, Save from header →
   detail shows the workout with 1 pod / 2 stations; library card survives a
   reload.
2. **Edit a seed copy** — `plan-editing.spec.ts:185`. Duplicate Athletica, edit
   the copy: flow laps→sets via toggle-group, station rename, reorder, and a
   cross-pod move via the drawer; all persist through Save and a reload (detail
   and re-opened editor both reflect the changes).
3. **Summary chip + validation** — `plan-editing.spec.ts:185`. The untouched
   duplicated Athletica draft's sticky `editor-summary` reads exactly
   `27 works · 27:10`; clearing a station name disables Save and pins a non-empty
   `station-name-error` at the field (no page banner).
4. **Launch (reflow) mode** — `flow-control.spec.ts:132` and `:195`. Reflow
   screen offers no `station-name-input` and no `add-station`; regroup into one
   pod + flip sets→laps updates the chip (`6 works · 2:55` → `4 works · 1:55`);
   Start lands on `/session/<id>` running the reflowed structure (4 progress
   cells, single pod group) while the stored workout is unchanged after reload;
   Save-to-plan persists the single-pod grouping across a reload.
5. **Dirty-draft back-out** — `plan-editing.spec.ts:292`. Pristine back leaves
   with no dialog; a dirty edit + back raises `editor-discard-dialog`
   (alert-dialog); Discard returns to detail and the change never persists
   (survives reload).
6. **No native form elements** — verified by source inspection: no `<select>`,
   `<input>`, or `<checkbox>` JSX tags in `packages/client/src/components/editor/`
   or `workout-editor-screen.tsx` (only a comment references the removed inline
   `<select>`); the old `workout-editor-fields.tsx` and `reflow-fields.tsx` are
   deleted. Cross-checked by the kit-based unit suites.
7. **Toolchain** — `bun run check`, `bun run test`, `bun run test:e2e` all exit 0
   (see above).

## Teardown

- Ctrl-C the dev process.
- `rm -f data/j45.dev.sqlite` to reset local state.
- The automated path (`test:e2e`) tears down its managed server on completion.
