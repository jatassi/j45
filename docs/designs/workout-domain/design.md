# workout-domain — design

## What it is

The pure heart of J45, all in `packages/domain`: the typed Schema model of a
workout (pods, stations, flow), the **segment compiler** that turns a workout
into the flat timed sequence a session runs, and the **timer state machine**
that advances through that sequence with absolute deadlines. No rpc changes, no
persistence, no UI — this feature is validated entirely by `bun run check` and
`bun run test`.

Timing identity with the legacy app is the bar: any legacy workout, expressed
in the new model, must compile to the same segment durations in the same order
the old engine ran (`buildSegments` + `begin/advance/pause/resume/skip/prev` in
`~/Git/diet-f45/server.js:132-194`). The quirks of that algorithm are contract,
not accident — they are itemized below so the builder never re-derives them.

## Fit with the architecture

- Lives in `packages/domain` only. The package's dependency set stays exactly
  `effect` + `@effect/rpc` (see `packages/domain/package.json`); nothing here
  may import platform code. Exported from `src/index.ts` alongside the
  existing `rpc.ts` (which is untouched — this feature adds no rpc).
- Everything is Schema-typed so later features stream/persist these values
  as-is: `TimerState` and `Segment` will ride inside live-session's
  `SubscriptionRef<SessionState>` snapshots; `Workout` will be the persisted
  document body in plan-library.
- Follows the repo's established idioms: `Schema.Class` /
  `Schema.TaggedClass` value objects (vendored effectts references),
  `@effect/vitest` under Node vitest, structural equality via `Equal.equals`.
- The server remains the clock of record; this feature supplies the *math*
  (pure functions over epoch-millis timestamps), not the driver. Drivers
  (live-session's ticker fiber, manual-timer's client loop) obtain `now` from
  Effect `Clock`, which is what makes the whole thing TestClock-testable.

## The model

Illustrative shapes — the builder may adjust field details, not the structure:

```ts
// packages/domain/src/workout.ts
export class Round extends Schema.Class<Round>("Round")({
  workSeconds: Schema.Int.pipe(Schema.positive()),     // legacy range 20–240
  restSeconds: Schema.Int.pipe(Schema.nonNegative())   // 0 is legal: "no rest"
}) {}

export class Station extends Schema.Class<Station>("Station")({
  name: Schema.NonEmptyTrimmedString,          // PLAIN TEXT — no HTML in the domain
  detail: Schema.optional(Schema.String)       // e.g. "(step back = no-jump)"
}) {}

export class Pod extends Schema.Class<Pod>("Pod")({
  name: Schema.NonEmptyTrimmedString,
  stations: Schema.NonEmptyArray(Station)
}) {}

export const FlowType = Schema.Literal("laps", "sets")

export class Flow extends Schema.Class<Flow>("Flow")({
  type: FlowType,
  rounds: Schema.NonEmptyArray(Round)          // rounds.length IS the lap/set count
}) {}

export const Focus = Schema.Literal("cardio", "strength", "hybrid")

export class Workout extends Schema.Class<Workout>("Workout")({
  name: Schema.NonEmptyTrimmedString,
  focus: Focus,
  note: Schema.optional(Schema.String),
  pods: Schema.NonEmptyArray(Pod),
  flow: Flow
}) {}
```

Deliberate deviations from the legacy JSON (`public/workouts.json` in the
legacy repo), all of which plan-library's seed migration absorbs later:

- **Canonical rounds array.** Legacy `flow.iv` had two shapes: a uniform
  `[work, rest]` pair or a per-round ladder `[[w,r], …]`. Here there is one
  shape: a nonempty `rounds` list whose length is the count. "Uniform" is just
  identical rounds; the ladder-padding/truncation sanitization and the
  out-of-range `ivAt` hazard disappear. Display code can render "40″/20″ × 3"
  by detecting all-equal rounds.
- **Plain text stations.** Legacy exercise strings carry inline HTML
  (`<span class='sub'>…`, C/R tags, A/B `<b>` combos). The domain stores plain
  text (`name` + optional `detail`); presentation markup is the client's job.
- **Dropped display-only fields.** Legacy `chips` and `timing` are free-form
  display strings (and sometimes wrong — Red Diamond's chip says 3 pods, the
  data has 1). They are derivable from `flow`/`pods` and are not modeled.
  `focus: "resist"` is renamed `"strength"`. Legacy `n`/week structure,
  `reel`, warmup/cooldown/swaps/arc/rhythm are Program/seed concerns
  (plan-library), not workout content.
- **No identity, no ownership.** `Workout` is a value object. IDs, owners, and
  library membership arrive with plan-library wrapping this type; compile and
  timer math never need identity.

## Segment compiler

