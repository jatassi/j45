# Design — generate-screen

The Generate tab (`/generate`) rebuilt on the design system. The generator
rpc and constraint model are unchanged (`GenerateWorkout`, nothing
persisted); this is a form-and-preview redesign of `generate-screen.tsx`,
deleting its native `<select>`s and bare inputs.

## Layout

- **Constraint form**, one scrolling column of kit sections:
  - Focus: `toggle-group` (cardio | strength | hybrid via `focusLabel`,
    sport-hue accents).
  - Duration: minutes as a stepper `field` (5-minute steps, 15–45 range the
    generator supports).
  - Equipment: multi-select chip grid (`toggle-group` multiple) labeled via
    `equipmentLabel`; empty selection = bodyweight-only, stated inline.
  - Emphasis: muscle-group picker (`select` or chip row via
    `muscleGroupLabel`) with a "none" default.
  - No-repeat: the session-count stepper with a one-line explanation of what
    it excludes.
- **Generate** — primary orange button, full width.
- **Preview card**: the generated workout's codename as display heading,
  `FocusBadge`, `works · MM:SS` chip, pod/station outline, `data-seed`
  attribute (existing e2e contract). Actions: **Regenerate** (secondary),
  **Save** (primary; lands in library, quiet success → navigates to the
  saved workout's detail), **Edit** (opens the editor with the draft, the
  existing handoff).
- Feedback standard: generating state on the button (spinner, disabled);
  `GenerationInfeasible` renders as an inline `alert` naming the starved
  constraint (typed reason, already in the contract) with the form still
  editable — never a toast-only failure; Save failure → `sonner` toast.
- Empty history / fresh account changes nothing (no-repeat simply excludes
  nothing) — no special empty state needed beyond the form's defaults.

## e2e impact

`generate.spec.ts` updates selectors to the kit controls; covered flow is
identical (choose constraints → preview with codename + chip → regenerate
changes `data-seed` → save persists → edit opens editor).
