# plan-editing — design

## What it is

Full structural authoring of library workouts: create a workout from scratch
and edit everything the domain model expresses — name, focus, note, pods,
stations (name + detail), flow type (laps/sets), round count, and per-round
work/rest — at parity with the legacy day editor (`app.js:173-278`,
sanitization in `server.js:59-83`). plan-library deliberately shipped only
rename/duplicate/delete; this feature completes the authoring story.

## How it fits

Depends on `plan-library` and changes nothing structural: the `Workout` value
object stays the document, the `workouts` table stays the storage, ownership
stays absolute (`WHERE id = ? AND owner_id = ?`, foreign ids fail
`WorkoutNotFound`). Editing is a **whole-document replace** — the editor
builds a draft `Workout`, Schema validates it, and one rpc swaps the body.
No patch language, no per-field endpoints; at 1-3 KB documents and
friends/family scale, last-write-wins is correct.

Because every schema-valid `Workout` compiles (the compiler is total —
`segments.ts`), anything the editor can save is runnable. Validation is
therefore exactly "does the draft decode as `Workout`": nonempty name, ≥1 pod,
every pod ≥1 station, station names nonempty, `workSeconds > 0`,
`restSeconds ≥ 0`, ≥1 round. No second validation vocabulary.

## Rpc additions (`packages/domain/src/rpc.ts`, in `LibraryRpcs`)

```ts
Rpc.make('CreateWorkout', { payload: { workout: Workout }, success: LibraryWorkout }),
Rpc.make('UpdateWorkout', { payload: { id: WorkoutId, workout: Workout },
  success: LibraryWorkout, error: WorkoutNotFound }),
```

- `CreateWorkout` inserts a caller-owned row (fresh id, matching timestamps) —
  `WorkoutsRepo.insert` already exists (duplicate uses it); the handler just
  exposes it.
- `UpdateWorkout` replaces `body` entirely and bumps `updated_at`, atomically
  with the ownership check (`UPDATE … WHERE id = ? AND owner_id = ? RETURNING *`,
  the same shape `rename` already uses). `RenameWorkout` stays — the detail
  screen's quick rename keeps working unchanged.

The rpc payload schema is the validation: a structurally invalid workout
cannot cross the boundary at all, so the server needs no further checks
(legacy's `sanitizeFlow`/`sanitizePods` clamping has no equivalent — the
schema rejects instead of coercing, per the error posture).

## Server (`packages/server/src/library/`)

- `workouts-repo.ts` gains `update(id, ownerId, workout)` following `rename`'s
  decode → encode → `UPDATE … RETURNING` idiom (this is body replacement, so
  no pre-read is needed — encode the given workout, write, decode the row).
- `handlers.ts` adds the two members to `LibraryHandlersLive`, both scoped to
  `CurrentUser` with the existing `asDefect` SqlError posture.

**Live sessions were unaffected by edits.** That was true when this document
was written: a running session held its own frozen `CompiledWorkout` copy, so
editing or deleting the source workout changed the next session and never a
running one. **Live plan sync reverses it.** A running session now tracks its
source workout: a content edit reaches it at the next segment boundary, a
rename reaches it immediately, and a delete stops it. See the live-session
design for the propagation rules.

Because a save now reaches other people, the editor asks first. A save into a
workout that live sessions run stops at a confirm that states how many
sessions get the change; deleting such a workout stops at a stronger confirm,
because that action stops other people's workouts and has no undo. A rename
is ungated — it changes no work. With no live session neither path prompts,
so the common case keeps its speed. The count comes from the lobby list the
client already holds (`WatchActiveSessions`, whose rows carry their
`WorkoutId`), never from a new rpc.

## Client

Two new routes in `router.tsx`:

| Path | Screen |
|---|---|
| `/workouts/new` | WorkoutEditorScreen (blank draft) |
| `/workouts/$workoutId/edit` | WorkoutEditorScreen (draft from `GetWorkout`) |

