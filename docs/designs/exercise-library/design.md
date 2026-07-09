# exercise-library — design

## What it is

A first-class, per-user catalog of tagged exercises — muscle groups,
equipment, modality, intensity — seeded from the program content, browsable
and editable in the client. It exists to make `workout-generation` possible
(the generator composes *tagged* exercises under constraints) and stands
alone as a useful reference ("what can I do with just dumbbells?").

## How it fits

Depends on `plan-library` and copies its ownership pattern wholesale: every
exercise row has exactly one owner, registration seeds a frozen catalog into
each new account (same transaction as the user row), a migration backfills
existing accounts, foreign ids are indistinguishable from absent ones.

**Stations do not reference exercises.** A `Station` stays free text
(`name` + optional `detail`) — the catalog is a vocabulary, not a foreign-key
target. This is deliberate: normalizing stations to exercise ids would break
the seed workouts' combo stations ("A: Kettlebell swing · B: Hand-release
burpee"), make ad-hoc entries second-class, and buy nothing the generator
needs — generation *produces* stations from exercises (name flows catalog →
station at generation time), and no-repeat-recently constraints operate on
what the generator itself emitted. If linking ever proves necessary, an
optional annotation can be added later; starting linked cannot be walked back.

## Domain additions (`packages/domain/src/exercise.ts`)

Pure Schema; package deps stay exactly `effect` + `@effect/rpc`. The tag
vocabularies are closed literal unions — pinned here, grounded in the actual
104 distinct station texts of the 12 seed workouts:

```ts
export const Modality = Schema.Literal('cardio', 'strength')
export const Intensity = Schema.Literal('low', 'moderate', 'high')
export const MuscleGroup = Schema.Literal(
  'full-body', 'glutes', 'hamstrings', 'quads', 'calves',
  'chest', 'back', 'shoulders', 'biceps', 'triceps', 'core',
)
export const Equipment = Schema.Literal(
  'dumbbell', 'barbell', 'kettlebell', 'plate', 'slam-ball', 'med-ball',
  'band', 'cable', 'bench', 'box', 'rower', 'bike',
  'jump-rope', 'sliders', 'pull-up-bar', 'sandbag',
)

export class Exercise extends Schema.Class<Exercise>('Exercise')({
  name: Schema.NonEmptyTrimmedString,
  detail: Schema.optional(Schema.String),        // substitution/setup note
  modality: Modality,
  muscleGroups: Schema.NonEmptyArray(MuscleGroup),
  equipment: Schema.Array(Equipment),            // empty = bodyweight
  intensity: Intensity,
}) {}

export const ExerciseId = Schema.String.pipe(Schema.brand('ExerciseId'))

export class LibraryExercise extends Schema.Class<LibraryExercise>('LibraryExercise')({
  id: ExerciseId,
  exercise: Exercise,
  createdAt: Schema.DateTimeUtc,
  updatedAt: Schema.DateTimeUtc,
}) {}

// via the file-local `const taggedError = Schema.TaggedError` alias —
// the mandatory oxlint workaround documented in library.ts/auth.ts
// (unicorn/throw-new-error false-positives on callees ending in "Error")
export class ExerciseNotFound extends taggedError<ExerciseNotFound>()(
  'ExerciseNotFound', { id: ExerciseId },
) {}
```

An empty `equipment` array *means* bodyweight — no `'bodyweight'` literal to
keep in sync with the array's emptiness. `'hybrid'` is deliberately not a
modality: a station that mixes a sprint with a deadlift is two exercises; the
*workout* focus (`cardio`/`strength`/`hybrid`) stays a `Workout` concern.
Two literals were deliberately **left out** as unearnable from the seed data:
no `treadmill` (its only mention is the alternative in "Bike or treadmill" —
that entry is `bike`, alternative in `detail`) and no generic `legs`
(compound leg movements tag the specific sub-groups — quads, glutes,
hamstrings, calves — so the vocabulary has one way to say each thing).

`rpc.ts` grows an `ExerciseRpcs` group, merged into `J45Rpcs` like the others:

```ts
export class ExerciseRpcs extends RpcGroup.make(
  Rpc.make('ListExercises', { success: Schema.Array(LibraryExercise) }),
  Rpc.make('CreateExercise', { payload: { exercise: Exercise }, success: LibraryExercise }),
  Rpc.make('UpdateExercise', { payload: { id: ExerciseId, exercise: Exercise },
    success: LibraryExercise, error: ExerciseNotFound }),
  Rpc.make('DeleteExercise', { payload: { id: ExerciseId }, error: ExerciseNotFound }),
).middleware(AuthMiddleware) {}
```

List returns the caller's whole catalog sorted by name (case-insensitive,
like `ListWorkouts`); no pagination, no `GetExercise` — the list is the
working set and edit dialogs operate on already-listed data. Duplicate names
are allowed (consistent with workouts; the seeds happen to be unique).

