# ADR-0004 — Replace the seed exercise catalog and remove `Intensity`

**Status:** accepted (2026-09-02)

## Context

The shipped exercise catalog was transcribed from the station texts of the
12 seed workouts. Station text is choreography, not vocabulary. The result was
96 entries of which 18 were combo stations ("Push-up + spider lunge + row"),
several were cue fragments ("Squat pulse"), and some carried tags the generator
acts on wrongly (a landmine rotation tagged as a dumbbell movement). Nine of
the 16 `Equipment` literals had three or fewer entries. A strength Emphasis on
`calves` had one candidate, and the smallest template needs four stations, so
that legal request failed at every duration. The full audit, with line
references and per-row sources, is `docs/research/exercise-catalog.md`.

The same research found that the generator reads three exercise fields:
`modality`, `muscleGroups`, and `equipment`. It never reads `intensity`. That
field existed in the schema, the editor, and every stored row, and nothing
consumed it. ADR-0003 removed `full-body` for the same reason: a value that
nothing reads is a promise the model does not keep.

## Decision

1. **Replace the seed catalog** with the 120-exercise list from the research
   note. One movement per entry, names of the form `Implement + movement`, at
   most three muscle groups per entry, and `equipment` listing every implement
   the station physically needs. Two names in the note are shortened on
   adoption: "Row (rower)" ships as `Rower` and "Bike (stationary)" as `Bike`,
   which keeps the names the seed workouts already use for those stations.

2. **Remove `Intensity`** from the domain: the literal, its label map, and the
   `Exercise.intensity` field. The editor drops its select. The concept does
   not move anywhere else.

3. **Migration `0009`** applies both to stored data in one transaction:
   - Every stored body loses its `intensity` key.
   - A stored row whose body equals an entry of the previous catalog, field
     for field, is a shipped row the user never edited. It is deleted.
   - Every other row stays. It is the user's own work.
   - Every entry of the new catalog whose name is not already in the user's
     library, compared case-insensitively, is inserted.

   The previous catalog is frozen as
   `packages/server/src/library/seed-exercises-before-0009.json` so the
   migration can recognize it.

4. **The seed test gains a feasibility guarantee.** Every muscle group must
   have at least four strength entries, the smallest template's station count.
   "At least one entry per literal" was the previous bar, and it let the
   `calves` failure ship.

## Considered options

- **Add the new entries beside the old ones.** Rejected: the combo stations
  and wrong tags stay in every user's pool, and the problem the change exists
  to fix is not fixed.
- **Delete by name instead of by body.** Rejected: a user's edit of a shipped
  row is the user's work, and a name match would delete it.
- **Seed new accounts only.** Rejected: the existing accounts are the ones
  that hit the infeasible requests today.
- **Give `intensity` a job** (cap the count of `high` stations, or alternate
  intensities across a pod). Rejected for now: neither source database
  carries an intensity value, so every value would be editorial, and a rule
  built on editorial data is a rule nobody can check. If the concept is
  needed it should return with a source and a consumer in the same change.
- **Keep `intensity` in storage and drop it from the schema only.** Rejected:
  Effect Schema would ignore the extra key, but a stored field nothing reads
  is the failure ADR-0003 named.

## Trade-off

Users lose the shipped entries they knew from the seed workouts, unless they
had edited them. Their workouts are unchanged, because stations are free text
and never reference the catalog. The no-repeat filter is name-based, so a
renamed exercise resets that exclusion once. 20 of the 96 previous names
survive verbatim.

Two gaps remain and are recorded in the research note: bodyweight-only
strength with a `biceps` Emphasis has no candidate, because no such movement
exists without a bar; and the generator still samples uniformly, so a better
catalog raises output quality less than a per-pod spread rule would.

Related: [ADR-0003](0003-remove-full-body-muscle-group.md).
