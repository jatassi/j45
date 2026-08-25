# live-session — design

## What it is

Server-authoritative live workout sessions: a user starts one of their library
workouts as a session; other logged-in users join it in **one tap**; every
joined phone shows the same countdown, beeps in sync, and can pause / resume /
skip / prev / quit for everyone. This is the heart of the app — the thing two
phones in a garage actually run. Legacy parity target: diet-f45's single
shared SSE session (`server.js:124-243`, `app.js:41-86`), generalized to
many concurrent per-host sessions.

## How it fits — the pinned architecture, made concrete

`docs/architecture.md` already binds the shape (quotes below are its
contracts, not new inventions):

- "Live sessions are in-memory actors: a `LiveSessions` `Effect.Service`
  holding one handle per active session — a `SubscriptionRef<SessionState>`
  mutated only through serialized updates, plus a ticker fiber
  (`Effect.forkScoped`) owned by the session's `Scope`."
- "The server is the clock of record… clients interpolate with
  `requestAnimationFrame` but never advance state themselves. All server time
  flows through Effect `Clock` so TestClock can drive it."
- "Sessions are not persisted mid-flight; a server restart drops live
  sessions… but never durable data."
- Cross-user rule: "joining a live session … streams content — never grants
  access to another user's rows." The joiner receives the compiled workout
  inside the session state; they never read the host's `workouts` row.

Depends on `plan-library` (sessions start from a library workout) and
`manual-timer` (the client player kit — audio, wake lock, countdown hook —
lives there; this feature reuses it, per the architecture's player-kit
contract).

> **Amended by `live-plan-sync`.** This document first said that a session's
> compiled workout "changes never". That is no longer true, and the reversal
> is deliberate: a running session is a live view of its source workout, not a
> frozen instantiation of it. An edit to the workout recompiles into every
> session that tracks it and lands at the next segment boundary, with the
> timer re-entering at the same work ordinal. `planRevision` counts the
> changes that landed, so a client can raise one notice for each. A session
> launched with a reflow overlay is exempt: its plan was never in the library.
>
> Three timer positions have no next boundary to wait for. A paused session
> takes the edit at once — an edit that arrives during the pause, and an edit
> already held when the pause began. The time it has left is re-derived from
> the segment now in force whenever that segment differs from the one the
> participant holds, so the resume counts down the segment it is actually in.
> A segment equal to the one they hold keeps the time left as it stands: an
> edit that touches a later station leaves this interval alone, and a
> re-derive there would make the participant run the whole interval a second
> time. A done session is frozen: no later change reaches it, and its
> completion row keeps the plan that was in force while the timer ran — the
> name and the progress with it. A new plan that no longer reaches
> the current work ordinal finishes the session on the plan it was running;
> the alternative, a clamp backwards, replays a station the participant
> completed. That finish raises no notice and moves no revision, so on screen
> a participant cannot tell it from the last segment of the plan. The
> completion row does show the difference, and it must. The row records the
> furthest segment that the session published. A session that a host trims two
> stations from the end is therefore not recorded as having run them.
>
> Deleting the workout ends every live session of it, the reflow-launched ones
> with the rest. The reflow exemption covers *content* changes only: an edit
> or a rename can never apply to a plan the library never held, but a reflow
> session runs an overlay of a plan that is now gone, so it has no source left
> to follow. Before the delete, the host is told how many sessions stop. That
> count comes from lobby rows, and a lobby row does not say which sessions are
> reflow-launched. A session left running is thus a session that the host was
> told would stop.
>
> Each ended session publishes one last snapshot with `ended` set, which says
> whether it stopped for the ordinary reasons (`closed`) or because the plan
> went (`plan-deleted`). A session whose timer already reached the end takes
> `closed` for a delete as well: its participants completed the workout and
> sit on the finished screen, so nothing was taken from them. That snapshot is
> also what ends a watcher's stream, so a participant always learns why they
> were sent home. The session-wide `ended` deferred no longer stops the
> stream: it would race that last snapshot out of the subscriber's queue.
> Completion rows are still written, from the plan the session last applied —
> the deleted library row is never read.
>
> A participant who is disconnected when the session ends receives no last
> snapshot at all: by the time they retry the watch, the session is gone from
> the registry. The registry therefore keeps a short record of how the last
> sessions ended, and a lookup that finds no session answers `SessionNotFound`
> with the reason from it. The record is bounded by count, not by age — a
> count needs no clock and no sweeper fiber, and it gives an exact ceiling on
> what the record can hold. An ending the server can no longer name reads as
> the ordinary one, which is the safe answer.

## Domain additions (`packages/domain/src/session.ts`)

Pure Schema; package deps stay exactly `effect` + `@effect/rpc`.

