# Design — design-system

The overhaul's foundation: the evolved token set, the expanded `ui/` kit,
domain vocabulary labels, the dev-only `/design` gallery, and
`packages/client/CLAUDE.md`. Every later slice composes from this one; extra
here is as much a failure as missing (a component nothing uses is scope
creep — install kit pieces the mapped screens actually consume).

## Tokens (`packages/client/src/index.css`)

Dark-only, `:root` scope (the `index-css-dark-only` unit test keeps
enforcing no `.dark` block). Values below are the working set validated by
eye in the `/proto` study and the Design-phase prototype session; they land
as oklch. `--background` stays pinned equal to `backdrop.ts` `BACKDROP_BASE`
(cross-file invariant, unit-tested today).

- **Ground / surfaces**: background `#08090b` (unchanged, pinned); card
  surface lifted slate (`#14171d`-family) with a `-2` step for nested
  surfaces; hairline `--border` stays white-alpha.
- **Signature accent**: `--primary` becomes the hot orange (`#ff6b35`-family,
  oklch-tuned; today's muted `oklch(0.47 0.157 37.304)` retires). Buttons,
  active tab, wordmark accent.
- **Sport-coded semantic hues** (new tokens — they carry meaning, never
  decoration): `--hue-cardio` (sky), `--hue-strength` (violet),
  `--hue-hybrid` (rose), `--hue-work` (green), `--hue-rest` (amber). Exposed
  via Tailwind `@theme inline` so variants can reference them
  (`text-hue-cardio` etc.). Focus badges, phase identity in players, chart
  accents in history.
- **Type**: Geist Variable stays the only family. A recorded scale:
  eyebrow (10–11px caps, `+0.16em` tracking, bold — the `.proto-eyebrow`
  idiom becomes a utility), body 14–16px, heading steps with heavy weights
  and tight tracking (`-0.02em`+), display/timer digits `tabular-nums` with
  tight tracking (the `.proto-nums` idiom). Utilities `text-eyebrow`,
  `text-display` (or equivalent `@utility` definitions) so screens never
  hand-roll the treatments.
- **Radius**: keep today's `--radius: 0.625rem` scale (already validated by
  the glass surfaces).
- **Motion**: one recorded language — durations 150ms (state), 250ms
  (enter/exit), eased `ease-out`; phase-tinted ambient pulses are CSS-only
  and always wrapped in `@media (prefers-reduced-motion: reduce)` overrides
  (the `/proto` pattern).

The `/proto` local tokens (`--proto-*`) retire when their values graduate
into `index.css`.

## Wordmark (decided in the Design prototype session)

The in-app J45 wordmark is **upright** Geist, heavy (`font-black`),
tight-tracked, white `J` + signature-orange `45` — prototype treatment 2, at
home in the glass `AppHeader`. Ships as a `Wordmark` component here so auth
screens and the header render the same lockup. An F45-construction badge
(fused block letters, inner keyline, notched plate — treatments 8–10 in the
study) was sketched and **parked**: the owner wants another swing at the
block drawing later, so keep the component seam (a `variant` prop is enough)
but do not build the badge now.

## `ui/` kit expansion (`bunx shadcn add`, Base UI — never Radix)

Installed and variant-extended in this feature; consumed app-wide by later
slices. Today only `button` and `card` exist. Add exactly the brief's mapped
set:

- **Forms**: `field`, `input`, `select`, `combobox` (exercise pickers),
  `toggle-group` (segmented choices: flow type, focus, Library
  Workouts|Exercises segment), `checkbox`, `label`, `spinner` (Base UI
  number field ships via `field`/`input` composition).
- **Overlays**: `drawer` (bottom sheet — phone-first default for pickers and
  the reflow launch mode), `dialog`, `alert-dialog` (destructive confirms).
- **Feedback**: `sonner` (command-failure toasts), `skeleton`, `empty`,
  `alert` (inline query failures), `progress`.
