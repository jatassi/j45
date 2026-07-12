# Design — library-screens

Interior redesign of the Library tab: the workout list at `/library`, the
exercise catalog segment at `/library/exercises`, and the workout detail at
`/workouts/$workoutId`. Builds entirely on `design-system` + `nav-shell`;
no rpc or domain changes — the data layer (`listWorkoutsAtom`,
`lib/exercises.ts` atoms, `GetWorkout`) is reused as-is.

## `/library` — workout list

- A `toggle-group` segment control under the header: **Workouts | Exercises**
  (drives the two child routes; state lives in the URL).
- Workout rows as opaque content cards (the A+C role: content never glass):
  name in a heavy tight-tracked heading, `FocusBadge` (sport-hue badge
  variant, label from `focusLabel`), works · MM:SS summary line
  (`formatDuration` exists), whole-card link to detail. Press feedback
  (`active:` scale/opacity) for sweaty thumbs.
- Primary action: a **New workout** button (header action slot or a leading
  card) → `/workouts/new`. Duplicate/rename/delete move off this screen —
  they live on the detail (today's list is already navigation-only; keep it
  that way).
- Feedback standard: skeleton rows while loading; `empty` with a "New
  workout" CTA if the library is somehow empty; inline `alert` + retry on
  query failure.

## `/library/exercises` — catalog segment

Replaces `exercise-library-screen.tsx`'s interior and **deletes
`exercise-dialogs.tsx`** (the last hand-rolled fixed-overlay dialog):

- Filter chips become `toggle-group`s (muscle group / equipment / modality),
  labels from the domain label maps — the raw kebab-case ids rendered today
  are exactly the bug this overhaul kills.
- Exercise rows: name, `badge` set for tags (sport-hue for modality), edit
  affordance.
- Create/edit moves into a **`drawer`** (bottom sheet — phone-first) built
  from `field`/`input`/`select`/`toggle-group`; delete confirm is an
  `alert-dialog`. Command failures toast via `sonner`.

## `/workouts/$workoutId` — detail

Keeps the tab bar (Library context). Interior:

- Title block: workout name, `FocusBadge`, flow summary (labels from
  `flowTypeLabel`), works · MM:SS.
- **Start** is the dominant action (large signature-orange button); **Start
  with reflow** secondary beside it.
- Pod/station structure as opaque cards — pods as sections, stations as rows
  with work/rest chips (today's `PodCard` content, design-system treatment).
- Manage actions (Edit / Rename / Duplicate / Delete) collapse into a
  header-action **`drawer`** (or inline row of secondary buttons — builder's
  latitude within the kit); rename uses `dialog` + `field` (replacing the
  hand-styled Base-UI popup and its bare `<input>`), delete uses
  `alert-dialog`.
- Feedback standard throughout; `WorkoutNotFound` renders the inline `alert`
  state with a back-to-library CTA.

## e2e impact

`library.spec.ts`, `exercises.spec.ts`, and the detail assertions inside
`plan-editing.spec.ts`/`flow-control.spec.ts` update to the new selectors and
paths (`/library`, `/library/exercises`) in this slice. Flows covered stay
identical: list/open/duplicate/rename/delete, catalog CRUD + filter,
logged-out deep link to a workout detail.
