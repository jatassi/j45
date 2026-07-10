# workout-generation — design

## What it is

Rule-based procedural workout generation: "generate me a 45-minute hybrid
workout with dumbbells and a kettlebell" produces a runnable, sensible
`Workout` drawn from the caller's tagged exercise catalog, structured by a
built-in template catalog, excluding exercises from their recent sessions —
deterministic given a seed, no LLM, no external service. The result arrives
as a **preview**: nothing persists until the user saves it.

## How it fits

The generator is a pure function in `domain` (like the compiler and reflow):
`generate(catalog, recentNames, constraints)` → `Workout`. The server
assembles its inputs — the caller's `LibraryExercise` rows and the station
names from their last-N `SessionCompletion` snapshots (session-history's
records are exactly the recency source the brief planned) — and returns the
workout without writing anything. Saving goes through the existing
`CreateWorkout`; editing first goes through the existing editor. The
exercise catalog is a **vocabulary, never a foreign key** (glossary): the
generated stations carry exercise names (and `detail`) as plain text, exactly
like hand-authored ones.

## Domain (`packages/domain/src/generation.ts` + `templates.ts`)

Constraint schema — the rpc payload and the pure function's input:

```ts
/** The generate form's knobs. `equipment` is the ALLOWED set (an exercise
 *  qualifies when its equipment is a subset — empty allowed set means
 *  bodyweight-only). `emphasis` filters strength-modality picks to that
 *  muscle group. `noRepeatSessions` is N (0 disables). `seed` makes the
 *  whole generation deterministic; Regenerate is just a fresh seed. */
export class GenerationConstraints extends Schema.Class<GenerationConstraints>(
  'GenerationConstraints',
)({
  focus: Focus,
  targetMinutes: Schema.Int.pipe(Schema.positive()),
  equipment: Schema.Array(Equipment),
  emphasis: Schema.optional(MuscleGroup),
  noRepeatSessions: Schema.Int.pipe(Schema.nonNegative()),
  seed: Schema.Int,
}) {}

/** Constraints starved the pool or no template fits the duration. The
 *  reason is human-readable and names the starving constraint. */
export class GenerationInfeasible extends taggedError<GenerationInfeasible>()(
  'GenerationInfeasible',
  { reason: Schema.String },
) {}

export const generate: (
  catalog: readonly Exercise[],
  recentNames: readonly string[],       // station names from the last N snapshots
  constraints: GenerationConstraints,
) => Either.Either<Workout, GenerationInfeasible>
```