- **Display**: `badge` (+ sport-hue variants), `tabs`, `avatar`, `accordion`,
  `separator`.

Glass variants where decided: `drawer`/`dialog` surfaces are glass chrome
(overlays are chrome per the A+C role); content `card` stays opaque. Variants
express custom styling — one-off Tailwind on raw elements is the anti-pattern
this feature deletes.

**Feedback-state standard** (blanket rule, enforced by every screen slice's
acceptance): query loading → `skeleton`; empty → `empty` with a CTA; query
failure → inline `alert` + retry button (never indistinguishable from
loading); command failure → `sonner` toast, nothing silently swallowed;
destructive actions → `alert-dialog` confirm; success is quiet unless
invisible on-screen. A `QueryBoundary` helper (thin wrapper over
`Result.match`) standardizes the first three so screens can't diverge.

## Vocabulary labels (`@j45/domain`)

The six `Schema.Literal` unions get exhaustive label maps co-located with
each union — `Record<Literal, string>` so a new literal without a label is a
compile error. No generic humanizer fallback anywhere; the client never
renders a vocabulary literal raw.

```ts
// packages/domain/src/exercise.ts (same pattern in workout.ts for Focus/FlowType)
export const modalityLabel: Record<Modality, string> = { cardio: 'Cardio', strength: 'Strength' }
export const intensityLabel: Record<Intensity, string> = { low: 'Low', moderate: 'Moderate', high: 'High' }
export const muscleGroupLabel: Record<MuscleGroup, string> = { 'full-body': 'Full body', glutes: 'Glutes', hamstrings: 'Hamstrings', quads: 'Quads', calves: 'Calves', chest: 'Chest', back: 'Back', shoulders: 'Shoulders', biceps: 'Biceps', triceps: 'Triceps', core: 'Core' }
export const equipmentLabel: Record<Equipment, string> = { dumbbell: 'Dumbbells', barbell: 'Barbell', kettlebell: 'Kettlebell', plate: 'Plate', 'slam-ball': 'Slam ball', 'med-ball': 'Med ball', band: 'Band', cable: 'Cable', bench: 'Bench', box: 'Box', rower: 'Rower', bike: 'Bike', 'jump-rope': 'Jump rope', sliders: 'Sliders', 'pull-up-bar': 'Pull-up bar', sandbag: 'Sandbag' }
export const focusLabel: Record<Focus, string> = { cardio: 'Cardio', strength: 'Strength', hybrid: 'Hybrid' }
export const flowTypeLabel: Record<FlowType, string> = { laps: 'Laps', sets: 'Sets' }
```

Labels live in the domain (not the client) because generation errors,
completion snapshots, and any future server-rendered surface need the same
vocabulary. This feature converts existing screens' raw-literal renderings
(e.g. the exercise library's tag badges, generate's focus options) as part of
landing the rule.

## `/design` gallery (dev-only route)

A pre-gate pathname switch like `/glass` (outside `AuthGate`), rendering:
every token (palette swatches with names, type scale, radius, motion), every
`ui/` component in every variant (with the real glass system live for glass
variants), the sport-hue badge set labeled via the domain label maps, and the
feedback-state patterns. Excluded from production nav; reachable in prod
builds is acceptable (it leaks nothing).

## `packages/client/CLAUDE.md`

Concise, shipped here: the labels rule (never render a vocabulary literal
raw — import the domain label maps), Base-UI-not-Radix (imports come from
`@base-ui/react` via `ui/`), the design-system conventions (tokens + variants,
no one-off Tailwind on raw form elements; feedback-state standard), and the
glass gotcha (`.glass-surface` forces `position: relative` — glass surfaces
need a positioned wrapper; Tailwind positioning classes on the same element
silently lose).

## Constraints

- No screen redesigns here beyond the raw-literal conversions; screens keep
  their current layouts until their own slice.
- `bun run check` / `test` / `test:e2e` green; the glass e2e suite unchanged.