```ts
export const SessionId = Schema.String.pipe(Schema.brand('SessionId'))

export class Participant extends Schema.Class<Participant>('Participant')({
  userId: UserId,
  displayName: Schema.String,
}) {}

export class SessionState extends Schema.Class<SessionState>('SessionState')({
  id: SessionId,
  host: Participant,
  workoutName: Schema.NonEmptyTrimmedString,
  compiled: CompiledWorkout,          // sent in every snapshot; a few KB
                                      // — an applied plan change replaces it
  timer: TimerState,                  // endsAtMillis is server-epoch absolute
  serverNow: Schema.Number,           // epoch millis at emit — client computes clock offset
  participants: Schema.Array(Participant),
  planRevision: Schema.Int,           // rises only when a plan change lands
  planChangedBy: Schema.NullOr(Schema.String), // who made that change
  ended: Schema.NullOr(SessionEnd),   // set on the last snapshot only; says why
}) {}

export const SessionEnd = Schema.Literal('closed', 'plan-deleted')

export class SessionSummary extends Schema.Class<SessionSummary>('SessionSummary')({
  id: SessionId,
  workoutId: WorkoutId,               // the library workout the session was started from
  hostDisplayName: Schema.String,
  workoutName: Schema.NonEmptyTrimmedString,
  startedAt: Schema.DateTimeUtc,
  participantCount: Schema.Int,
}) {}

export const SessionCommand = Schema.Literal('pause', 'resume', 'skip', 'prev', 'quit')

// via the file-local `const taggedError = Schema.TaggedError` alias — the
// mandatory oxlint workaround documented in auth.ts/library.ts
export class SessionNotFound extends taggedError<SessionNotFound>()('SessionNotFound', {
  id: SessionId,
  endedAs: Schema.NullOr(SessionEnd),  // why that session ended, while the
                                       // server still remembers; else null
}) {}
```

`rpc.ts` grows a fifth group, merged into `J45Rpcs` like the others:

```ts
export class SessionRpcs extends RpcGroup.make(
  Rpc.make('StartSession', { payload: { workoutId: WorkoutId },
    success: SessionSummary, error: WorkoutNotFound }),
  Rpc.make('ListActiveSessions', { success: Schema.Array(SessionSummary) }),
  Rpc.make('WatchSession', { payload: { id: SessionId },
    success: SessionState, error: SessionNotFound, stream: true }),
  Rpc.make('SendSessionCommand', { payload: { id: SessionId, command: SessionCommand },
    error: SessionNotFound }),
).middleware(AuthMiddleware) {}
```

Semantics:

- **StartSession** compiles the caller's own workout (`WorkoutsRepo.getOwned`
  — a foreign id fails `WorkoutNotFound`, the no-leak rule) and creates a
  running session starting at the `ready` segment. The host is a participant
  like any other once they watch; hosting confers no special powers.
- **WatchSession is joining.** Subscribing to the stream *is* presence: the
  stream's acquisition adds the caller to `participants`, its finalization
  (client disconnect, navigation away, or session end) removes them. First
  element is the current snapshot, then every change — a resubscribe after
  any disconnect heals all drift by construction. **Multiplicity, pinned:**
  the handle keeps a subscription count per `userId`; `participants` lists
  each user once (deduped), a user leaves it only when their *last*
  subscription releases, `participantCount` counts distinct users, and the
  zero-subscriber GC watches raw subscription count. Two tabs = one
  participant.
- **Any participant may send any command** — parity with legacy, and the
  brief's "pause/skip/prev from either phone affects both". Commands apply
  the domain `timer.ts` transitions (`pause`/`resume`/`skip`/`prev`) at
  server `Clock` time. `quit` ends the session for everyone.
- **ListActiveSessions** returns every live session on the server — at
  friends/family scale, seeing each other's sessions is the point (it is
  session *content* that stays private until you join; the summary leaks
  only host display name, workout name, and the source `WorkoutId` — which
  is exactly the invitation. The id is an opaque handle, not access: every
  library rpc still gates on ownership, so a foreign id opens nothing).

## Server (`packages/server/src/session/`)

- **`live-sessions.ts`** — the `LiveSessions` `Effect.Service`. A
  `Ref<HashMap<SessionId, SessionHandle>>`; each handle owns a
  `SubscriptionRef<SessionState>`, the session's `Scope`, and a ticker
  fiber. All mutations (commands, ticker advances, presence changes) route
  through one serialized update function per session. The ticker is the
  domain driver contract: sleep until `nextTransitionAt(state.timer)`
  (Effect `Clock`, so TestClock drives it), then `advanceIfDue`, publish,
  repeat; it idles (no wakeups) while paused or done.
- **Lifecycle:** a session ends when (a) any participant sends `quit`, or
  (b) it has had **zero subscribers for 60 consecutive seconds** — the
  garbage collector for abandoned sessions (host's phone died mid-drive
  etc.). `done` alone does not end it (legacy parity: the Done screen shows
  until someone taps Finish, which sends `quit`). Ending closes the scope:
  the ticker dies, every subscriber stream completes, the handle leaves the
  map. Completion records are `session-history`'s concern — this feature
  persists nothing.
