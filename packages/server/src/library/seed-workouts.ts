// The 12 legacy F45 workouts (~/Git/diet-f45/public/workouts.json), frozen as
// already-encoded Workout JSON literals -- never a live Schema.encode of a
// constructed value, so a later change to the Workout schema can't
// silently change what a fresh database's migration 0003 inserts. Consumed
// by workouts-repo's seedForUser and the 0003 backfill (both land with
// migration-repo).
//
// Transcription rules (docs/designs/plan-library/design.md):
// - <span class='sub'>(...)</span> becomes the station's detail.
// - <span class='tag t-c'>C</span> / t-r cardio/resistance badges are
//   dropped -- real exercise tagging arrives with exercise-library.
// - <b>A</b> x . <b>B</b> y alternating combos become plain "A: x . B: y".
// - HTML entities are decoded (&amp; -> &); all other markup is stripped.
// - focus: "resist" becomes "strength".
// - Legacy chips/timing are dropped (derivable from flow).
// - SoCal's reel (finisher instructions) is appended to its note.
// - Names are exactly the legacy day names -- no week/day markers.
//
// Intentionally independent of packages/domain/test/fixtures/legacy.ts
// (four of these names overlap by coincidence, not by shared source) -- see
// this file's own test for the compiled-workout goldens.
//
// The literal data itself lives in the sibling `seed-workouts.json` --
// `resolveJsonModule` inlines that file's exact JSON content at build time
// (this is *not* a runtime `JSON.parse`), so what's exported below is still
// the frozen JSON literal, not anything derived from the `Workout` schema.
// It's a separate file, rather than object literals directly in this
// module, only so the twelve real transcriptions (unavoidably long -- real
// station names, twelve workouts) don't blow this file's line budget; the
// `as WorkoutSeed` cast below asserts exactly what the golden test in
// `seed-workouts.test.ts` verifies by actually decoding every seed with
// `Schema.decodeUnknown(Workout)`.
import type { Workout } from '@j45/domain'

import seedWorkoutsJson from './seed-workouts.json'

type WorkoutSeed = typeof Workout.Encoded

const data = seedWorkoutsJson as unknown as {
  readonly athletica: WorkoutSeed
  readonly romans: WorkoutSeed
  readonly miamiNights: WorkoutSeed
  readonly panthers: WorkoutSeed
  readonly docklands: WorkoutSeed
  readonly redDiamond: WorkoutSeed
  readonly crossfire: WorkoutSeed
  readonly hammer: WorkoutSeed
  readonly pipeline: WorkoutSeed
  readonly medusa: WorkoutSeed
  readonly soCal: WorkoutSeed
  readonly apex: WorkoutSeed
}

export const {
  athletica,
  romans,
  miamiNights,
  panthers,
  docklands,
  redDiamond,
  crossfire,
  hammer,
  pipeline,
  medusa,
  soCal,
  apex,
} = data

export const seedWorkouts: readonly WorkoutSeed[] = [
  athletica,
  romans,
  miamiNights,
  panthers,
  docklands,
  redDiamond,
  crossfire,
  hammer,
  pipeline,
  medusa,
  soCal,
  apex,
]
