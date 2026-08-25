# Design — session-leave

Per-participant leave for live sessions, replacing the all-or-nothing `quit`.
This is the one slice of the UI/UX overhaul (brief:
`docs/briefs/ui-ux-overhaul.md`) that touches domain and server; the player UI
that invokes it ships in `player-screens`. The decided semantics: a
mid-workout exit records the leaving participant's progress in their history,
and the session ends when the last participant leaves. There is no "end for
everyone" control — leave is the only exit, including at the done screen.

## Contract changes (`@j45/domain`)

`SessionCommand` shrinks — `quit` is removed:

```ts
// packages/domain/src/session.ts (today)
export const SessionCommand = Schema.Literal('pause', 'resume', 'skip', 'prev', 'quit')
// becomes
export const SessionCommand = Schema.Literal('pause', 'resume', 'skip', 'prev')
```

`SessionRpcs` gains one member. Unlike `SendSessionCommand` (deliberately
identity-agnostic), the handler for this one reads `CurrentUser` — leaving is
inherently about who you are:

```ts
Rpc.make('LeaveSession', { payload: { id: SessionId }, error: SessionNotFound })
```

`SessionCompletion` (packages/domain/src/history.ts) gains a progress field so
"how far they got" is recorded per participant. Optional, because rows written
before this feature have no progress:

```ts
export class CompletionProgress extends Schema.Class<CompletionProgress>('CompletionProgress')({
  segmentsCompleted: Schema.Int, // index of the furthest segment entered (ready = 0)
  totalSegments: Schema.Int,     // compiled.segments.length for the as-run workout
}) {}
// on SessionCompletion:
progress: Schema.optional(CompletionProgress)
```

Per the J45Rpcs rule, the contract change and its handler land in the same
commit (`SessionRpcs` already exists in `J45Rpcs`, so this is an edit, not a
new group).

## Server semantics (`packages/server/src/session/live-sessions.ts`)

Today: `roster` (add-only, seeded with host) drives completion rows;
`endSession` writes one row per roster member iff `progressed`, then removes
the handle and succeeds `ended` (interrupting every watcher via
`Stream.interruptWhenDeferred`). GC ends a session with 0 raw subscribers for
60s. `watch` joins/leaves presence via `Effect.acquireRelease`.

`leaveSession(id, userId)` — serialized through the handle's `sem` like every
other mutation:

1. **Record**: if the session has `progressed` (same `isProgressed` gate as
   today), write the leaver's `SessionCompletion` row *now* — personal
   `endedAt` = leave time, `progress` = the current timer position
   (`segmentsCompleted` from the published timer state), `participants` = the
   roster at write time. A leaver before progression gets no row (parity with
   today's ready-segment quit).
2. **Unroster**: remove the leaver from `roster` so `endSession` never writes
   them a second row. Track them in a new `departed` set so a rejoin
   (re-`watch` after leaving) re-adds them to the roster as a fresh
   ever-participant and clears their departed flag — rejoin is allowed and
   just works. A leave-then-rejoin user can therefore end the session with
   **two completion rows, one per stint** — truthful and deliberately simple;
   history rendering copes fine at friends/family scale.
3. **Detach**: remove the leaver's presence entirely (all their subscription
   counts) and end their watch streams. Builder's latitude on mechanism (a
   per-user interrupt signal alongside the session-wide `ended` deferred is
   the obvious shape); the invariant is that the leaver's streams complete and
   later stream-release finalizers must not double-decrement presence or
   `rawSubs` for a user already detached.
4. **Maybe end**: if presence is now empty **and** every roster member has
   departed, end the session immediately (nothing left to record —
   `endSession` finds an empty roster and just tears down). If presence is
   empty but the roster still holds non-departed members (users whose
   connection dropped without an explicit leave, or a host who never watched),
   do **not** end immediately — the existing 60s GC covers them, and
   `endSession` writes their rows at GC time with the session-end `endedAt`
   and the final timer position as `progress`, exactly today's guarantee plus
   the new field.

`endSession` itself changes only in that rows it writes now carry `progress`
(the timer position when it runs).

> **Amended by `live-plan-sync`.** The published timer state is no longer the
> source of `segmentsCompleted`. A running session now tracks its workout, and
> two of the ways that it can stop leave no position on the timer to read. A
> `done` timer holds no segment index. A plan that no longer reaches the
> session's work ordinal finishes the session before the session reached the
> end of the plan that the row records. The handle keeps `reachedSegment`
> instead. Each published snapshot raises it, and each applied plan change
> sets it to a segment of the new plan. For an ordinary leaver the number is
> the same as before. See the `session-history` design for the full rule.

The `command` special-case for `'quit'` is deleted along with the literal.
Restart/GC behavior, the ticker, and `SessionNotFound` semantics are
untouched.

## Persistence

Migration `0006` adds nullable `progress_segments_completed` and
`progress_total_segments` columns to `session_completions`; the repo maps
NULLs to an absent `progress`. Existing rows stay valid. Forward-only, no
backfill.

## Client (minimal wiring here; real UI in `player-screens`)

- `lib/session.ts` gains `leaveSessionAtom = ServerRpcClient.mutation('LeaveSession')`.
- The done-state "Finish" button and the interim mid-workout exit both call
  `LeaveSession` instead of dispatching `quit` (the `quit` dispatch is removed
  with the literal — the client cannot keep compiling against it). The
  redesigned leave control, confirm dialog, and history progress display ship
  with `player-screens` / `secondary-screens`.
- The leaver's own feed ends when their streams are detached; the existing
  `ended` fold (navigate home) already handles it. Other participants simply
  see the participant list shrink.

## Constraints

- In-memory-only stance unchanged: no session state is persisted mid-flight;
  the only durable write is `session_completions`.
- `bun run check`, `bun run test`, `bun run test:e2e` green; existing
  history/live-session e2e specs updated where they dispatched `quit`
  (the two-context live-session spec's "A quitting returns B home" assertion
  becomes "A leaving removes A from B's participant list; B leaving then ends
  the session").