## The seed catalog (`packages/server/src/library/seed-exercises.ts`)

Frozen, already-encoded `Exercise` JSON literals, exactly like
`seed-workouts.ts` (same rationale: a later schema change cannot silently
change what the migration inserts). Hand-curated at build time from the 12
seed workouts' stations under these rules:

- **Split combos:** `A: x · B: y` stations become two entries (x, y).
- **Collapse cue variants:** tempo/count/pace suffixes (`— tempo 4-0-1`,
  `— fast, hips low`, `— 5 each side`, `(30s)`) collapse into the base
  movement; genuinely distinct movements (e.g. `Bike (seated)` vs
  `Bike — climb (high resistance)`) stay one entry, `Bike`, with the
  variation left to `detail` or dropped.
- **Alternatives pick the primary:** `Slam ball / dumbbell RDL`-style either/or
  texts become the primary implement's exercise; the alternative goes in
  `detail` ("or dumbbell").
- Every entry gets modality, ≥1 muscle group, equipment (empty = bodyweight),
  and intensity by judgment; the curation itself is the build task.

Expected yield: **at least 80 distinct exercises** (104 station texts, +8
from combo splits, −collapses/dedup).

## Server (`packages/server/src/library/`)

- **Migration `0004_exercises`:** an `exercises` table shaped exactly like
  `workouts` (`id`, `owner_id REFERENCES users(id)`, `body`, `created_at`,
  `updated_at`, plus the `owner_id` index), then the backfill: seed every
  existing user via the repo, the same single-code-path discipline as 0003.
- **`exercises-repo.ts`** — `ExercisesRepo`, a structural sibling of
  `WorkoutsRepo`: `listForOwner`, `insert`, `update`, `delete`,
  `seedForUser`; every scoped query `WHERE id = ? AND owner_id = ?`.
- **`exercise-handlers.ts`** — `ExerciseHandlersLive = ExerciseRpcs.toLayer(…)`,
  merged into `RpcHandlersAll`; `ExercisesRepo.Default` joins the service
  bundles.
- **Registration:** `Accounts.register` calls `exercisesRepo.seedForUser`
  alongside the existing `workoutsRepo.seedForUser`, inside the same
  transaction — an account, its 12 workouts, and its exercise catalog appear
  atomically or not at all.

## Client

One new route, `/exercises` (ExerciseLibraryScreen), nav-linked from the
library home alongside the existing Account link (and whatever nav siblings
exist by build time — `/timer` is a sibling feature). The screen: the catalog as a compact
list (name, tag badges), with filter chips across the top — by muscle group,
equipment, and modality (chips AND across facets, OR within one). Actions:
create (dialog with name, detail, modality, intensity selects, muscle-group
and equipment multi-selects), edit (same dialog pre-filled), delete
(confirm). Mutations refresh the list atom; the existing `useAtomValue` +
`Result.match` idiom throughout.

## Testing

- **Unit (vitest):** every seed entry decodes as `Exercise`; seed names are
  unique case-insensitively; the catalog has ≥ 80 entries; every muscle
  group and every equipment literal is used by at least one seed (the
  vocabulary earns its members); spot checks: `Rower` (cardio, equipment
  `rower`), `Barbell front squat` (strength, equipment `barbell`),
  `Burpee` (bodyweight — empty equipment).
- **Integration (in-memory sqlite):** registration seeds workouts *and*
  exercises atomically (a failed registration creates none of the three);
  two accounts get independent catalogs; migration 0004 backfills a
  pre-existing user; `ListExercises` returns only the caller's rows;
  foreign/absent `Update`/`Delete` fail `ExerciseNotFound`.
- **e2e (chromium + webkit):** `/exercises` via home nav lists the seeded
  catalog; a muscle-group filter chip narrows the list; creating an exercise
  shows it in the list and it persists across reload; editing its tags
  persists; delete removes it.

## Out of scope (later features)

The generator and its constraint model (`workout-generation` — it consumes
this catalog); station↔exercise linking and editor autocomplete (revisit
with generation, when catalog→station flow exists); exercise images or
animations (parked, see the `exercise-animations` record); sharing catalogs
between users; import from external datasets.

## Notes for the builder

- The curation of `seed-exercises.ts` is judgment work — do it against the
  real station list (extract from `seed-workouts.ts`), keep names in the
  program's own vocabulary (a user should recognize "Dumbbell renegade row"
  from their workouts), and let the unit tests pin the result.
- Copy `workouts-repo.ts`'s shape faithfully (decode-or-die on stored rows,
  `DateTime.now` timestamps, `RETURNING` for atomic check-and-write) — the
  two repos should read as twins.
- Seed-freeze discipline applies here exactly as recorded in plan-library's
  design: a future migration transforming `exercises.body` must regenerate
  the seed file in the same commit and tolerate both shapes.
