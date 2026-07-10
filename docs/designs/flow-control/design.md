# flow-control — design

## What it is

Structural reflow of a workout — regroup its stations into different pods, in
any order, dropping some; switch flow type (sets↔laps); optionally retime the
rounds — applied two ways from one vocabulary: **permanently** (rewrite the
saved plan) or as a **one-off overlay at session launch** (run it reflowed,
plan untouched). Canonical example from the brief: take "4 sets of push-ups"
(plus other stations run as sets) and run it as "4 laps of
push-up/sit-up/squat" without editing the saved plan — and also make that
change permanent when wanted.

## How it fits

The `Reflow` spec and its transform are pure domain code, exactly like the
segment compiler: server features orchestrate them, the client reuses them.
Launch-time application is **server-applied** — the spec travels in
`StartSession`'s payload and the server transforms then compiles, staying
authoritative over what a session runs. Edit-time application is
client-applied plus the existing whole-document `UpdateWorkout` — no new
mutation rpc (plan-editing's replace semantics already cover it).

## Domain (`packages/domain/src/reflow.ts`)

```ts
/** One pod of the reflowed workout: a name plus references into the source
 *  workout's stations by flattened index (pod order, then station order —
 *  the same order `segments.ts` flattens). */
export class ReflowPod extends Schema.Class<ReflowPod>('ReflowPod')({
  name: Schema.NonEmptyTrimmedString,
  stations: Schema.NonEmptyArray(Schema.Int.pipe(Schema.nonNegative())),
}) {}

/** A regrouping of a workout: new pod boundaries over the source stations
 *  (reorder and drop allowed — an index used at most once; duplication is
 *  out of scope), a flow type, and optional retiming. `rounds` absent means
 *  the source workout's rounds carry over unchanged. */
export class Reflow extends Schema.Class<Reflow>('Reflow')({
  pods: Schema.NonEmptyArray(ReflowPod),
  flowType: FlowType,
  rounds: Schema.optional(Schema.NonEmptyArray(Round)),
}) {}

/** A spec that does not fit its source workout (index out of range, index
 *  referenced twice). Carries a human-readable reason. */
export class ReflowInvalid extends taggedError<ReflowInvalid>()('ReflowInvalid', {
  reason: Schema.String,
}) {}

export const applyReflow: (
  workout: Workout,
  reflow: Reflow,
) => Either.Either<Workout, ReflowInvalid>
```

Semantics of `applyReflow`:

- Station indexes reference the source's stations flattened in pod order then
  station order. `flattenStations` in `segments.ts` is currently
  module-private; export it (or a shared helper) so reflow and the compiler
  cannot disagree about the order.
- Each index may appear **at most once** across all pods; unreferenced
  indexes are dropped stations. Out-of-range or duplicated indexes fail
  `ReflowInvalid` — never a silent fix-up. (Schema shape already forbids
  empty pods and dropping *every* station.)
- Stations carry over whole (`name` + `detail`). The result keeps the
  source's `name`, `focus`, and `note`; `flow` is
  `{ type: reflow.flowType, rounds: reflow.rounds ?? workout.flow.rounds }`.
- Total: every schema-valid `Reflow` whose indexes fit the source produces a
  schema-valid `Workout`, so anything reflowable is compilable and savable.

## Rpc change (`packages/domain/src/rpc.ts`, in `SessionRpcs`)

`StartSession` today:

```ts
Rpc.make('StartSession', {
  payload: { workoutId: WorkoutId },
  success: SessionSummary,
  error: WorkoutNotFound,
}),
```

becomes

```ts
Rpc.make('StartSession', {
  payload: { workoutId: WorkoutId, reflow: Schema.optional(Reflow) },
  success: SessionSummary,
  error: Schema.Union(WorkoutNotFound, ReflowInvalid),
}),
```

No new rpc group — `J45Rpcs` is untouched apart from the member's shape.

## Server (`packages/server/src/session/handlers.ts`)

`StartSession` applies the spec between the ownership-gated fetch and the
compile:

```ts
const library = yield* workoutsRepo.getOwned(workoutId, user.id)
const workout = reflow === undefined
  ? library.workout
  : yield* applyReflow(library.workout, reflow)   // Either → Effect; fails ReflowInvalid
const compiled = compile(workout)
```

`LiveSessions.start` params (`host`, `workoutName`, `compiled`) are unchanged
by this feature; `workoutName` stays the source name (reflow preserves it).
Nothing else in `live-sessions.ts` changes.

## Client

**The workout editor gains reflow tools; launch-time reflow is the same
editor in a launch mode.**

- **Normal mode** (existing `/workouts/new`, `/workouts/$workoutId/edit`):
  stations gain a cross-pod move (a "move to pod" control alongside the
  existing up/down buttons). This is ordinary content editing — the draft
  stays `Workout.Encoded`, saved via Create/UpdateWorkout as today.
- **Launch mode** (new route `/workouts/$workoutId/reflow`, entered from a
  **Start with reflow** action on the workout detail screen next to Start
  session): the editor loads the workout and restricts itself to
  spec-expressible operations — regroup/reorder stations across pods
  (station names and details are read-only; no add-station), rename/add/
  remove pods, flip laps/sets, edit rounds (the plan-editing uniform-toggle
  behavior carries over). The draft in this mode **is the `Reflow` spec**:
  pods of source-station references rendered by the same pod/station/rounds
  components, so drop = remove-station, reorder = move. The live summary
  chip (`N works · MM:SS`) recomputes via `applyReflow` + `compile` on every
  change and doubles as the validity indicator, exactly the editor's
  existing pattern.
- **Two exits:** **Start session** calls `StartSession({ workoutId, reflow })`
  and navigates to `/session/$sessionId` (the plan is untouched);
  **Save to plan** applies `applyReflow` client-side and calls the existing
  `UpdateWorkout`, then navigates to the detail screen (both atoms refreshed,
  per plan-editing's precedent).

Rounds default: launch mode opens with `rounds` unset (source timing carries
over); touching the rounds controls sets the override. The chip always shows
the recomputed truth either way.

## Testing

- **Unit (domain):** the canonical example — a sets workout whose flattened
  stations include push-up/sit-up/squat, regrouped into one 3-station pod run
  as laps, rounds carried — matches an exact golden compiled sequence
  (stations interleaved within each lap); reorder across pods; dropped
  stations absent from the result; rounds override replaces timing, absent
  override carries source rounds; name/focus/note preserved; out-of-range and
  duplicate indexes fail `ReflowInvalid`.
- **Integration:** `StartSession` with a spec yields
  `SessionState.compiled = compile(applyReflow(source, spec))` and the stored
  row is unchanged; invalid spec fails `ReflowInvalid`; foreign/unknown id
  still fails `WorkoutNotFound`.
- **e2e (chromium + webkit):** detail → Start with reflow → regroup + flip
  sets→laps → chip updates → Start runs the reflowed structure and the
  library workout is unchanged after reload; the same edits via Save to plan
  persist across reload; launch mode exposes no station-name inputs and no
  add-station control; normal mode's cross-pod move persists.

## Out of scope (later or never)

Duplicating a station into several pods (spec is at-most-once by design);
adding new stations at launch (content authoring stays edit-mode); named/saved
reflow presets; reflowing a session already running.

## Notes for the builder

- `applyReflow` returns `Either` so the handler lifts it into the rpc's error
  channel with `Effect.fromEither`-style plumbing; the client's Save-to-plan
  path can `Either.getOrThrow` safely after the chip has validated the draft.
- Keep the launch-mode draft as spec-shaped data (references), never a copied
  `Workout` — deriving the spec from a mutated copy is where duplicate-index
  bugs would breed.
- The chip and Start/Save exits must all consume the *same* memoized
  `applyReflow` result per draft state; recomputing per consumer risks
  chip/save divergence.
