// The frozen seed exercise catalog, hand-curated from the 12 seed workouts'
// 104 distinct station texts (see seed-workouts.json) under the exercise-library
// design's split/collapse/alternative rules (docs/designs/exercise-library):
//
// - Split combos: an "A: x · B: y" station becomes two entries (x, y) --
//   e.g. Apex's eight A/B stations each yield two exercises.
// - Collapse cue variants: tempo/count/pace suffixes ("— tempo 4-0-1",
//   "— fast, hips low", "— 5 each side", "(30s)") fold into the base movement,
//   and genuinely-distinct machine variations (Bike seated vs Bike climb)
//   collapse to the single base movement (Bike), the variation left to detail.
// - Alternatives pick the primary implement ("Slam ball / dumbbell RDL" ->
//   "Slam ball RDL", equipment [slam-ball], "or dumbbell" in detail).
//
// Stored as already-encoded Exercise JSON literals -- exactly like
// seed-workouts.ts -- never a live Schema.encode of a constructed value, so a
// later change to the Exercise schema cannot silently change what a fresh
// database's migration inserts. A future migration transforming exercises.body
// must regenerate this file in the same commit and tolerate both shapes.
//
// Consumed by ExercisesRepo.seedForUser (registration + the 0004 backfill).
// The curation itself is pinned by seed-exercises.test.ts, which decodes every
// entry as an Exercise and asserts the vocabulary-coverage guarantees.
//
// The literal data lives in the sibling seed-exercises.json -- `resolveJsonModule`
// inlines that file's exact JSON content at build time (this is *not* a runtime
// `JSON.parse`), so what's exported below is still the frozen JSON literal, not
// anything derived from the Exercise schema. It's a separate file only so the
// ~90 real transcriptions don't blow this module's line budget; the
// `ExerciseSeed` cast asserts exactly what the golden test verifies by actually
// decoding every seed with `Schema.decodeUnknown(Exercise)`.
import type { Exercise } from '@j45/domain'

import seedExercisesJson from './seed-exercises.json'

type ExerciseSeed = typeof Exercise.Encoded

export const seedExercises: readonly ExerciseSeed[] = Object.freeze(
  seedExercisesJson as unknown as readonly ExerciseSeed[],
)
