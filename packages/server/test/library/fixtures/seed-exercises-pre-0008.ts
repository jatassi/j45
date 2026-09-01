import preMigrationSeedJson from './seed-exercises-pre-0008.json'

/**
 * One entry of the shipped seed catalog, in its pre-0008 stored shape.
 *
 * Typed here, and never as `typeof Exercise.Encoded`. The domain schema is
 * what stops accepting `full-body` (issue #30). A fixture typed against that
 * schema would stop compiling for the reason migration `0008` exists.
 */
export type PreMigrationExercise = {
  readonly name: string
  // `| undefined` because `exactOptionalPropertyTypes` is on, and the shipped
  // seed type declares `detail` this way.
  readonly detail?: string | undefined
  readonly modality: string
  readonly muscleGroups: readonly string[]
  readonly equipment: readonly string[]
  readonly intensity: string
}

/**
 * The shipped seed catalog as it stood before migration `0008` removed
 * `full-body` (ADR-0003). This is the real historical data, copied at the
 * commit that made the edit, so it is the exact input the migration meets on
 * an existing user's server.
 *
 * Two tests read it. `migration-0008.test.ts` seeds a user with it and proves
 * the migrated rows match the shipped seed. `seed-exercises.test.ts` compares
 * it against the shipped seed to prove that every surviving muscle group
 * keeps its strength exercises.
 */
export const preMigrationSeed = preMigrationSeedJson as readonly PreMigrationExercise[]