Entry points: a **New workout** button on the library home; an **Edit** action
on the workout detail screen.

**WorkoutEditorScreen** holds the draft as plain React state (a mutable
mirror of `Workout.Encoded` — strings and numbers, so inputs bind directly)
and offers, at legacy-editor parity:

- name, focus (cardio/strength/hybrid select), note;
- pods: add, remove, rename; stations within a pod: add, remove, move up/down,
  each with name + optional detail field;
- flow: laps/sets toggle; round count; a "same work/rest every round" uniform
  toggle (uniform is UI sugar — the domain has only `rounds`; toggling off
  expands the single pair per round, toggling on collapses to round 1's pair,
  exactly the legacy editor's behavior); per-round work/rest second inputs
  when non-uniform.
- a live summary chip — exactly `N works · MM:SS` (e.g. `27 works · 26:45`;
  no suffix) — computed by running the domain `compile` on the draft whenever
  it decodes; doubles as the validity indicator (a non-decoding draft shows
  the first schema error instead, and Save is disabled).

Pinned editor behaviors that would otherwise diverge: when non-uniform, the
round-count input stays live, and growing the ladder seeds each new round
from the current last round's work/rest pair (shrinking truncates) — the
legacy editor's behavior. Draft numeric fields are held as **strings** (what
the inputs naturally hold, tolerating empty/in-flight states); the decode
step converts them.

Save decodes the draft (`Schema.decodeUnknown(Workout)`), calls
`CreateWorkout`/`UpdateWorkout`, refreshes **both** the list atom and the
workout's `GetWorkout` atom (the rename flow in `workout-detail-screen.tsx`
is the precedent — refreshing only the list leaves a stale detail screen),
and navigates to the workout's detail. Cancel navigates back without writing.

**Parity deltas, recorded:** (1) No "Reset to original" — that was an
overlay-over-base-plan concept; per-user copies have no base to reset to
(Duplicate-before-edit is the escape hatch). (2) No inline single-station
edit on the detail screen — the editor is one tap away and is the single
authoring surface; capability parity, not gesture parity. (3) Legacy's hard
caps (12 pods / 30 stations / 20 rounds / 3600s) are not reproduced; the
schema's own constraints are the law. All three deltas are deliberate.

## Testing

- **Integration (in-memory sqlite):** `CreateWorkout` inserts a caller-owned
  row returned as `LibraryWorkout`; `UpdateWorkout` replaces the body, bumps
  `updated_at`, preserves `created_at` and id; foreign and absent ids fail
  `WorkoutNotFound` for both; `ListWorkouts` reflects edits.
- **Unit:** the uniform-toggle expand/collapse logic; draft ↔ `Workout`
  decode round-trips including the failure messages the editor surfaces.
- **e2e (chromium + webkit):** create a workout from scratch (name, one pod,
  two stations, sets 3 × 30″/10″), save, detail shows it and the library
  lists it after reload; edit Athletica's copy — switch laps→sets, change a
  station name, reorder a station — save, detail reflects all three across a
  reload; the editor refuses an empty station name (Save disabled, error
  visible); the editor's summary chip for an untouched Athletica draft reads
  `27 works · 26:45` (agrees with the domain goldens).

## Out of scope (later features)

Reflow — regrouping stations into pods or sets↔laps *as a transform with
retiming* (`flow-control`; this editor moves individual stations by hand, it
does not transform structure); exercise autocomplete from the tagged catalog
(a natural later amendment once `exercise-library` lands — deliberately not a
dependency now); drag-and-drop (up/down buttons are the parity bar); undo
history; concurrent-edit merging.

## Notes for the builder

- Keep the draft as `Workout.Encoded`-shaped plain data; decode once at save
  and for the summary chip — do not maintain a parallel validity model.
- Number inputs hold intermediate empty/zero states while typing; the draft
  must tolerate them (they simply fail decode until corrected) without
  crashing the summary.
- `WorkoutsRepo.update` must not fabricate a new `created_at`; only
  `updated_at` moves.
