# session-history — design

## What it is

A durable, per-participant record of live sessions: when a session that
actually started ends, every user who was ever in it gets a completion record
— which workout (name **and** the as-run `Workout` snapshot), when it started
and ended, who hosted, and who participated. A `/history` screen lists the
caller's records newest-first. **Deliberate scope cut from the brief** (owner
decision at design): no progress tracking — the brief's "and how far they
got" is dropped; a record proves participation in any capacity, nothing more.
**Later reversed** by `session-leave`, which added the optional `progress`
field and migration `0006`; `live-plan-sync` then fixed which plan that
progress is counted in (see the amendment below).

The snapshot is not decoration: it is what powers `workout-generation`'s
no-repeat-recently constraint (which exercises ran lately) and keeps history
independent of the library row, which can later be edited or deleted, or may
never have held that shape at all (a launch-time reflow).

> **Amended by `live-plan-sync`.** This document first said the snapshot keeps
> history truthful "when the source plan is later edited". A running session
> now tracks its workout, so an edit that lands while the timer is live
> becomes part of what the participant actually ran. One rule replaces the
> promise: a completion records **the last plan applied while the timer was
> still live**.
>
> Progress is counted in that same plan and in no other plan.
> `totalSegments` is the segment count of the recorded plan.
> `segmentsCompleted` is the furthest segment that the session published while
> it ran that plan. A clamp keeps the count inside the plan, so a row can
> never name a segment that its own plan does not hold. Both numbers come from
> one plan, so "segment N of M" has one meaning.
>
> Three consequences follow, and all three are intended:
>
> - **A change after the timer is done never reaches the record.** The plan
>   freezes at done, and so do the name and the progress.
> - **A session that a delete ends records the last plan the session held.**
>   The rule is worded this way for exactly this case: the record comes from
>   the plan held in memory, which the row deletion cannot touch. There is no
>   foreign key from completions to workouts.
> - **A session that a shorter plan exhausts records where it stopped**, in
>   the plan that it was running. It does not record the end of that plan. On
>   screen, the finish stays the same as a normal finish, on purpose. The
>   record must still show that the third station of five never ran. This
>   reverses an earlier reading, which recorded the whole plan as run to keep
>   the record the same as a normal finish. The rule above is what makes
>   "segment N of M" mean something, so the record now differs from the
>   screen. The screen keeps the clean finish.
>
> The known cost is that a session that ran across two plans is recorded
> against the later plan. The record does not stitch the two together. The
> owner considered a true as-run history across plan versions, and set it
> aside.

## How it fits