```ts
// packages/domain/src/segments.ts
export const READY_SECONDS = 30

export class WorkContext extends Schema.Class<WorkContext>("WorkContext")({
  station: Station,
  podIndex: Schema.Int,        // 0-based
  podName: Schema.String,
  stationInPod: Schema.Int,    // 1-based
  round: Schema.Int,           // 1-based lap or set number
  workIndex: Schema.Int        // 0-based across the whole workout
}) {}

export class ReadySegment extends Schema.TaggedClass<ReadySegment>()("ready", {
  durationMillis: Schema.Int
}) {}
export class WorkSegment extends Schema.TaggedClass<WorkSegment>()("work", {
  durationMillis: Schema.Int,
  work: WorkContext
}) {}
export class RestSegment extends Schema.TaggedClass<RestSegment>()("rest", {
  durationMillis: Schema.Int,
  nextWork: WorkContext        // legacy refWork: what "Next · …" displays
}) {}
export const Segment = Schema.Union(ReadySegment, WorkSegment, RestSegment)

export class CompiledWorkout extends Schema.Class<CompiledWorkout>("CompiledWorkout")({
  segments: Schema.NonEmptyArray(Segment),
  workTotal: Schema.Int,
  totalDurationMillis: Schema.Int
}) {}

export const compile: (workout: Workout) => CompiledWorkout
```

`compile` is total — a schema-valid `Workout` always compiles; there is no
error channel.

The algorithm, exactly as legacy `buildSegments` (server.js:132-154). Each rule
below is observable in the golden fixtures and none may be "fixed":

1. **Work ordering, `laps`:** pod-major. For each pod in order, run **all
   rounds of that pod** before moving to the next pod; within a round, its
   stations in order. (Athletica: Pod1 L1s1..s3, L2s1..s3, L3s1..s3, then
   Pod2…, Pod3….)
2. **Work ordering, `sets`:** station-major over the pods flattened in order.
   For each station, all rounds back-to-back before the next station.
3. **Durations by round:** work and rest come from `rounds[round-1]` — in
   `laps` mode indexed by lap, in `sets` mode by set.
4. **Rest insertion:** one rest after every work **except the very last work
   of the whole workout**; a rest whose value is 0 is omitted entirely (no
   zero-length segments).
5. **Rest value = the *completed* work's round** — not the upcoming one. So
   the rest bridging lap N → lap N+1 uses lap N's rest, and the rest bridging
   pod → pod uses the finished pod's **final round's** rest. (Docklands' pod
   bridges are 5s, its lap-4 rest, not 30s.)
6. **Ready:** exactly one leading `ready` segment of `READY_SECONDS = 30`,
   before the first work only. No per-lap or per-pod countdowns. After the
   last work the sequence just ends (the timer, not the compiler, represents
   "done").

Golden fixtures — four legacy days transcribed into the new model (vendored in
`packages/domain/test/fixtures/legacy.ts`, HTML stripped to plain text), with
totals derived by hand from the legacy algorithm:

| Fixture | Legacy shape | Works | Rests | Total |
|---|---|---|---|---|
| Athletica | laps ×3, uniform 40/20, 3 pods × 3 | 27 | 26 × 20s | **1630s** |
| Docklands | laps ×4, ladder 60/30·30/15·20/10·20/5, 3 pods × 3 | 36 | 35 (pod bridges = 5s) | **1735s** |
| Medusa | sets ×3, ladder 60/15·60/20·60/30, 1 pod × 9 | 27 | 26 (station bridges = 30s) | **2205s** |
| Apex | laps ×1, uniform 240/30, 1 pod × 8 | 8 | 7 × 30s | **2160s** |

Tests assert the full segment sequence (type, duration, ordering of the work
contexts), not just totals — the totals are the cross-check.

## Timer math

```ts
// packages/domain/src/timer.ts
export class TimerIdle extends Schema.TaggedClass<TimerIdle>()("idle", {}) {}
export class TimerRunning extends Schema.TaggedClass<TimerRunning>()("running", {
  segmentIndex: Schema.Int,
  endsAtMillis: Schema.Number       // absolute epoch millis — never a countdown
}) {}
export class TimerPaused extends Schema.TaggedClass<TimerPaused>()("paused", {
  segmentIndex: Schema.Int,
  remainingMillis: Schema.Number
}) {}
export class TimerDone extends Schema.TaggedClass<TimerDone>()("done", {}) {}
export const TimerState = Schema.Union(TimerIdle, TimerRunning, TimerPaused, TimerDone)
```

