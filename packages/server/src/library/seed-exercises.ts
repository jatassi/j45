// The frozen seed exercise catalog: 120 straightforward, widely recognized
// exercises, each mapped to exact `Exercise` literals. The curation and its
// per-row sources are recorded in docs/research/exercise-catalog.md, and the
// decision to adopt it is ADR-0004.
//
// Rules the catalog follows:
//
// - One movement per entry. No combo stations ("x + y"), no cue fragments
//   ("Squat pulse"), no "or"-alternatives in the name.
// - Names are `Implement + movement`, sentence case.
// - At most three muscle groups per entry, so every Emphasis selection
//   still narrows the pool.
// - `equipment` lists every implement the station physically needs. An
//   empty list means bodyweight.
//
// Stored as already-encoded Exercise JSON literals -- exactly like
// seed-workouts.ts -- never a live Schema.encode of a constructed value, so a
// later change to the Exercise schema cannot silently change what a fresh
// database's migration inserts. A future migration transforming exercises.body
// must regenerate this file in the same commit and tolerate both shapes.
//
// Consumed by ExercisesRepo.seedForUser (registration + the 0004 backfill),
// and by migration 0009, which replaces the previous catalog in existing
// users' libraries. The previous catalog is frozen in the sibling
// seed-exercises-before-0009.json so that migration can recognize it.
// The curation itself is pinned by seed-exercises.test.ts, which decodes every
// entry as an Exercise and asserts the vocabulary-coverage guarantees.
//
// The literal data lives in the sibling seed-exercises.json -- `resolveJsonModule`
// inlines that file's exact JSON content at build time (this is *not* a runtime
// `JSON.parse`), so what's exported below is still the frozen JSON literal, not
// anything derived from the Exercise schema. The `ExerciseSeed` cast asserts
// exactly what the golden test verifies by actually decoding every seed with
// `Schema.decodeUnknown(Exercise)`.
import type { Exercise } from '@j45/domain'

import seedExercisesJson from './seed-exercises.json'

type ExerciseSeed = typeof Exercise.Encoded

export const seedExercises: readonly ExerciseSeed[] = Object.freeze(
  seedExercisesJson as unknown as readonly ExerciseSeed[],
)