**Templates** (`templates.ts`): a fixed catalog of structural skeletons
modeled on the seed program's real shapes — each `{ name, podStationCounts:
number[], flowType, rounds }` (e.g. 3 pods × 3 stations, laps 3×40″/20″; 9
stations, sets 4×35″/25″; ladder variants). A template's duration is fully
determined by its shape (the compiler's math with station names irrelevant),
so the catalog can be tuned to span **15–45 minutes such that every 5-minute
target in that band has a template within tolerance** — a unit-tested
guarantee, not a hope.

**Selection — filter, then pick (no composition rules, a deliberate choice):**

1. Pool = catalog where `exercise.equipment ⊆ allowed`, modality matches
   focus (`cardio`→cardio, `strength`→strength, `hybrid`→either), and — when
   `emphasis` is set — strength-modality entries include that muscle group.
2. Subtract `recentNames` (case-insensitive name match, the same matching
   rule as the catalog's own uniqueness).
3. Eligible templates = compiled duration within **±10% of
   `targetMinutes`**; none → `GenerationInfeasible` (duration reason).
4. A seeded PRNG (mulberry32-style, pure, in `domain` — never
   `Math.random`) picks one eligible template, then samples the pool
   **without replacement** to fill its stations (pool smaller than the
   template's station count → `GenerationInfeasible` naming the starving
   filter). Station `name`/`detail` copy from the exercise.
5. Result `Workout`: a deterministic codename from the seed (two small word
   lists in `domain`, e.g. "Iron Falcon"), `focus` from constraints, pods
   named from the template, flow from the template.

## Rpc (new group, `packages/domain/src/rpc.ts`)

Merged into `J45Rpcs` **in the same commit** as its handler layer (the
pre-commit check enforces this):

```ts
export class GenerationRpcs extends RpcGroup.make(
  Rpc.make('GenerateWorkout', {
    payload: { constraints: GenerationConstraints },
    success: Workout,
    error: GenerationInfeasible,
  }),
).middleware(AuthMiddleware) {}
```

## Server (`packages/server/src/generation/handlers.ts`)

`GenerateWorkout`: `ExercisesRepo.listForUser(user.id)` → decode to
`Exercise` values; `CompletionsRepo.listForUser(user.id)` → take the newest
`noRepeatSessions` records and collect their snapshots' distinct station
names; call `generate`; return the `Workout` (Either lifted into the error
channel). **No insert** — the preview is stateless. Standard `asDefect`
SqlError posture. Another user's history and catalog never participate.

## Client

New route `/generate` (nav link from the library home). The form: focus
select, target-minutes input, equipment chip multi-select (rendered from the
`Equipment` schema literals — the same domain vocabulary the exercise editor
uses; **default all selected**), optional emphasis select (from
`MuscleGroup` literals), no-repeat stepper (default **3**, 0 disables).

**Generate** draws a fresh client-side seed and calls the rpc; the preview
card shows the codename, the pods/stations, and the `N works · MM:SS` chip
(domain `compile`, the editor's exact chip), plus `data-seed` for e2e.
**Regenerate** = new seed, same constraints. **Save** = `CreateWorkout` with
the previewed workout, then navigate to its detail (list atom refreshed).
**Edit** = open the workout editor seeded with the preview as its draft
(the editor gains an "initial draft" entry alongside blank-and-loaded — a
small, ordered-by-the-graph change since flow-control also touches the
editor). `GenerationInfeasible` renders as the form's error state with the
reason text — never a blank preview.

## Testing

- **Unit (domain):** determinism — identical inputs and seed yield an
  identical `Workout`; the result always decodes and compiles; every station
  names a pool exercise honoring equipment-subset, focus-modality, and
  emphasis rules; `recentNames` never appear; for each target 15–45 min in
  5-min steps with the full seed catalog, compiled total is within 10% of
  target; starved pool and unfittable duration each fail
  `GenerationInfeasible` with the constraint named; template catalog
  invariants (every template fills to a valid, compiling workout).
- **Integration:** `GenerateWorkout` uses only the caller's catalog and
  last-N snapshots (a name in the caller's recent history is excluded;
  another user's identical history has no effect); `ListWorkouts` is
  byte-identical before and after a generate (nothing persisted); N=0
  disables exclusion.
- **e2e (chromium + webkit):** `/generate` via home nav → set knobs →
  Generate shows the preview with codename and works·duration chip →
  Regenerate changes `data-seed` → Save lands it in the library (survives
  reload) → Edit opens the editor on the draft.

## Out of scope (later or never)

LLM generation (brief non-goal); composition rules (muscle-group adjacency,
cardio/strength interleaving — deliberately filter-only for now); an
equipment *profile* saved per user (the form remembers nothing);
multi-workout program generation; weighting/recency decay beyond the hard
no-repeat window.

## Notes for the builder

- The PRNG and codename lists live in `domain` and take the seed as input —
  `Math.random`/`Date.now` never appear (determinism is an acceptance
  criterion, and workflow scripts can't stub them).
- Equipment-subset uses set inclusion over the literal strings; an exercise
  with empty equipment (bodyweight) qualifies under every allowed set.
- Recent-name matching must reuse one case-insensitive normalizer shared
  with the catalog's uniqueness rule — two normalizers will drift.
- Keep `generate`'s signature free of Effect — plain `Either` in, plain
  data out; the handler does the lifting.
