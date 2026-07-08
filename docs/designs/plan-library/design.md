# plan-library — design

## What it is

Per-user workout libraries: every account owns a private collection of
workouts, seeded at registration with a copy of the legacy 3-week program
(12 workouts), browsable and lightly manageable in the client. This feature
introduces durable user content (the `workouts` table), the `LibraryRpcs`
group, the client's router, and the library-as-home UI. Structural editing is
`plan-editing`; starting sessions is `live-session` — both build directly on
what this feature lands.

Ownership model (decided at design interview): **every workout has exactly one
owner; there is no shared or global content.** Registration copies the 12
seeds into the new account's library; copies then evolve independently. New
seed content added later does not propagate to existing accounts — accepted.
There is **no Program entity** — workouts are the container, exercises
(stations) are the leaf nodes; the legacy program survives only as 12
ordinary workouts under their original names (Athletica … Apex). The
week/day structure is not carried over in any form — not relevant in the new
paradigm.

## Seed source — verified

The legacy app's content is `~/Git/diet-f45/public/workouts.json` **alone**.
The brief's "merged with overrides.json on the VPS" is moot: verified
July 2026 that `/opt/diet-f45/overrides.json` does not exist (the legacy
server creates it on first saved edit; none was ever saved). 12 workouts,
3 weeks × 4 days. Four of them (Athletica, Docklands, Medusa, Apex) are
already transcribed as domain test fixtures
(`packages/domain/test/fixtures/legacy.ts`) — the remaining eight follow the
same transcription conventions, extended below.

### Transcription rules

Established by the workout-domain fixtures, extended for markup those four
days don't contain:

- `<span class='sub'>(…)</span>` → the station's `detail` field.
- `<span class='tag t-c'>C</span>` / `<span class='tag t-r'>R</span>`
  prefixes (hybrid-day cardio/resistance badges) → **dropped**; real exercise
  tagging arrives with `exercise-library`.
- `<b>A</b> x · <b>B</b> y` alternating combos → plain text `A: x · B: y`
  (the letters are semantic — alternate exercises — and stay).
- HTML entities decoded (`&amp;` → `&`); all other markup stripped.
- `focus: "resist"` → `"strength"`; legacy `chips`/`timing` dropped
  (derivable); SoCal's `reel` (finisher instructions) appended to its `note`.
- Names stay exactly the legacy day names (`Athletica` … `Apex`) — no
  week/day markers; seeds sort alphabetically among everything else.
- Program-level `arc`/`rhythm`/`warmup`/`cooldown`/`swaps` are **not
  migrated** (decided at interview).

### Seed fidelity goldens

Derived by porting legacy `buildSegments` (server.js:132-154) over the real
data; the four workout-domain goldens match exactly, validating the port.
Compiling each transcribed seed with the domain `compile` must yield:

| Seed | Works | Total | | Seed | Works | Total |
|---|---|---|---|---|---|---|
| Athletica | 27 | 1605s | | Crossfire | 40 | 2235s |
| Romans | 24 | 2120s | | Hammer | 18 | 1110s |
| Miami Nights | 24 | 1425s | | Pipeline | 36 | 2145s |
| Panthers | 27 | 1470s | | Medusa | 27 | 2180s |
| Docklands | 36 | 1710s | | SoCal | 36 | 2155s |
| Red Diamond | 36 | 2135s | | Apex | 8 | 2135s |

## Data model — migration 0003_library

One table. The body is the Schema-encoded `Workout` (workout-domain's value
object — "plan-library persists Workout as the document body"); the name
lives **inside** the body, single source of truth, no denormalized column.

```sql
CREATE TABLE workouts (
  id          TEXT PRIMARY KEY,              -- WorkoutId, crypto.randomUUID()
  owner_id    TEXT NOT NULL REFERENCES users(id),
  body        TEXT NOT NULL,                 -- JSON: Schema-encoded Workout
  created_at  TEXT NOT NULL,                 -- ISO-8601 UTC, from Effect Clock
  updated_at  TEXT NOT NULL
);
CREATE INDEX workouts_owner_id ON workouts(owner_id);
```

