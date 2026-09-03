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
 * `migration-0008.test.ts` reads it. The catalog it describes was replaced by
 * migration `0009` (ADR-0004), so the shipped seed no longer resembles it.
 */
export const preMigrationSeed = preMigrationSeedJson as readonly PreMigrationExercise[]