The architecture already pins the seam: `endSession` in
`packages/server/src/session/live-sessions.ts` carries the comment that
session-history hooks in there, with the final snapshot still readable before
teardown. Live sessions stay in-memory and disposable; the completion record
is the one thing that crosses into SQLite (glossary: "Ephemeral; only its
completion record persists"). Ownership is absolute as everywhere: each
participant gets their **own** row, and `ListHistory` returns only the
caller's rows.

Because the record must snapshot the **as-run** workout — post-reflow — this
feature depends on `flow-control` (both also touch `StartSession` and
`live-sessions.ts`, so the edge orders the builds too).

## Domain (`packages/domain/src/history.ts`)

```ts
export const CompletionId = Schema.String.pipe(Schema.brand('CompletionId'))

/** One user's record of one ended session. `workout` is the as-run snapshot:
 *  post-reflow, and the last plan applied while the timer was still live. */
export class SessionCompletion extends Schema.Class<SessionCompletion>('SessionCompletion')({
  id: CompletionId,
  sessionId: SessionId,
  workoutName: Schema.NonEmptyTrimmedString,
  workout: Workout,
  host: Participant,
  participants: Schema.NonEmptyArray(Participant),
  startedAt: Schema.DateTimeUtc,
  endedAt: Schema.DateTimeUtc,
}) {}
```

New rpc group (merged into `J45Rpcs` **in the same commit** as its handler
layer — the pre-commit check enforces this):

```ts
export class HistoryRpcs extends RpcGroup.make(
  Rpc.make('ListHistory', { success: Schema.Array(SessionCompletion) }),
).middleware(AuthMiddleware) {}
```

No pagination — friends/family scale; newest-first, all rows.

## Server

**Migration `0005_history.ts`** — follows `0004_exercises.ts`'s conventions
(body = Schema-encoded JSON, denormalized only what queries need):

```sql
CREATE TABLE session_completions (
  id        TEXT PRIMARY KEY,
  user_id   TEXT NOT NULL REFERENCES users(id),
  ended_at  TEXT NOT NULL,   -- ORDER BY column; also inside body
  body      TEXT NOT NULL    -- Schema-encoded SessionCompletion
);
CREATE INDEX session_completions_user ON session_completions(user_id, ended_at);
```

**`completions-repo.ts`** (`packages/server/src/session/`): `insertAll`
(one transaction, one row per participant with a fresh `CompletionId` each)
and `listForUser(userId)` (`WHERE user_id = ? ORDER BY ended_at DESC`),
`SqlClient`-only like the other repos.

**`live-sessions.ts` changes:**

- `StartParams` and `SessionHandle` gain `workout: Workout` — the as-run
  workout `StartSession` hands over (post-reflow; `handlers.ts` already has
  it in hand at that point).
- The handle gains an add-only roster, `Ref<HashMap<UserId, Participant>>`,
  seeded with the host and added to by `join` — unlike `presence`, nobody is
  ever removed: "participated in any capacity".
- The handle gains a `progressed: Ref<boolean>`, set when a published timer
  state reaches `segmentIndex >= 1` or `done` (one line in `applyTimer`'s
  publish path). A session that never left the ready segment (host quit or
  GC during the countdown) is a false start and writes **nothing** — it
  pollutes neither history nor no-repeat.
- `endSession` (the recorded seam): read the final state, roster, and
  `progressed`; if progressed, build one `SessionCompletion` per roster
  member (same `sessionId`, `workoutName`, snapshot, host, full roster,
  `startedAt`, `endedAt = now`) and persist via `CompletionsRepo.insertAll`.
  Teardown (registry removal + `Deferred.succeed`) runs regardless — wrap
  the persist so a `SqlError` is logged loudly as a defect but never leaves
  the session undead. `LiveSessions` gains `CompletionsRepo` as a service
  dependency; its restart semantics are untouched (rebuilding the layer
  still yields an empty registry while `session_completions` rows survive —
  that contrast is now testable).

**`HistoryHandlersLive`**: `ListHistory` → `completionsRepo.listForUser(CurrentUser.id)`,
with the standard `asDefect` SqlError posture.

## Client

- New route `/history` (nav link from the library home, alongside
  `/exercises` and `/timer`).
- Newest-first list; each row: workout name, ended date/time, host display
  name (rendered as "you" when the host is the caller), and the participant
  display names. No detail screen, no actions — a list is the whole feature.

## Testing

- **Integration (TestClock):** host starts, ticker crosses into work, a
  second user watches then unsubscribes, host quits → both users'
  `ListHistory` each hold one record with the workout name, as-run snapshot,
  host, both participants, `startedAt`, `endedAt`; quit during ready writes
  nothing; a progressed session GC'd after 60 idle seconds writes records; a
  reflowed start records the reflowed snapshot, not the stored plan.
- **Integration:** `ListHistory` is caller-scoped and newest-first;
  rebuilding the server layer preserves rows while `ListActiveSessions` is
  empty; migration 0005 on a database migrated through 0004 yields an empty
  history for existing users.
- **e2e (chromium + webkit):** two logged-in contexts run a short session
  (host quits after the first work segment); `/history` via the home nav
  shows workout name, date, host, and both participant names — for both
  users.

## Out of scope (later or never)

Progress/how-far tracking (cut); per-exercise performance data (brief
non-goal); re-run-from-history; deleting or editing history rows; pagination.

## Notes for the builder

- The roster and `presence` are different structures on purpose — do not
  derive the roster from presence (leavers vanish from presence but must
  stay in the roster).
- `endedAt` comes from the server clock at `endSession` time via
  `DateTime.now`, so TestClock drives it in tests like everything else.
- Encode the `SessionCompletion` once and write the same value's `ended_at`
  into the column — two sources of truth for the timestamp is a bug farm.