The same migration **backfills** accounts that predate it: for every existing
`users` row, insert the 12 seed copies (fresh ids per user). Registration
handles all accounts created afterwards.

## Domain additions (`packages/domain`)

`packages/domain/src/library.ts` — pure Schema, package deps stay exactly
`effect` + `@effect/rpc`:

```ts
export const WorkoutId = Schema.String.pipe(Schema.brand("WorkoutId"))

export class LibraryWorkout extends Schema.Class<LibraryWorkout>("LibraryWorkout")({
  id: WorkoutId,
  workout: Workout,                  // the workout-domain value object, whole
  createdAt: Schema.DateTimeUtc,
  updatedAt: Schema.DateTimeUtc,
}) {}

export class WorkoutNotFound extends Schema.TaggedError<WorkoutNotFound>()("WorkoutNotFound", {
  id: WorkoutId,
}) {}
```

`packages/domain/src/rpc.ts` grows a fourth group, merged into `J45Rpcs`
exactly like `AccountRpcs`/`OwnerRpcs`:

```ts
export class LibraryRpcs extends RpcGroup.make(
  Rpc.make("ListWorkouts", { success: Schema.Array(LibraryWorkout) }),
  Rpc.make("GetWorkout", { payload: { id: WorkoutId },
    success: LibraryWorkout, error: WorkoutNotFound }),
  Rpc.make("DuplicateWorkout", { payload: { id: WorkoutId },
    success: LibraryWorkout, error: WorkoutNotFound }),
  Rpc.make("RenameWorkout", { payload: { id: WorkoutId, name: Schema.NonEmptyTrimmedString },
    success: LibraryWorkout, error: WorkoutNotFound }),
  Rpc.make("DeleteWorkout", { payload: { id: WorkoutId }, error: WorkoutNotFound }),
).middleware(AuthMiddleware) {}

export class J45Rpcs extends PublicRpcs.merge(AccountRpcs, OwnerRpcs, LibraryRpcs) {}
```

Semantics:

- Every rpc is scoped to `CurrentUser` (provided by the existing
  `AuthMiddleware`). A workout that doesn't exist **or belongs to someone
  else** fails `WorkoutNotFound` — foreign ids are indistinguishable from
  absent ones; existence is never leaked. `Forbidden` is not used here.
- `ListWorkouts` returns the caller's full library (bodies included — at
  friends/family scale a library is tens of ~1-3 KB documents; no summary
  type, no pagination), sorted by workout name, case-insensitive.
- `DuplicateWorkout` inserts a copy owned by the caller, name suffixed
  `" (copy)"`, fresh id and timestamps.
- `RenameWorkout` rewrites `body.name` (decode → update → encode) and bumps
  `updated_at`. There is deliberately no `CreateWorkout` — authoring arrives
  with `plan-editing`.

## Server (`packages/server`)

`packages/server/src/library/`, following the `auth/` idioms (services via
`Effect.Service`, persistence only through the `SqlClient.SqlClient` tag,
timestamps via Effect Clock / `DateTime.now`):

- **`seed-workouts.ts`** — the 12 transcribed seeds as **frozen,
  already-encoded `Workout` JSON literals** (`typeof Workout.Encoded`), with
  a unit test decoding each and asserting the golden table above. Frozen literals (not live `Schema.encode` of constructed
  values) so a later change to the `Workout` schema cannot silently change
  what migration 0003 inserts on a fresh database.
- **`workouts-repo.ts`** — `WorkoutsRepo`: `listForOwner`, `getOwned`,
  `insert`, `rename`, `delete`, `duplicate`, and `seedForUser(userId)`
  (inserts the 12 copies; used by both registration and the 0003 backfill).
- **`handlers.ts`** — `LibraryHandlersLive = LibraryRpcs.toLayer(…)`, merged
  into `server.ts`'s `RpcHandlersAll`; `WorkoutsRepo.Default` joins the
  `AuthServicesLive` bundle.

