# ADR-0003 — Remove `full-body` from `MuscleGroup`

**Status:** accepted (2026-08-31)

## Context

The generate form's **Emphasis** field became a multi-select over `MuscleGroup`
(union rule: a strength exercise qualifies when it carries at least one of the
selected groups). That change made `full-body` a bad member of the list.

`full-body` never separated anything. 22 of the 96 seeded exercises carried it,
which is not a distinction. It also read as a promise the filter never kept: a
user who selects `Chest` expects thrusters to be excluded, and a user who
selects `Full body` expects a whole-body workout, but the tag only ever meant
"somebody typed this label".

`MuscleGroup` is a schema literal, `Exercise.muscleGroups` is a
`NonEmptyArray`, and exercises are stored per user as JSON blobs in
`exercises.body`. `decodeRow` ends in `Effect.orDie`, so a stored row that
still holds `full-body` after the literal is gone kills the server on read.
Any removal has to be total.

## Decision

Remove `full-body` from the `MuscleGroup` literal and from `muscleGroupLabel`.
The concept does not move anywhere else — not to `detail`, not to `Modality`.

Migration `0008` rewrites every `exercises` row by one mechanical rule:

- drop `full-body` from `muscleGroups`;
- where that empties the list, write `core` instead.

`seed-exercises.json` is edited by the same rule, so an existing user's rows
and a new user's seeded rows end up identical. Two seeded exercises take the
`core` fallback — *Sprawl + forward jump + back-pedal* and *Dumbbell sprawl +
lateral jump* — and both are cardio, which Emphasis never filters.

## Considered options

- **Expand instead of drop** — replace `full-body` with a fixed set such as
  `core, quads, back`. Rejected: it needs no special case, but it inflates
  every affected exercise's tags and distorts the Emphasis pool for all of
  them, to avoid a fallback that touches two exercises.
- **Relax the invariant** — make `muscleGroups` a plain `Schema.Array` and let
  those exercises hold no groups. Rejected: it weakens an invariant for the
  whole catalog, and an untagged strength exercise then becomes unreachable
  whenever any Emphasis is selected.
- **Keep `full-body` as a tag, hide it from the Emphasis chips.** Rejected:
  it leaves a value in the vocabulary that nothing reads, which is how the
  problem started.

## Trade-off

We accept losing the ability to say "this is a whole-body movement", and two
mediocre `core` tags, in exchange for a `MuscleGroup` vocabulary where every
member actually narrows a search. A burpee is now tagged `core`, and nothing in
the model records that it is a whole-body movement. If that concept is needed
again it should return as a deliberate one — an exercise-level flag or a
modality distinction — not as a muscle group that competes with real ones.
