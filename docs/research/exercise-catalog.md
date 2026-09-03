# Research — an authoritative exercise catalog for generate-workout (September 2026)

## Question

The seeded exercise catalog that `GenerateWorkout` draws from contains combo
stations, cue fragments, and wrong tags. This note establishes (a) which
dimensions the generator actually reads, (b) what is wrong with the current
seed, and (c) a replacement catalog of 120 straightforward exercises, each
row mapped to exact schema literals and cited to a primary database entry.

## Summary

- The generator reads **three** exercise fields: `equipment`, `modality`, and
  `muscleGroups`. It reads `name` and `detail` only to fill a `Station`. It
  **never reads `intensity`**.
- The current seed has 96 entries. 18 of them are multi-movement combo
  stations copied out of the 12 seed workouts. Several carry wrong equipment
  or wrong modality. Nine of the 16 equipment literals have three or fewer
  entries.
- The seed makes some legal constraint combinations impossible. Example:
  `focus: strength` with `emphasis: [calves]` has exactly **one** candidate,
  and the smallest template needs four stations.
- The proposal is 120 exercises. It keeps every schema literal in use, raises
  the thinnest pools, and cites `free-exercise-db` or `wger` per row.

## Sources

Fetched and used:

- **free-exercise-db** (yuhonas), 876 entries, released under The Unlicense
  (<https://api.github.com/repos/yuhonas/free-exercise-db>). Per-entry JSON with
  `primaryMuscles`, `secondaryMuscles`, `equipment`, `mechanic`, `force`,
  `category`. Dataset:
  <https://github.com/yuhonas/free-exercise-db>; raw dataset fetched from
  <https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/dist/exercises.json>.
  Each row below cites its own entry file.
- **wger** REST API v2, 871 exercises. Endpoints used:
  <https://wger.de/api/v2/exerciseinfo/> (paged),
  <https://wger.de/api/v2/muscle/>, <https://wger.de/api/v2/equipment/>.
  Its `equipment` vocabulary is `Barbell, Bench, Cable machine, Dumbbell,
  Gym mat, Incline bench, Kettlebell, Pull-up bar, Resistance band, SZ-Bar,
  Swiss Ball, none (bodyweight exercise)` — a near-subset of j45's
  `Equipment`, which supports the schema's choice of literals.

Not reachable:

- **ExRx.net** returned HTTP 403 to both `curl` and WebFetch. No ExRx page is
  cited in this note.
- **acefitness.org** returned HTTP 403. No ACE page is cited.
- **NSCA / ACSM / NASM** position material was not fetched. The NASM
  movement-pattern taxonomy (push, pull, hinge, squat, lunge, carry,
  rotation) is mentioned once, in Open questions, as a *possible* schema
  addition. j45 has no movement-pattern dimension today, so no source is
  needed for the catalog itself.
- **f45training.com** was not fetched. Format constraints (timed stations,
  studio kit) come from the repo's own templates and `Equipment` literal.

## 1. The dimensions j45 actually uses

Every literal below is quoted from `packages/domain/src/exercise.ts`.

| Dimension | Exact literal values | Schema site | How the generator uses it |
|---|---|---|---|
| `Modality` | `'cardio'`, `'strength'` | `packages/domain/src/exercise.ts:6` | Hard filter against `constraints.focus`. `'hybrid'` admits both — `packages/domain/src/generation.ts:108-113`, applied at `generation.ts:148`. Also gates Emphasis: a non-strength exercise bypasses the emphasis filter entirely — `generation.ts:134-136`. |
| `Intensity` | `'low'`, `'moderate'`, `'high'` | `packages/domain/src/exercise.ts:12` | **Never read.** `generation.ts` does not mention `intensity`. No weighting, no balancing, no ordering. |
| `MuscleGroup` | `'glutes'`, `'hamstrings'`, `'quads'`, `'calves'`, `'chest'`, `'back'`, `'shoulders'`, `'biceps'`, `'triceps'`, `'core'` | `packages/domain/src/exercise.ts:22-33` | Read only through `emphasis`. Union test: a strength exercise qualifies when it carries at least one selected group — `generation.ts:127-138`. No quota per group, no per-pod balance. |
| `Equipment` | `'dumbbell'`, `'barbell'`, `'kettlebell'`, `'plate'`, `'slam-ball'`, `'med-ball'`, `'band'`, `'cable'`, `'bench'`, `'box'`, `'rower'`, `'bike'`, `'jump-rope'`, `'sliders'`, `'pull-up-bar'`, `'sandbag'` | `packages/domain/src/exercise.ts:53-70` | Subset test against the allowed set — `generation.ts:105-106`, applied at `generation.ts:147`. An empty `equipment` array means bodyweight and passes every allowed set, including the empty one. |
| `Exercise.name` | free string | `packages/domain/src/exercise.ts:100` | Copied to `Station.name` — `generation.ts:208-212`. Also the no-repeat key: matched case-insensitively against recent station names — `generation.ts:41`, `generation.ts:153-159`. |
| `Exercise.detail` | optional string | `packages/domain/src/exercise.ts:101` | Copied to `Station.detail` — `generation.ts:210-211`. Never filtered on. |

Server side, `packages/server/src/generation/handlers.ts:64-70` supplies the
whole per-user catalog and the recent station names, then calls the pure
`generate`. It applies no rule of its own.

**Gaps between schema and generator**

- `intensity` exists in the schema, the editor, and the seed data, and the
  generator ignores it. A workout can therefore be twelve `high` stations.
- `muscleGroups` is used as a *filter only*. Nothing balances a pod. The
  domain comment at `generation.ts:122-126` states this on purpose: "a
  two-group emphasis may draw a whole workout from one of them."
- Selection is a plain uniform sample without replacement
  (`generation.ts:186-206`). No exercise is preferred over another, so a
  catalog full of near-duplicates produces near-duplicate workouts.
- `templates.ts` demands between 4 and 12 stations
  (`packages/domain/src/templates.ts:31-140`). Any filtered pool below the
  chosen template's station count fails with `GenerationInfeasible`
  (`generation.ts:286-292`).

## 2. Audit of the current seed catalog

`packages/server/src/library/seed-exercises.json` holds **96** entries
(`seed-exercises.ts:37-39` freezes it). Names are unique
case-insensitively. Distribution: 75 `strength` / 21 `cardio`; 56
`moderate` / 30 `high` / 10 `low`.

The file is honest about its own origin: it was transcribed from the 12 seed
workouts' 104 station texts (`seed-exercises.ts:1-12`). That is the root
cause. The station texts are *choreography*, not a vocabulary.

### 2a. Combo stations kept as single exercises (18 entries)

A station that runs two movements is not one exercise. These entries cannot
be recombined, cannot be tagged coherently, and read as noise in a catalog.

- `Dumbbell squat + alternating shoulder press` (line 10)
- `Barbell squat + upright row` (line 131)
- `Bench jump-on + push-up` (line 138)
- `Cable biceps curl + wide row` (line 146)
- `Barbell RDL + overhand-grip row` (line 211)
- `Med ball shuffle + rotation` (line 287)
- `Sprawl + forward jump + back-pedal` (line 393)
- `Dumbbell double rack squat + press` (line 400)
- `Bench incline push-up + clap` (line 493)
- `Kettlebell single-arm bent row + high pull` (line 552)
- `Dumbbell hammer curl + shoulder press` (line 560)
- `Dumbbell front squat + pulse` (line 599)
- `Bench hop + push-up` (line 622)
- `Dumbbell sprawl + lateral jump` (line 637)
- `Sandbag clean + forward lunge` (line 651)
- `Dumbbell speed sumo squat + curl` (line 674)
- `Push-up + spider lunge + row` (line 681)
- `Slam ball throw-up squat + catch` (line 695)

### 2b. Cue fragments and near-duplicates

- `Squat pulse` (line 182) and `Push-up pulse` (line 175) are tempo cues, not
  exercises. `Dumbbell front squat + pulse` (line 599) repeats the cue.
- `Shuttle shuffle` (line 515) and `Shuttle run` (line 606) are the same
  movement with different rep counts.
- `Yogi push-up` (line 279), `Dumbbell punches` (line 294), `Box crossover`
  (line 575) and `Dumbbell double ski-stance hang clean` (line 500) are studio
  coaching names. A user cannot look them up.
- Four burpee entries — `Burpee` (17), `Side burpee` (197),
  `Reverse burpee` (485), `Hand-release burpee` (710) — carry three different
  muscle taggings: `core`, `core`, `core`, `chest`.

### 2c. Wrong dimension tags

- **`Dumbbell landmine rotation`** (line 507) is tagged `equipment:
  ["dumbbell"]`. A landmine rotation is a barbell movement. A user who allows
  only dumbbells will be given a station they cannot set up.
- **`Rower`** (line 3) is tagged `muscleGroups: ["back"]` alone. wger's own
  entry for the rowing machine lists shoulders, biceps, hamstrings, calves,
  glutes, lats, obliques, quads, abs and traps
  (<https://wger.de/en/exercise/1093/view/>). Rowing is leg-dominant; `back`
  alone is the least representative single tag available.
- **`Bench jump-on + push-up`** (line 138) and **`Bench hop + push-up`**
  (line 622) are tagged `modality: "cardio"` while
  **`Bench incline push-up + clap`** (line 493) is `strength`. The three are
  the same class of movement.
- **`Slam ball throw-up squat + catch`** (line 695) is tagged `strength` with
  `muscleGroups: ["quads"]`. It is an explosive full-body throw.
- **`Hamstring curls`** (line 369) is tagged `equipment: ["sliders"]` with
  `detail: "sliders/towel; sub: ball or partner curls"`. Three of the four
  named ways to run it need no sliders, but the filter excludes the entry
  whenever `sliders` is not allowed.
- **Substitutions hidden in `detail`.** `Slam ball RDL` (line 614),
  `Plate snatch` (line 302), `Barbell calf raises` (line 255),
  `Plate lying triceps extension` (line 415) and others say "or dumbbell" in
  `detail`. `detail` is never filtered (see table above), so these entries
  vanish from a dumbbell-only pool even though they are dumbbell-legal.
- **Implement naming is inconsistent**: `Slam-ball over-shoulder throw`
  (line 64) against `Slam ball RDL` (line 614).

### 2d. Structural starvation

Nine of the 16 equipment literals appear in three or fewer entries:
`rower` 1, `bike` 1, `cable` 1, `med-ball` 1, `sliders` 1, `band` 1,
`jump-rope` 1, `pull-up-bar` 2, `sandbag` 2. The vocabulary-coverage test
in `seed-exercises.test.ts` asks only for "at least one", which this passes
while leaving the generator starved.

The sharp case is Emphasis. Strength-modality candidates per group, current
seed: `glutes` 36, `quads` 27, `shoulders` 21, `hamstrings` 14, `back` 14,
`biceps` 12, `chest` 11, `triceps` 11, `core` 11, **`calves` 1**. The
smallest template needs 4 stations (`templates.ts:39-45`) and the largest 12
(`templates.ts:134-139`). `focus: strength` with `emphasis: ['calves']` is
therefore infeasible for every target duration.

Bodyweight-only is worse: 17 entries, of which 6 are `strength`, and those 6
cover `back` 0 times, `biceps` 0 times, `calves` 0 times, and `quads` once.

### 2e. Contradictions with the design docs

- `docs/designs/exercise-library/design.md` orders combo stations to be split
  ("Split combos: `A: x · B: y` stations become two entries"). The 18 entries
  in 2a show the rule was applied only to the `A: … · B: …` form, not to the
  `x + y` form.
- The same doc promises names "in the program's own vocabulary (a user should
  recognize 'Dumbbell renegade row' from their workouts)". That goal is met,
  and it is the reason the catalog is unusable as a general vocabulary. The
  two goals conflict; this note takes the general-vocabulary side.
- `docs/adr/0003-remove-full-body-muscle-group.md` records that 22 of 96
  entries once carried `full-body`, and that two now carry a `core` tag purely
  as a fallback (`Sprawl + forward jump + back-pedal`,
  `Dumbbell sprawl + lateral jump`). Both are still in the file, at lines 393
  and 637. The ADR's own closing note — that a whole-body concept should
  return "as a deliberate one" — is still open.
- `docs/glossary.md:22-25` defines an Exercise as "a tagged entry in a user's
  exercise catalog … a vocabulary the generator draws from". Combo stations
  are not vocabulary.

## 3. Mapping rules

The proposal maps two source taxonomies onto j45's literals. The rules are
mechanical, and stated here so the table can be checked.

**Muscle groups.** free-exercise-db uses 17 muscle names; wger uses anatomical
Latin names with an English alias. Mapping to `MuscleGroup`:

| Source value | j45 `MuscleGroup` |
|---|---|
| `quadriceps` / Quads | `quads` |
| `hamstrings` / Hamstrings, Biceps femoris | `hamstrings` |
| `glutes` / Glutes, Gluteus maximus | `glutes` |
| `calves` / Calves, Gastrocnemius, Soleus | `calves` |
| `chest` / Chest, Pectoralis major | `chest` |
| `shoulders` / Shoulders, Anterior deltoid | `shoulders` |
| `biceps` / Biceps, Biceps brachii | `biceps` |
| `triceps` / Triceps, Triceps brachii | `triceps` |
| `abdominals` / Abs, Rectus abdominis, Obliquus externus abdominis | `core` |
| `lats`, `middle back`, `lower back`, `traps` / Lats, Trapezius | `back` |
| `forearms`, `adductors`, `abductors`, `neck`, Brachialis, Serratus anterior | *dropped — no j45 literal* |

Two rules apply on top:

1. **Primary muscles always map in.** A source secondary muscle maps in only
   when the movement is commonly trained for it (for example `back` on a
   dumbbell Romanian deadlift). This keeps Emphasis meaningful.
2. **At most three groups per exercise.** More than three makes every
   Emphasis selection match everything, which is exactly the failure ADR-0003
   removed `full-body` for.

**Equipment.** free-exercise-db has one equipment string per entry and no
value for `plate`, `slam-ball`, `box`, `rower`, `bike`, `jump-rope`,
`sliders`, `sandbag`, or `bench`. Mapping:

| Source value | j45 `Equipment` |
|---|---|
| `body only`, `null`, `none (bodyweight exercise)` | `[]` |
| `barbell`, `e-z curl bar`, `SZ-Bar` | `barbell` |
| `dumbbell` | `dumbbell` |
| `kettlebells` / Kettlebell | `kettlebell` |
| `cable` / Cable machine | `cable` |
| `bands` / Resistance band | `band` |
| `medicine ball` | `med-ball` |
| `machine`, `other`, `exercise ball` | *no automatic mapping — judged* |

Where the source has no equivalent, the j45 value is the apparatus the
station physically needs, and the citation supports the **muscle mapping
only**. Those rows are: every `plate`, `slam-ball`, `box`, `rower`, `bike`,
`jump-rope`, `sliders`, `sandbag`, and `bench` row. This is stated per row by
the source name, which will not match the j45 name in those cases.

`bench` and `box` are listed as equipment whenever the movement cannot run
without them (dumbbell bench press → `["dumbbell", "bench"]`). This is
deliberate and it has a cost: the equipment filter is a *subset* test, so
such an exercise is excluded unless the user allows both items.

**Modality.** Neither source carries j45's `cardio`/`strength` split cleanly:
free-exercise-db's `category` has seven values (`strength`, `stretching`,
`plyometrics`, `powerlifting`, `olympic weightlifting`, `strongman`,
`cardio`) and wger's categories are body regions. Modality in the table is
**editorial**, under one rule: a station scored as continuous conditioning is
`cardio`; a station scored as loaded resistance work is `strength`. No source
is cited for modality.