**Registration seeding:** `Accounts.register` (`auth/accounts.ts`) gains a
`WorkoutsRepo` dependency and calls `seedForUser` inside its existing
`sql.withTransaction` — an account and its seed library appear atomically.
`SharedAuthServicesLive` in `server.ts` adds `WorkoutsRepo.Default`.

## Client (`packages/client`)

**Router (new):** `@tanstack/react-router`, code-based route tree (no
file-based codegen), exact-pinned like every dependency. Typed
routes/params/links match the Schema-everywhere ethos. Routes:

| Path | Screen |
|---|---|
| `/` | LibraryScreen (home) |
| `/workouts/$workoutId` | WorkoutDetailScreen |
| `/account` | the existing AccountScreen, now routed |

**Gate/router composition:** `AuthGate` stays *outside* the router —
login/register are gate states, not routes, exactly as built; the
`RouterProvider` renders in the gate's authenticated branch. Because the gate
never redirects, a deep link (e.g. `/workouts/<id>`) shows LoginScreen, then
the router renders the original path once authenticated. **`/glass` keeps its
pre-gate `location.pathname` switch in `app.tsx`** — its e2e suite runs
unauthenticated and must keep passing unchanged.

**LibraryScreen** (home): the caller's workouts from a
`ServerRpcClient.query("ListWorkouts")` atom, rendered as shadcn list
cards — name, focus, station count, and total duration computed client-side
via the domain `compile` (`totalDurationMillis`, displayed `MM:SS` by ceil,
matching the domain design's display convention). Header nav links to
`/account`. All components follow the existing `useAtomValue` +
`Result.match` idiom; typed failures render as human-readable states.

**WorkoutDetailScreen:** fetches `GetWorkout` by route param; shows flow
summary (type, rounds as `40″/20″ × 3` when uniform, the ladder otherwise),
pods with their stations (name + muted `detail`), total duration; actions:
rename (dialog), duplicate (lands in list), delete (confirm dialog →
navigate home). Mutations via the client's rpc mutation atoms, refreshing
the list atom on success.

## Testing

- **Unit (vitest):** every seed body decodes as `Workout`; compiled works
  count and total match the golden table for all 12.
- **Integration (sqlite-node in-memory, per `server/test` conventions):**
  registration creates user + 12 seeds atomically (and a failed registration
  creates neither); two accounts get independent copies (distinct ids;
  deleting one user's workout leaves the other's library intact); the 0003
  backfill seeds a user inserted before the migration runs; authz — foreign
  `Get`/`Rename`/`Duplicate`/`Delete` fail `WorkoutNotFound`, `ListWorkouts`
  never returns another owner's rows.
- **e2e (existing Playwright harness, chromium + webkit):** login lands on
  the library home listing the 12 seeds; Athletica detail shows 3 pods /
  9 stations / 26:45; duplicate → rename → reload persists → delete;
  deep-link to a workout URL renders it after PIN login; `/account`
  reachable via nav; the existing auth and glass suites pass unchanged.

## Out of scope (later features)

Creating workouts from scratch and any structural editing (`plan-editing`);
starting or joining sessions (`live-session`); a shared/global catalog or
re-propagating seed updates (revisit only if copy-drift actually hurts);
first-class exercises or tags (`exercise-library`); search/pagination;
import/export. Extra is a failure like missing.

## Notes for the builder

- Pin `@tanstack/react-router` at an exact version like every other dep.
- The name lives in `body` only — resist adding a `name` column; sort after
  decode in the handler.
- `WorkoutNotFound` for foreign ids is deliberate (no existence leak); write
  the repo queries as `WHERE id = ? AND owner_id = ?` so it falls out.
- Seed-freeze discipline: any future migration that transforms `workouts.body`
  must regenerate `seed-workouts.ts` in the same commit **and** tolerate both
  shapes, because a fresh database runs 0003 with the current seed file
  before that transform runs.
- The four domain test fixtures stay independent of the seed module even
  though the names now coincide — goldens and production seeds deliberately
  don't share source.