- **`handlers.ts`** — `SessionHandlersLive = SessionRpcs.toLayer(…)`, merged
  into `server.ts`'s `RpcHandlersAll`; `LiveSessions.Default` joins the rpc
  services bundle. `WatchSession` wires `subscriptionRef.changes` (with the
  acquire/release presence bookkeeping) straight into the streaming rpc.

## Client

- **Home (LibraryScreen):** an "Active sessions" strip above the library
  when `ListActiveSessions` is non-empty — one card per session ("Jackson ·
  Docklands · 2 joined", from `participantCount`), one tap navigates to the
  player. The atom refetches
  every 5 seconds while the screen is mounted; the join itself is the tap.
  That is the brief's one-tap join. A session's URL
  (`/session/<id>`) is shareable out-of-band (nothing extra to build —
  deep-linking through the login gate already works, per plan-library).
- **WorkoutDetailScreen:** gains the primary action — **Start session** →
  `StartSession` → navigate to `/session/<id>`.
- **`/session/$sessionId` (SessionScreen):** subscribes `WatchSession`.
  Renders from server state only: phase, exercise name + `detail`, next-up
  text, context line (Pod x/y · Lap k/n · Station s/m, derived from the
  current `WorkContext`), progress cells (one per work, grouped by pod/set
  size — legacy parity), participant names, and the countdown via the player
  kit's `useCountdown` against `endsAtMillis + (clientNow − serverNow)`
  offset. Controls: Pause/Resume, Prev, Skip; Done shows Finish (= `quit`).
  Beeps (from the kit's `audio.ts`, unlocked by the start/join tap — the
  legacy beeps are broken, see manual-timer's design for the fix) fire on
  interpolated segment transitions and 3-2-1; wake lock held while running.
  **Stream wiring, pinned:** not the AtomRpc `query` atom — for a streaming
  rpc that yields a pull-based, chunk-accumulating atom with nowhere to hang
  a retry. The session screen builds a latest-state atom over the rpc
  client's `Stream` directly (`runtime.atom` over
  `Stream.retry(watch, backoffSchedule)`), holding the most recent
  `SessionState`. **Failure semantics, pinned:** with `stream: true`, the
  declared error arrives as a *stream failure*, so the retry must
  discriminate by tag — `SessionNotFound` means the session ended while we
  were away: stop retrying, navigate home with a notice (same destination
  as clean stream completion). Every other failure is transport: show
  "reconnecting", retry with backoff, heal via the fresh snapshot.
  **The notice, pinned:** it travels as the `notice` search parameter of
  `/`, which that route validates and `HomeScreen` reads. A snapshot with
  `ended: 'plan-deleted'` sends `plan-deleted`, and so does a
  `SessionNotFound` that carries `endedAs: 'plan-deleted'` — the reconnect
  path, where the session is already gone. Every other ending sends
  `session-ended`. An unknown value is dropped rather than thrown, so a
  stale url still renders home.

## Testing

- **Unit/Integration (TestClock, in-memory sqlite):** ticker advances exactly
  at chained segment deadlines and catches up after a long adjust; pause
  freezes and resume re-anchors; commands from a second user apply; watch
  delivers snapshot-then-changes; a late subscriber gets the current state
  first; quit completes every subscriber stream and removes the session;
  zero-subscriber sessions end after 60s and vanish from
  `ListActiveSessions`; presence adds on subscribe / removes on unsubscribe;
  `StartSession` on a foreign workout id fails `WorkoutNotFound`; session
  rpcs without a session cookie fail `Unauthorized`.
- **e2e (chromium, two logged-in contexts; suite also runs webkit
  single-context flows):** A starts Athletica from its detail; B's home
  shows the session and one tap lands B in the same segment; B pauses → A
  shows Paused; A skips → both advance; A quits → B lands home. Web Audio
  and wake lock instrumented as in manual-timer's suite.

## Out of scope (later features)

Completion records and history (`session-history` — it will consume a
session-ended hook here; leave the seam obvious in `live-sessions.ts`);
launch-time reflow overlays (`flow-control`); QR codes for join (the URL is
shareable; QR is cosmetic until proven needed); spectator vs participant
distinction; kicking participants; multiple concurrent sessions per host
(unenforced either way — sessions are cheap and end themselves).

## Notes for the builder

- `TimerRunning.endsAtMillis` is **server** epoch millis. The client must
  apply the `serverNow` offset before feeding the countdown hook — never
  trust the phone's clock to agree with the VPS.
- Publish a state (with fresh `serverNow`) on every mutation *and* every
  ticker advance — but never on a wall-clock interval; subscribers
  interpolate between publishes.
- The presence acquire/release must be exception-safe: a subscriber whose
  socket dies mid-stream must still be removed (scope finalizer, not a
  happy-path cleanup).
- Watch out for command races: all state changes for one session go through
  the one serialized updater; commands read-modify-write inside it.