Pure transition functions over `(state, segments, nowMillis)`; every function
is total (a transition that doesn't apply returns the state unchanged):

| Function | Behavior (= legacy server.js:169-194 unless noted) |
|---|---|
| `start` | → running at segment 0 (the ready segment), `endsAt = now + dur`. |
| `advanceIfDue` | While running and `now ≥ endsAt`: enter the next segment; past the last segment → done. **Chains deadlines** (`nextEndsAt = prevEndsAt + nextDur`), and loops across multiple elapsed boundaries, so a late or slept driver produces no drift — a deliberate improvement over legacy's `Date.now()`-at-timeout-fire; segment durations and order are what timing-identity means, not setTimeout jitter. |
| `pause` | running → paused with `remaining = max(0, endsAt − now)`. No-op otherwise. |
| `resume` | paused → running with `endsAt = now + remaining`. No-op otherwise. |
| `skip` | Enter the next segment at **full duration** from `now`; on the last segment → done. |
| `prev` | done → last segment at full duration; `segmentIndex > 0` → previous segment at full duration; **on segment 0: no-op**. |
| `quit` | any → idle. |
| `remainingMillis` | running: `max(0, endsAt − now)`; paused: the snapshot; idle/done: 0. |
| `nextTransitionAt` | `Option<millis>` — running: `endsAt`; otherwise none. This is the whole driver contract: sleep until it, then call `advanceIfDue`. |

Entering a segment always resets it to full duration (skip/prev/restart never
preserve partial time) — legacy behavior, load-bearing for UX parity.

Explicitly **not** in the domain: beeps and display formatting. They are pure
client presentation, derivable from what the domain exposes — segment-entry
cues from `segmentIndex` changes, 3-2-1 countdown cues from
`ceil(remainingMillis/1000) ∈ {3,2,1}`, `MM:SS` via ceil. The legacy cue spec
(frequencies, the silent first segment, the manual timer's lack of 3-2-1
beeps) is recorded in live-session's and manual-timer's future designs' source
material, not here.

## What downstream features consume

- **plan-library** persists `Workout` as the document body and migrates the
  legacy 12-day dataset + overrides into it (the field-mapping deviations
  above are its spec).
- **live-session** wraps `CompiledWorkout` + `TimerState` in its
  `SessionState`, drives transitions from a ticker fiber via `Clock`, and
  streams the results — it contains no timer arithmetic of its own.
- **manual-timer** builds its own tiny segment list (uniform work/rest ×
  rounds, no ready segment, rest-0 omitted — expressible with the compiler's
  segment types directly) and drives the same `TimerState` machine client-side.
- **flow-control** is `Workout → Workout` transforms: because flow and pod
  structure are plain data on the workout, edit-time reflow persists the
  transformed value and launch-time reflow compiles it without persisting.
- **workout-generation** produces `Workout` values from templates; the
  compiler gives it duration budgeting for free via `totalDurationMillis`.

## Module layout

```
packages/domain/src/
  workout.ts     # Round, Station, Pod, Flow, Focus, Workout
  segments.ts    # Segment types, WorkContext, CompiledWorkout, READY_SECONDS, compile
  timer.ts       # TimerState union + transition functions
  index.ts       # adds export * for the three new modules (names are disjoint)
packages/domain/test/
  fixtures/legacy.ts   # the four transcribed legacy days + expected segment goldens
  workout.test.ts, segments.test.ts, timer.test.ts
```

## Testing

- `@effect/vitest` under the existing root vitest runner (`bun run test`),
  matching `packages/domain/test/rpc.test.ts` conventions (`it.effect`,
  `Schema.encode`/`decodeUnknown` round-trips).
- Schema tests: round-trip each model type; reject empty pods, empty
  stations, empty rounds, `workSeconds ≤ 0`, `restSeconds < 0`.
- Compiler tests: the four golden fixtures asserted segment-by-segment;
  a zero-rest round emits adjacent works with no rest between; rule 5's
  bridge-rest quirk asserted explicitly on Docklands and Medusa.
- Timer tests: `it.effect` programs that get `now` from
  `Clock.currentTimeMillis` and step time with `TestClock.adjust`, walking a
  small compiled workout through every transition in the table above,
  including: boundary-exact advancement, multi-segment catch-up after a long
  sleep (chained deadlines), pause freezing remaining across TestClock
  adjustment, prev-on-segment-0 no-op, prev-from-done → last segment, skip on
  last segment → done.

## Out of scope (later features)

No rpc additions, no persistence, no SessionState, no reflow transforms (the
model merely guarantees they're expressible), no generator, no UI, no beeps,
no seed-data migration. Extra is a failure like missing.

## Notes for the builder

- Base the work on the `integrate--walking-skeleton` branch — the domain
  package, vitest harness, and script contract all exist there.
- Keep `packages/domain/package.json` dependencies exactly as they are.
- The compiler quirks (rules 1–6) are parity contract; if one looks like a
  bug, it isn't — do not "fix" ordering or rest selection.
- Epoch millis (`number`) for timer timestamps, not `DateTimeUtc` — the state
  machine is arithmetic-heavy and `Clock.currentTimeMillis` is the source;
  convert at presentation edges if ever needed.