**Intensity.** Also editorial. Neither source carries it, and the generator
ignores it (section 1). Values are set so the field is at least coherent:
`low` for single-joint isolation, `high` for loaded compound or plyometric
work, `moderate` otherwise.

**Naming.** One canonical name per movement, `Implement + movement`, sentence
case, no cue suffixes, no "or"-alternatives. Alternatives belong in `detail`,
which the generator copies but never filters.

## 4. Proposed authoritative catalog (120 exercises)

Every value in the `modality`, `muscle groups`, `equipment` and `intensity`
columns is an exact literal from `packages/domain/src/exercise.ts`.

| Canonical name | `modality` | `muscleGroups` | `equipment` | `intensity` | Source |
|---|---|---|---|---|---|
| Push-up | `strength` | `chest`, `triceps`, `shoulders` | *(empty — bodyweight)* | `moderate` | [free-exercise-db `Pushups`](https://github.com/yuhonas/free-exercise-db/blob/main/exercises/Pushups.json) |
| Close-grip push-up | `strength` | `triceps`, `chest` | *(empty — bodyweight)* | `moderate` | [free-exercise-db `Push-Ups_-_Close_Triceps_Position`](https://github.com/yuhonas/free-exercise-db/blob/main/exercises/Push-Ups_-_Close_Triceps_Position.json) |
| Bodyweight squat | `strength` | `quads`, `glutes` | *(empty — bodyweight)* | `low` | [free-exercise-db `Bodyweight_Squat`](https://github.com/yuhonas/free-exercise-db/blob/main/exercises/Bodyweight_Squat.json) |
| Squat jump | `cardio` | `quads`, `glutes`, `calves` | *(empty — bodyweight)* | `high` | [free-exercise-db `Freehand_Jump_Squat`](https://github.com/yuhonas/free-exercise-db/blob/main/exercises/Freehand_Jump_Squat.json) |
| Walking lunge | `strength` | `quads`, `glutes`, `hamstrings` | *(empty — bodyweight)* | `moderate` | [free-exercise-db `Bodyweight_Walking_Lunge`](https://github.com/yuhonas/free-exercise-db/blob/main/exercises/Bodyweight_Walking_Lunge.json) |
| Reverse lunge | `strength` | `quads`, `glutes` | *(empty — bodyweight)* | `moderate` | [wger #999](https://wger.de/en/exercise/999/view/) |
| Jumping lunge | `cardio` | `quads`, `glutes`, `calves` | *(empty — bodyweight)* | `high` | [free-exercise-db `Split_Jump`](https://github.com/yuhonas/free-exercise-db/blob/main/exercises/Split_Jump.json) |
| Bulgarian split squat | `strength` | `quads`, `glutes` | `bench` | `high` | [wger #988](https://wger.de/en/exercise/988/view/) |
| Glute bridge | `strength` | `glutes`, `hamstrings` | *(empty — bodyweight)* | `low` | [wger #265](https://wger.de/en/exercise/265/view/) |
| Single-leg glute bridge | `strength` | `glutes`, `hamstrings` | *(empty — bodyweight)* | `moderate` | [free-exercise-db `Single_Leg_Glute_Bridge`](https://github.com/yuhonas/free-exercise-db/blob/main/exercises/Single_Leg_Glute_Bridge.json) |
| Single-leg RDL | `strength` | `hamstrings`, `glutes` | *(empty — bodyweight)* | `low` | [free-exercise-db `Kettlebell_One-Legged_Deadlift`](https://github.com/yuhonas/free-exercise-db/blob/main/exercises/Kettlebell_One-Legged_Deadlift.json) |
| Standing calf raise | `strength` | `calves` | *(empty — bodyweight)* | `low` | [wger #1203](https://wger.de/en/exercise/1203/view/) |
| Plank | `strength` | `core` | *(empty — bodyweight)* | `moderate` | [free-exercise-db `Plank`](https://github.com/yuhonas/free-exercise-db/blob/main/exercises/Plank.json) |
| Side plank | `strength` | `core` | *(empty — bodyweight)* | `moderate` | [free-exercise-db `Side_Bridge`](https://github.com/yuhonas/free-exercise-db/blob/main/exercises/Side_Bridge.json) |
| Hollow hold | `strength` | `core` | *(empty — bodyweight)* | `moderate` | [wger #297](https://wger.de/en/exercise/297/view/) |
| Bicycle crunch | `strength` | `core` | *(empty — bodyweight)* | `moderate` | [wger #1412](https://wger.de/en/exercise/1412/view/) |
| Reverse crunch | `strength` | `core` | *(empty — bodyweight)* | `moderate` | [free-exercise-db `Reverse_Crunch`](https://github.com/yuhonas/free-exercise-db/blob/main/exercises/Reverse_Crunch.json) |
| Lying leg raise | `strength` | `core` | *(empty — bodyweight)* | `moderate` | [free-exercise-db `Flat_Bench_Lying_Leg_Raise`](https://github.com/yuhonas/free-exercise-db/blob/main/exercises/Flat_Bench_Lying_Leg_Raise.json) |
| Back extension | `strength` | `back`, `glutes`, `hamstrings` | *(empty — bodyweight)* | `low` | [free-exercise-db `Hyperextensions_With_No_Hyperextension_Bench`](https://github.com/yuhonas/free-exercise-db/blob/main/exercises/Hyperextensions_With_No_Hyperextension_Bench.json) |
| Burpee | `cardio` | `quads`, `chest`, `core` | *(empty — bodyweight)* | `high` | [wger #132](https://wger.de/en/exercise/132/view/) |
| Mountain climber | `cardio` | `core`, `shoulders`, `quads` | *(empty — bodyweight)* | `high` | [free-exercise-db `Mountain_Climbers`](https://github.com/yuhonas/free-exercise-db/blob/main/exercises/Mountain_Climbers.json) |
| Bear crawl | `cardio` | `core`, `shoulders`, `quads` | *(empty — bodyweight)* | `high` | [free-exercise-db `Spider_Crawl`](https://github.com/yuhonas/free-exercise-db/blob/main/exercises/Spider_Crawl.json) |
| Jumping jacks | `cardio` | `quads`, `calves`, `shoulders` | *(empty — bodyweight)* | `moderate` | [wger #320](https://wger.de/en/exercise/320/view/) |
| High knees | `cardio` | `quads`, `calves`, `core` | *(empty — bodyweight)* | `high` | [wger #983](https://wger.de/en/exercise/983/view/) |
| Skater bound | `cardio` | `quads`, `glutes`, `calves` | *(empty — bodyweight)* | `high` | [free-exercise-db `Lateral_Cone_Hops`](https://github.com/yuhonas/free-exercise-db/blob/main/exercises/Lateral_Cone_Hops.json) |
| Lateral hop | `cardio` | `quads`, `calves` | *(empty — bodyweight)* | `moderate` | [free-exercise-db `Single-Leg_Lateral_Hop`](https://github.com/yuhonas/free-exercise-db/blob/main/exercises/Single-Leg_Lateral_Hop.json) |
| Broad jump | `cardio` | `quads`, `glutes`, `hamstrings` | *(empty — bodyweight)* | `high` | [free-exercise-db `Standing_Long_Jump`](https://github.com/yuhonas/free-exercise-db/blob/main/exercises/Standing_Long_Jump.json) |
| Shuttle run | `cardio` | `quads`, `calves`, `glutes` | *(empty — bodyweight)* | `high` | [free-exercise-db `Single-Cone_Sprint_Drill`](https://github.com/yuhonas/free-exercise-db/blob/main/exercises/Single-Cone_Sprint_Drill.json) |
| Dumbbell goblet squat | `strength` | `quads`, `glutes` | `dumbbell` | `moderate` | [wger #203](https://wger.de/en/exercise/203/view/) |
| Dumbbell front squat | `strength` | `quads`, `glutes`, `core` | `dumbbell` | `moderate` | [free-exercise-db `Dumbbell_Squat`](https://github.com/yuhonas/free-exercise-db/blob/main/exercises/Dumbbell_Squat.json) |
| Dumbbell walking lunge | `strength` | `quads`, `glutes`, `hamstrings` | `dumbbell` | `moderate` | [free-exercise-db `Dumbbell_Lunges`](https://github.com/yuhonas/free-exercise-db/blob/main/exercises/Dumbbell_Lunges.json) |
| Dumbbell Bulgarian split squat | `strength` | `quads`, `glutes` | `dumbbell`, `bench` | `high` | [wger #1706](https://wger.de/en/exercise/1706/view/) |
| Dumbbell Romanian deadlift | `strength` | `hamstrings`, `glutes`, `back` | `dumbbell` | `moderate` | [free-exercise-db `Stiff-Legged_Dumbbell_Deadlift`](https://github.com/yuhonas/free-exercise-db/blob/main/exercises/Stiff-Legged_Dumbbell_Deadlift.json) |
| Dumbbell single-leg Romanian deadlift | `strength` | `hamstrings`, `glutes` | `dumbbell` | `moderate` | [wger #1641](https://wger.de/en/exercise/1641/view/) |
| Dumbbell hip thrust | `strength` | `glutes`, `hamstrings` | `dumbbell`, `bench` | `moderate` | [wger #1642](https://wger.de/en/exercise/1642/view/) |
| Dumbbell step-up | `strength` | `quads`, `glutes` | `dumbbell`, `box` | `moderate` | [free-exercise-db `Dumbbell_Step_Ups`](https://github.com/yuhonas/free-exercise-db/blob/main/exercises/Dumbbell_Step_Ups.json) |
| Dumbbell calf raise | `strength` | `calves` | `dumbbell` | `low` | [free-exercise-db `Standing_Dumbbell_Calf_Raise`](https://github.com/yuhonas/free-exercise-db/blob/main/exercises/Standing_Dumbbell_Calf_Raise.json) |
| Dumbbell bench press | `strength` | `chest`, `triceps`, `shoulders` | `dumbbell`, `bench` | `moderate` | [free-exercise-db `Dumbbell_Bench_Press`](https://github.com/yuhonas/free-exercise-db/blob/main/exercises/Dumbbell_Bench_Press.json) |
| Dumbbell incline bench press | `strength` | `chest`, `shoulders`, `triceps` | `dumbbell`, `bench` | `moderate` | [free-exercise-db `Incline_Dumbbell_Press`](https://github.com/yuhonas/free-exercise-db/blob/main/exercises/Incline_Dumbbell_Press.json) |
| Dumbbell floor press | `strength` | `chest`, `triceps` | `dumbbell` | `moderate` | [free-exercise-db `Dumbbell_Floor_Press`](https://github.com/yuhonas/free-exercise-db/blob/main/exercises/Dumbbell_Floor_Press.json) |
| Dumbbell chest fly | `strength` | `chest` | `dumbbell`, `bench` | `moderate` | [free-exercise-db `Dumbbell_Flyes`](https://github.com/yuhonas/free-exercise-db/blob/main/exercises/Dumbbell_Flyes.json) |
| Dumbbell bent-over row | `strength` | `back`, `biceps`, `shoulders` | `dumbbell` | `moderate` | [free-exercise-db `Bent_Over_Two-Dumbbell_Row`](https://github.com/yuhonas/free-exercise-db/blob/main/exercises/Bent_Over_Two-Dumbbell_Row.json) |
| Dumbbell single-arm row | `strength` | `back`, `biceps` | `dumbbell`, `bench` | `moderate` | [free-exercise-db `One-Arm_Dumbbell_Row`](https://github.com/yuhonas/free-exercise-db/blob/main/exercises/One-Arm_Dumbbell_Row.json) |
| Dumbbell renegade row | `strength` | `back`, `core`, `biceps` | `dumbbell` | `high` | [wger #490](https://wger.de/en/exercise/490/view/) |
| Dumbbell shoulder press | `strength` | `shoulders`, `triceps` | `dumbbell` | `moderate` | [free-exercise-db `Dumbbell_Shoulder_Press`](https://github.com/yuhonas/free-exercise-db/blob/main/exercises/Dumbbell_Shoulder_Press.json) |
| Dumbbell Arnold press | `strength` | `shoulders`, `triceps` | `dumbbell` | `moderate` | [free-exercise-db `Arnold_Dumbbell_Press`](https://github.com/yuhonas/free-exercise-db/blob/main/exercises/Arnold_Dumbbell_Press.json) |
| Dumbbell lateral raise | `strength` | `shoulders` | `dumbbell` | `low` | [free-exercise-db `Side_Lateral_Raise`](https://github.com/yuhonas/free-exercise-db/blob/main/exercises/Side_Lateral_Raise.json) |
| Dumbbell biceps curl | `strength` | `biceps` | `dumbbell` | `low` | [free-exercise-db `Seated_Dumbbell_Curl`](https://github.com/yuhonas/free-exercise-db/blob/main/exercises/Seated_Dumbbell_Curl.json) |
| Dumbbell hammer curl | `strength` | `biceps` | `dumbbell` | `low` | [free-exercise-db `Incline_Hammer_Curls`](https://github.com/yuhonas/free-exercise-db/blob/main/exercises/Incline_Hammer_Curls.json) |
| Dumbbell triceps kickback | `strength` | `triceps` | `dumbbell` | `low` | [free-exercise-db `Standing_Bent-Over_Two-Arm_Dumbbell_Triceps_Extension`](https://github.com/yuhonas/free-exercise-db/blob/main/exercises/Standing_Bent-Over_Two-Arm_Dumbbell_Triceps_Extension.json) |
| Dumbbell overhead triceps extension | `strength` | `triceps` | `dumbbell` | `low` | [free-exercise-db `Standing_Dumbbell_Triceps_Extension`](https://github.com/yuhonas/free-exercise-db/blob/main/exercises/Standing_Dumbbell_Triceps_Extension.json) |
| Dumbbell thruster | `strength` | `quads`, `glutes`, `shoulders` | `dumbbell` | `high` | [wger #1684](https://wger.de/en/exercise/1684/view/) |
| Dumbbell snatch | `strength` | `shoulders`, `glutes`, `hamstrings` | `dumbbell` | `high` | [wger #1947](https://wger.de/en/exercise/1947/view/) |
| Dumbbell farmer's carry | `strength` | `core`, `back` | `dumbbell` | `moderate` | [wger #1116](https://wger.de/en/exercise/1116/view/) |
| Barbell back squat | `strength` | `quads`, `glutes`, `hamstrings` | `barbell` | `high` | [free-exercise-db `Barbell_Squat`](https://github.com/yuhonas/free-exercise-db/blob/main/exercises/Barbell_Squat.json) |
| Barbell front squat | `strength` | `quads`, `glutes`, `core` | `barbell` | `high` | [free-exercise-db `Front_Barbell_Squat`](https://github.com/yuhonas/free-exercise-db/blob/main/exercises/Front_Barbell_Squat.json) |
| Barbell deadlift | `strength` | `back`, `glutes`, `hamstrings` | `barbell` | `high` | [free-exercise-db `Barbell_Deadlift`](https://github.com/yuhonas/free-exercise-db/blob/main/exercises/Barbell_Deadlift.json) |
| Barbell Romanian deadlift | `strength` | `hamstrings`, `glutes`, `back` | `barbell` | `moderate` | [free-exercise-db `Romanian_Deadlift`](https://github.com/yuhonas/free-exercise-db/blob/main/exercises/Romanian_Deadlift.json) |
| Barbell hip thrust | `strength` | `glutes`, `hamstrings` | `barbell`, `bench` | `moderate` | [free-exercise-db `Barbell_Hip_Thrust`](https://github.com/yuhonas/free-exercise-db/blob/main/exercises/Barbell_Hip_Thrust.json) |
| Barbell calf raise | `strength` | `calves` | `barbell` | `low` | [free-exercise-db `Standing_Barbell_Calf_Raise`](https://github.com/yuhonas/free-exercise-db/blob/main/exercises/Standing_Barbell_Calf_Raise.json) |
| Barbell bench press | `strength` | `chest`, `triceps`, `shoulders` | `barbell`, `bench` | `high` | [free-exercise-db `Barbell_Bench_Press_-_Medium_Grip`](https://github.com/yuhonas/free-exercise-db/blob/main/exercises/Barbell_Bench_Press_-_Medium_Grip.json) |
| Barbell bent-over row | `strength` | `back`, `biceps`, `shoulders` | `barbell` | `moderate` | [free-exercise-db `Bent_Over_Barbell_Row`](https://github.com/yuhonas/free-exercise-db/blob/main/exercises/Bent_Over_Barbell_Row.json) |
| Barbell overhead press | `strength` | `shoulders`, `triceps` | `barbell` | `moderate` | [free-exercise-db `Standing_Military_Press`](https://github.com/yuhonas/free-exercise-db/blob/main/exercises/Standing_Military_Press.json) |
| Barbell push press | `strength` | `shoulders`, `quads`, `triceps` | `barbell` | `high` | [free-exercise-db `Push_Press`](https://github.com/yuhonas/free-exercise-db/blob/main/exercises/Push_Press.json) |
| Barbell thruster | `strength` | `quads`, `shoulders`, `glutes` | `barbell` | `high` | [free-exercise-db `Push_Press`](https://github.com/yuhonas/free-exercise-db/blob/main/exercises/Push_Press.json) |
| Barbell hang clean | `strength` | `hamstrings`, `glutes`, `back` | `barbell` | `high` | [free-exercise-db `Hang_Clean`](https://github.com/yuhonas/free-exercise-db/blob/main/exercises/Hang_Clean.json) |
| Barbell biceps curl | `strength` | `biceps` | `barbell` | `low` | [free-exercise-db `Wide-Grip_Standing_Barbell_Curl`](https://github.com/yuhonas/free-exercise-db/blob/main/exercises/Wide-Grip_Standing_Barbell_Curl.json) |
| Barbell landmine rotation | `strength` | `core`, `shoulders` | `barbell` | `moderate` | [wger #145](https://wger.de/en/exercise/145/view/) |
| Kettlebell swing | `strength` | `glutes`, `hamstrings`, `back` | `kettlebell` | `moderate` | [wger #9](https://wger.de/en/exercise/9/view/) |
| Kettlebell goblet squat | `strength` | `quads`, `glutes` | `kettlebell` | `moderate` | [free-exercise-db `Goblet_Squat`](https://github.com/yuhonas/free-exercise-db/blob/main/exercises/Goblet_Squat.json) |
| Kettlebell double front squat | `strength` | `quads`, `glutes`, `core` | `kettlebell` | `high` | [free-exercise-db `Front_Squats_With_Two_Kettlebells`](https://github.com/yuhonas/free-exercise-db/blob/main/exercises/Front_Squats_With_Two_Kettlebells.json) |
| Kettlebell sumo deadlift | `strength` | `hamstrings`, `glutes`, `quads` | `kettlebell` | `moderate` | [wger #1612](https://wger.de/en/exercise/1612/view/) |
| Kettlebell single-arm row | `strength` | `back`, `biceps` | `kettlebell` | `moderate` | [free-exercise-db `One-Arm_Kettlebell_Row`](https://github.com/yuhonas/free-exercise-db/blob/main/exercises/One-Arm_Kettlebell_Row.json) |
| Kettlebell single-arm press | `strength` | `shoulders`, `triceps` | `kettlebell` | `moderate` | [free-exercise-db `Alternating_Kettlebell_Press`](https://github.com/yuhonas/free-exercise-db/blob/main/exercises/Alternating_Kettlebell_Press.json) |
| Kettlebell push press | `strength` | `shoulders`, `quads`, `triceps` | `kettlebell` | `high` | [free-exercise-db `One-Arm_Kettlebell_Push_Press`](https://github.com/yuhonas/free-exercise-db/blob/main/exercises/One-Arm_Kettlebell_Push_Press.json) |
| Kettlebell thruster | `strength` | `shoulders`, `quads`, `triceps` | `kettlebell` | `high` | [free-exercise-db `Kettlebell_Thruster`](https://github.com/yuhonas/free-exercise-db/blob/main/exercises/Kettlebell_Thruster.json) |
| Kettlebell clean | `strength` | `hamstrings`, `glutes`, `shoulders` | `kettlebell` | `high` | [free-exercise-db `One-Arm_Kettlebell_Clean`](https://github.com/yuhonas/free-exercise-db/blob/main/exercises/One-Arm_Kettlebell_Clean.json) |
| Kettlebell high pull | `strength` | `back`, `shoulders`, `glutes` | `kettlebell` | `moderate` | [wger #1970](https://wger.de/en/exercise/1970/view/) |
| Kettlebell floor press | `strength` | `chest`, `triceps` | `kettlebell` | `moderate` | [free-exercise-db `One-Arm_Kettlebell_Floor_Press`](https://github.com/yuhonas/free-exercise-db/blob/main/exercises/One-Arm_Kettlebell_Floor_Press.json) |
| Cable seated row | `strength` | `back`, `biceps`, `shoulders` | `cable` | `moderate` | [free-exercise-db `Seated_Cable_Rows`](https://github.com/yuhonas/free-exercise-db/blob/main/exercises/Seated_Cable_Rows.json) |
| Cable lat pulldown | `strength` | `back`, `biceps` | `cable` | `moderate` | [free-exercise-db `Wide-Grip_Lat_Pulldown`](https://github.com/yuhonas/free-exercise-db/blob/main/exercises/Wide-Grip_Lat_Pulldown.json) |
| Cable chest press | `strength` | `chest`, `shoulders`, `triceps` | `cable` | `moderate` | [free-exercise-db `Cable_Chest_Press`](https://github.com/yuhonas/free-exercise-db/blob/main/exercises/Cable_Chest_Press.json) |
| Cable face pull | `strength` | `shoulders`, `back` | `cable` | `low` | [free-exercise-db `Face_Pull`](https://github.com/yuhonas/free-exercise-db/blob/main/exercises/Face_Pull.json) |
| Cable biceps curl | `strength` | `biceps` | `cable` | `low` | [free-exercise-db `Standing_Biceps_Cable_Curl`](https://github.com/yuhonas/free-exercise-db/blob/main/exercises/Standing_Biceps_Cable_Curl.json) |
| Cable triceps pushdown | `strength` | `triceps` | `cable` | `low` | [free-exercise-db `Triceps_Pushdown`](https://github.com/yuhonas/free-exercise-db/blob/main/exercises/Triceps_Pushdown.json) |
| Cable woodchop | `strength` | `core`, `shoulders` | `cable` | `moderate` | [free-exercise-db `Standing_Cable_Wood_Chop`](https://github.com/yuhonas/free-exercise-db/blob/main/exercises/Standing_Cable_Wood_Chop.json) |
| Band pull-apart | `strength` | `back`, `shoulders` | `band` | `low` | [wger #1380](https://wger.de/en/exercise/1380/view/) |
| Band row | `strength` | `back`, `biceps` | `band` | `moderate` | [wger #1732](https://wger.de/en/exercise/1732/view/) |
| Band biceps curl | `strength` | `biceps` | `band` | `low` | [wger #1531](https://wger.de/en/exercise/1531/view/) |
| Band triceps pushdown | `strength` | `triceps` | `band` | `low` | [free-exercise-db `Reverse_Grip_Triceps_Pushdown`](https://github.com/yuhonas/free-exercise-db/blob/main/exercises/Reverse_Grip_Triceps_Pushdown.json) |
| Band lateral raise | `strength` | `shoulders` | `band` | `low` | [free-exercise-db `Lateral_Raise_-_With_Bands`](https://github.com/yuhonas/free-exercise-db/blob/main/exercises/Lateral_Raise_-_With_Bands.json) |
| Band good morning | `strength` | `hamstrings`, `glutes`, `back` | `band` | `moderate` | [free-exercise-db `Band_Good_Morning`](https://github.com/yuhonas/free-exercise-db/blob/main/exercises/Band_Good_Morning.json) |
| Band calf raise | `strength` | `calves` | `band` | `low` | [free-exercise-db `Calf_Raises_-_With_Bands`](https://github.com/yuhonas/free-exercise-db/blob/main/exercises/Calf_Raises_-_With_Bands.json) |
| Plate front raise | `strength` | `shoulders` | `plate` | `low` | [free-exercise-db `Front_Plate_Raise`](https://github.com/yuhonas/free-exercise-db/blob/main/exercises/Front_Plate_Raise.json) |
| Plate goblet squat | `strength` | `quads`, `glutes` | `plate` | `moderate` | [wger #203](https://wger.de/en/exercise/203/view/) |
| Plate Russian twist | `strength` | `core` | `plate` | `moderate` | [free-exercise-db `Russian_Twist`](https://github.com/yuhonas/free-exercise-db/blob/main/exercises/Russian_Twist.json) |
| Med ball chest pass | `cardio` | `chest`, `shoulders`, `triceps` | `med-ball` | `moderate` | [free-exercise-db `Medicine_Ball_Chest_Pass`](https://github.com/yuhonas/free-exercise-db/blob/main/exercises/Medicine_Ball_Chest_Pass.json) |
| Med ball Russian twist | `strength` | `core` | `med-ball` | `moderate` | [free-exercise-db `Medicine_Ball_Full_Twist`](https://github.com/yuhonas/free-exercise-db/blob/main/exercises/Medicine_Ball_Full_Twist.json) |
| Med ball overhead throw | `cardio` | `shoulders`, `back`, `core` | `med-ball` | `high` | [free-exercise-db `Standing_Two-Arm_Overhead_Throw`](https://github.com/yuhonas/free-exercise-db/blob/main/exercises/Standing_Two-Arm_Overhead_Throw.json) |
| Slam ball overhead slam | `cardio` | `back`, `core`, `shoulders` | `slam-ball` | `high` | [free-exercise-db `Overhead_Slam`](https://github.com/yuhonas/free-exercise-db/blob/main/exercises/Overhead_Slam.json) |
| Slam ball over-shoulder throw | `strength` | `glutes`, `back`, `shoulders` | `slam-ball` | `high` | [free-exercise-db `Overhead_Slam`](https://github.com/yuhonas/free-exercise-db/blob/main/exercises/Overhead_Slam.json) |
| Slam ball squat to press | `strength` | `quads`, `glutes`, `shoulders` | `slam-ball` | `high` | [wger #1684](https://wger.de/en/exercise/1684/view/) |
| Bench dip | `strength` | `triceps`, `chest`, `shoulders` | `bench` | `moderate` | [free-exercise-db `Bench_Dips`](https://github.com/yuhonas/free-exercise-db/blob/main/exercises/Bench_Dips.json) |
| Bench incline push-up | `strength` | `chest`, `shoulders`, `triceps` | `bench` | `low` | [free-exercise-db `Incline_Push-Up`](https://github.com/yuhonas/free-exercise-db/blob/main/exercises/Incline_Push-Up.json) |
| Box jump | `cardio` | `quads`, `glutes`, `calves` | `box` | `high` | [free-exercise-db `Front_Box_Jump`](https://github.com/yuhonas/free-exercise-db/blob/main/exercises/Front_Box_Jump.json) |
| Box step-up | `strength` | `quads`, `glutes` | `box` | `moderate` | [free-exercise-db `Step-up_with_Knee_Raise`](https://github.com/yuhonas/free-exercise-db/blob/main/exercises/Step-up_with_Knee_Raise.json) |
| Pull-up | `strength` | `back`, `biceps`, `shoulders` | `pull-up-bar` | `high` | [free-exercise-db `Wide-Grip_Rear_Pull-Up`](https://github.com/yuhonas/free-exercise-db/blob/main/exercises/Wide-Grip_Rear_Pull-Up.json) |
| Chin-up | `strength` | `back`, `biceps` | `pull-up-bar` | `high` | [free-exercise-db `Chin-Up`](https://github.com/yuhonas/free-exercise-db/blob/main/exercises/Chin-Up.json) |
| Hanging knee raise | `strength` | `core` | `pull-up-bar` | `moderate` | [wger #979](https://wger.de/en/exercise/979/view/) |
| Slider hamstring curl | `strength` | `hamstrings`, `glutes` | `sliders` | `moderate` | [free-exercise-db `Platform_Hamstring_Slides`](https://github.com/yuhonas/free-exercise-db/blob/main/exercises/Platform_Hamstring_Slides.json) |
| Slider mountain climber | `cardio` | `core`, `shoulders`, `quads` | `sliders` | `high` | [free-exercise-db `Mountain_Climbers`](https://github.com/yuhonas/free-exercise-db/blob/main/exercises/Mountain_Climbers.json) |
| Sandbag bear-hug squat | `strength` | `quads`, `glutes`, `core` | `sandbag` | `high` | [free-exercise-db `Sandbag_Load`](https://github.com/yuhonas/free-exercise-db/blob/main/exercises/Sandbag_Load.json) |
| Sandbag clean | `strength` | `hamstrings`, `glutes`, `back` | `sandbag` | `high` | [free-exercise-db `Sandbag_Load`](https://github.com/yuhonas/free-exercise-db/blob/main/exercises/Sandbag_Load.json) |
| Sandbag carry | `strength` | `core`, `back`, `quads` | `sandbag` | `moderate` | [free-exercise-db `Farmers_Walk`](https://github.com/yuhonas/free-exercise-db/blob/main/exercises/Farmers_Walk.json) |
| Row (rower) | `cardio` | `back`, `quads`, `hamstrings` | `rower` | `moderate` | [wger #1093](https://wger.de/en/exercise/1093/view/) |
| Row sprint | `cardio` | `back`, `quads`, `core` | `rower` | `high` | [free-exercise-db `Rowing_Stationary`](https://github.com/yuhonas/free-exercise-db/blob/main/exercises/Rowing_Stationary.json) |
| Bike (stationary) | `cardio` | `quads`, `hamstrings`, `calves` | `bike` | `moderate` | [wger #624](https://wger.de/en/exercise/624/view/) |
| Bike sprint | `cardio` | `quads`, `glutes`, `calves` | `bike` | `high` | [free-exercise-db `Recumbent_Bike`](https://github.com/yuhonas/free-exercise-db/blob/main/exercises/Recumbent_Bike.json) |
| Jump rope | `cardio` | `calves`, `quads`, `shoulders` | `jump-rope` | `moderate` | [wger #993](https://wger.de/en/exercise/993/view/) |
| Dumbbell seated calf raise | `strength` | `calves` | `dumbbell`, `bench` | `low` | [free-exercise-db `Dumbbell_Seated_One-Leg_Calf_Raise`](https://github.com/yuhonas/free-exercise-db/blob/main/exercises/Dumbbell_Seated_One-Leg_Calf_Raise.json) |

## 5. Coverage check

### 5a. Muscle groups

"strength" is the count that Emphasis can actually reach, because a cardio
exercise bypasses the emphasis filter (`generation.ts:134-136`).

| Muscle group | seed: total / strength | proposed: total / strength |
|---|---|---|
| `glutes` | 40 / 36 | 46 / 39 |
| `hamstrings` | 14 / 14 | 24 / 21 |
| `quads` | 37 / 27 | 42 / 24 |
| `calves` | 7 / 1 | 16 / 5 |
| `chest` | 14 / 11 | 13 / 11 |
| `back` | 15 / 14 | 28 / 24 |
| `shoulders` | 23 / 21 | 40 / 32 |
| `biceps` | 12 / 12 | 15 / 15 |
| `triceps` | 11 / 11 | 22 / 21 |
| `core` | 19 / 11 | 26 / 18 |
Every group gains. `calves` moves from 1 strength candidate to 5, `back` from
14 to 24, `triceps` from 11 to 21, `hamstrings` from 14 to 21.

### 5b. Equipment

Each row is the pool the generator sees when the user allows exactly that one
item (bodyweight exercises always qualify, so each pool includes them).

| Allowed set | seed pool / strength | proposed pool / strength |
|---|---|---|
| `[dumbbell]` | 43 / 30 | 46 / 35 |
| `[barbell]` | 30 / 19 | 39 / 28 |
| `[kettlebell]` | 26 / 15 | 38 / 27 |
| `[plate]` | 20 / 9 | 30 / 19 |
| `[slam-ball]` | 20 / 9 | 30 / 18 |
| `[med-ball]` | 18 / 6 | 30 / 17 |
| `[band]` | 18 / 7 | 34 / 23 |
| `[cable]` | 18 / 7 | 34 / 23 |
| `[bench]` | 22 / 9 | 30 / 19 |
| `[box]` | 20 / 7 | 29 / 17 |
| `[rower]` | 18 / 6 | 29 / 16 |
| `[bike]` | 18 / 6 | 29 / 16 |
| `[jump-rope]` | 18 / 6 | 28 / 16 |
| `[sliders]` | 18 / 7 | 29 / 17 |
| `[pull-up-bar]` | 19 / 8 | 30 / 19 |
| `[sandbag]` | 19 / 8 | 30 / 19 |
| `[]` (bodyweight only) | 17 / 6 | 27 / 16 |
Read against the template range of 4–12 stations
(`templates.ts:31-140`), every single-item allowed set clears 12 in the
proposal. The current seed clears it too on raw pool size; the failures are
in the *combinations* below.

### 5c. Combinations with too few candidates

Checked as `focus: 'strength'` + a single-group `emphasis`, which is the
narrowest legal request. Counts are strength candidates.

- **Current seed, all equipment allowed:** `emphasis: ['calves']` → **1
  candidate**. Infeasible for every template. This is a live bug, not a
  hypothetical.
- **Current seed, bodyweight only (`equipment: []`):** `back` → **0**,
  `biceps` → **0**, `calves` → **0**, `quads` → 1, `triceps` → 1, `core` → 2,
  `shoulders` → 2, `hamstrings` → 2, `chest` → 3, `glutes` → 3. Nine of ten
  groups are infeasible.
- **Proposal, all equipment allowed:** the smallest is `calves` → 5. That
  clears the 4-station templates (`compact-laps-2x2x3`,
  `medium-laps-2x3x3`) but not the 6-, 8-, 9- or 12-station ones.
- **Proposal, bodyweight only:** `biceps` → **0** (unavoidable: no bodyweight
  biceps movement exists without a bar), `back` → 1, `calves` → 1,
  `shoulders` → 1, `chest` → 2, `triceps` → 2, `quads` → 3, `hamstrings` → 5,
  `core` → 6, `glutes` → 7.

So the proposal removes the all-equipment starvation and shrinks, but does
not remove, the bodyweight-only starvation. See Open questions.

### 5d. Cardio

`focus: 'cardio'` ignores `emphasis` entirely and draws from the cardio
entries only: 21 in the current seed, 21 in the proposal. The largest
template needs 12 stations, so a cardio-only 45-minute generation with
`noRepeatSessions: 3` can still starve. Both catalogs share this exposure.

## 6. Open questions and recommendations

### Schema

1. **`intensity` is dead weight.** The generator never reads it. Either give
   it a job (cap the count of `high` stations per workout, or order stations
   so a `high` never follows a `high`) or delete it, the way ADR-0003 deleted
   `full-body`. Leaving a tag that nothing reads is how the `full-body`
   problem started.
2. **The `bench` / `box` equipment cost.** Because equipment is a subset test,
   `["dumbbell", "bench"]` needs the user to allow both. Twelve proposed
   exercises carry `bench`. An alternative is to treat a bench as always
   available (drop it from `equipment` and note it in `detail`). That is a
   domain decision, not a data decision.
3. **Substitutions are invisible to the filter.** Many movements are legal
   with two implements ("slam ball or dumbbell RDL"). Today that is prose in
   `detail`. A second field — for example `equipmentAlternatives: readonly
   (readonly Equipment[])[]` — would let the filter admit the entry under
   either kit. Without it, the catalog must pick one implement per row, which
   is what the proposal does.
4. **No movement-pattern dimension exists.** If pod balance is ever wanted
   (do not put two hinges next to each other), a `MovementPattern` literal
   over the standard set — push, pull, hinge, squat, lunge, carry, rotation —
   is the usual vocabulary. It would need its own sourcing pass; no source is
   cited for it here.
5. **The whole-body concept is still missing**, as ADR-0003 predicted. A
   burpee is tagged `core` because nothing better exists. The proposal tags
   it `quads, chest, core`, which is more honest but still a workaround.

### Generator

6. **Uniform sampling wastes a good catalog.** `sampleWithoutReplacement`
   (`generation.ts:186-206`) treats a barbell back squat and a dumbbell
   lateral raise as equally likely. With 120 well-spread exercises, a
   per-pod muscle-group spread rule would raise output quality far more than
   any further catalog growth. The workout-generation design lists this as
   out of scope on purpose; this is the point at which it starts to cost
   something.
7. **`GenerationInfeasible` should name the emphasis.** `poolTooSmallReason`
   (`generation.ts:251-256`) blames the equipment filter or the recent-name
   filter. It cannot blame the emphasis, so the `calves` failure above
   reports a misleading reason.

### Migration and naming

8. **Nothing in the stored data breaks.** Stations are free text and never
   reference exercise ids — `docs/designs/exercise-library/design.md`
   ("Stations do not reference exercises") and `docs/glossary.md:22-25`. The
   12 seed workouts in `seed-workouts.json` keep their 104 station texts
   unchanged whatever the catalog says.
9. **20 of the 96 current names survive verbatim** in the proposal:
   `Barbell bent-over row`, `Barbell biceps curl`, `Barbell front squat`,
   `Barbell hang clean`, `Barbell thruster`, `Box jump`, `Burpee`,
   `Dumbbell Arnold press`, `Dumbbell biceps curl`,
   `Dumbbell Bulgarian split squat`, `Dumbbell floor press`,
   `Dumbbell incline bench press`, `Dumbbell renegade row`, `Jump rope`,
   `Kettlebell double front squat`, `Kettlebell sumo deadlift`,
   `Kettlebell swing`, `Sandbag bear-hug squat`, `Shuttle run`,
   `Single-leg RDL`. The other 76 are dropped or renamed.
10. **The no-repeat filter is name-based** (`generation.ts:153-159`), so a
    rename silently resets a user's recent-exercise exclusions once. That is
    harmless, but it is a behavior change worth knowing.
11. **Replacing the seed is a migration, not an edit.** `seed-exercises.ts`
    is frozen by design (`seed-exercises.ts:14-18`), the catalog is per-user,
    and existing users hold their own rows. A replacement needs a migration
    that decides whether to overwrite user rows, add the new ones, or seed
    new accounts only. `seed-exercises.test.ts` pins the current shape and
    must be regenerated in the same commit.
12. **Verify before adopting.** Every row's muscle and equipment mapping is
    machine-derived from the cited entry under the section 3 rules, but the
    canonical *name* is editorial. Rows whose j45 name and source name differ
    (all `plate`, `slam-ball`, `box`, `rower`, `bike`, `jump-rope`,
    `sliders`, `sandbag`, and `bench` rows) rest on a source for the muscle
    mapping only, and deserve a second read before they land.
13. **Six citations are shared by two rows each**, because the source
    database has one entry for a pair of close variants. In each pair the
    second row's citation is the nearest analogue, not the same movement:
    `Mountain climber` / `Slider mountain climber`;
    `Dumbbell goblet squat` / `Plate goblet squat`;
    `Dumbbell thruster` / `Slam ball squat to press`;
    `Barbell push press` / `Barbell thruster`;
    `Slam ball overhead slam` / `Slam ball over-shoulder throw`;
    `Sandbag bear-hug squat` / `Sandbag clean`.
