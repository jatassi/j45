# Design — editor-screens

The workout editor rebuilt on the design system: `/workouts/new`,
`/workouts/$workoutId/edit`, and the launch-mode reflow at
`/workouts/$workoutId/reflow`. The editor is the densest form surface in the
app and today is the heaviest user of native form elements
(`workout-editor-fields.tsx`, `reflow-fields.tsx`) — this feature deletes
that idiom. Draft model, validation, and rpcs are unchanged
(`workout-draft.ts`, `editor-draft.ts`, `reflow-draft.ts`,
`CreateWorkout`/`UpdateWorkout`/`StartSession` with reflow).

## Shell

Push layout with `PushHeader`: back chevron (confirm via `alert-dialog` when
the draft is dirty), title (New workout / Edit / Launch setup), and **Save**
(or **Start** in launch mode) in the header action slot — disabled while the
draft fails `Workout` decode, exactly today's gating. The live summary chip
(`works · MM:SS`, recomputed per edit) stays visible — sticky under the
header so it never scrolls away while editing deep in a long plan.

## Sections (kit mapping)

- **Meta**: name (`field`+`input`), focus (`toggle-group`, labels from
  `focusLabel`, sport-hue accents), note (`input`).
- **Pods & stations**: pods as cards; stations as rows with name `input`,
  detail `input`, and a row-action cluster (move up/down, cross-pod move,
  delete). Cross-pod move and add-station live in a bottom `drawer` rather
  than the current inline `<select>` — one thumb, no precision dropdowns.
  Station delete is immediate (undo-free — it's a draft; Save is the commit
  point). Empty-name validation renders on the field per the kit's error
  slot.
- **Flow**: flow type (`toggle-group` laps|sets via `flowTypeLabel`), rounds
  count stepper, uniform work/rest toggle (`checkbox` → kit `switch`-style
  field) with the same expand/collapse draft semantics, per-round work/rest
  second inputs (numeric `input`s with steppers) in a ladder list when
  non-uniform.
- **Launch (reflow) mode**: same skeleton, content read-only exactly as
  today (station names not editable, no add-station), regroup/reorder and
  flow controls active; footer offers **Start** (session with reflow spec)
  and **Save to plan** (persistent reflow) — both existing semantics.

## Behavior

- Save success → detail screen (existing navigation), quiet; Save failure →
  `sonner` toast with the typed error. Draft decode failures surface inline
  per field, not as a page banner.
- Editor screens register no scene proxies beyond their scroll container —
  they're forms, not showcases; chrome glass over them refracts the section
  cards only.

## e2e impact

`plan-editing.spec.ts` and `flow-control.spec.ts` update to the kit controls
(toggle-groups and drawers instead of `<select>`s) — flows covered are
identical: create-from-scratch, edit-and-persist, summary-chip exactness,
disabled-Save validation, launch-mode reflow (chip updates, Start runs
reflowed, Save-to-plan persists, read-only content edits).
