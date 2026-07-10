# J45 — Feature graph

Machine truth for the loop. The slicing and dependency order were approved at
intake; the owner performs detailed design on each feature (promoting it to
`designed` with acceptance criteria and a `docs/designs/<id>/design.md`) before
it may build.

## Feature graph

```yaml
design_version: 7
features:
  - id: walking-skeleton
    title: Monorepo + Effect v3 skeleton with one rpc end-to-end, SQLite, shadcn, test harnesses, and git-push deploy
    status: validated
    depends_on: []
    acceptance:
      - Given a fresh clone on a machine with Bun installed, `bun install`, `bun run check`, and `bun run test` all exit 0.
      - Given `bun run dev`, GET http://localhost:3000/healthz returns 200 with JSON containing the git SHA, and GET http://localhost:5173/ returns the client page.
      - The ServerInfo rpc contract is defined exactly once, in packages/domain, and both the server handler and the client atom import it from there.
      - A vitest test provides the in-memory sqlite-node SqlClient layer, runs the Migrator, and asserts the 0001 migration's app_meta table exists; it passes as part of `bun run test`.
      - "`bun run test:e2e` exits 0 with both chromium and webkit Playwright projects asserting the page renders the rpc-delivered server SHA inside a shadcn/ui component."
      - Given `bun run deploy:sim`, when HEAD is pushed to the simulated bare repo, /healthz on the simulated deployment returns 200 with the pushed SHA; when the prior SHA is then force-pushed, /healthz returns that prior SHA; the script exits 0 only if both hold.
      - deploy/README.md documents the one-time VPS bootstrap (j45.atassi.org grey-cloud DNS record, Caddy site block, /opt/j45 layout, bare repo + hook install, systemd user unit with linger) and no step after bootstrap requires sudo.
  - id: workout-domain
    title: Shared-schema workout domain model, segment compiler, and timer math (pure, TestClock-tested)
    status: validated
    depends_on: [walking-skeleton]
    acceptance:
      - Given the four vendored legacy fixtures (Athletica, Docklands, Medusa, Apex), when each is compiled, the segment sequence matches its golden expectation exactly — segment types, per-segment durations, and work ordering (pod-major for laps, station-major for sets), with one leading 5s ready segment, no rest after the final work, and total durations 1605s, 1710s, 2180s, and 2135s respectively — asserted by vitest tests that pass in `bun run test`.
      - Given a flow whose rounds include ladder (non-uniform) rests, when compiled, every rest segment's duration equals the completed work's round rest — asserted explicitly for the lap→lap and pod→pod bridges on Docklands and the set→next-station bridge on Medusa.
      - Given a flow containing a round with restSeconds 0, when compiled, no rest segment appears after that round's works (adjacent work segments).
      - Every model type (Workout, Pod, Station, Flow, Round, Segment union, CompiledWorkout, TimerState union) round-trips through Schema encode/decode, and decoding rejects empty pods, empty stations, empty rounds, workSeconds <= 0, and restSeconds < 0.
      - "Timer transitions verified under TestClock in `bun run test`: advanceIfDue crosses segment boundaries exactly at their chained deadlines (including multi-segment catch-up after a long adjust); pause freezes remainingMillis across TestClock.adjust; resume re-anchors endsAt; skip and prev enter the target segment at full duration; prev on segment 0 is a no-op; prev from done enters the last segment; skip on the last segment yields done."
      - packages/domain/package.json dependencies remain exactly effect and @effect/rpc, the existing ServerInfo rpc contract is unchanged, and `bun run check` and `bun run test` exit 0 at the repo root.
  - id: auth-accounts
    title: Invite-gated accounts — passkey-first with username+PIN fallback, long-lived sessions
    status: validated
    depends_on: [walking-skeleton]
    acceptance:
      - Given a fresh database with FIRST_RUN_INVITE unset, server startup logs a single-use first-run invite code; given FIRST_RUN_INVITE set, that exact code is redeemable; either way the first account registered gets role owner and later accounts get role member (integration-tested).
      - "e2e (chromium + webkit): opening /register?invite=<valid code> and submitting username, display name, and PIN lands the visitor authenticated with their display name visible; a page reload stays authenticated; logout returns to the login screen and a reload stays logged out; context.cookies() shows the j45_session cookie with httpOnly true and sameSite Lax."
      - "e2e: redeeming a spent or unknown invite code shows a typed error and creates no account — registering twice with the same code fails the second time."
      - "e2e (chromium, CDP virtual authenticator): an authenticated user enrolls a passkey; after logout, the sign-in-with-passkey button alone — no username or PIN typed — authenticates them."
      - "e2e (chromium + webkit): PIN login succeeds with the correct PIN and shows an InvalidCredentials error with a wrong one. Unit (TestClock): 5 consecutive PIN failures for a username make PIN login fail with RateLimited (even with the correct PIN) until the 15-minute window elapses."
      - "Integration: an rpc guarded by AuthMiddleware fails with Unauthorized when the request headers carry no valid session cookie, and succeeds with CurrentUser provided when they do — the Me rpc returns the logged-in user over the WebSocket."
      - "e2e: the owner mints an invite in the UI and a second browser context registers with it; a member account calling an owner-only rpc gets Forbidden and sees no admin UI."
      - "e2e or integration: the owner issues a reset code for a member; redeeming it with a new PIN signs the member in, the old PIN no longer works, and the member's prior session is revoked — its next authenticated call fails Unauthorized."
      - "Unit: users.pin_hash stores a Bun.password hash (never the PIN) and auth_sessions stores only a SHA-256 token hash that differs from the cookie value."
  - id: plan-library
    title: Per-user workout libraries with the 3-week program migrated in as seed plans
    status: validated
    depends_on: [workout-domain, auth-accounts]
    acceptance:
      - "Integration: given a fresh database, registering an account creates exactly 12 workouts in that account's library — named exactly Athletica, Romans, Miami Nights, Panthers, Docklands, Red Diamond, Crossfire, Hammer, Pipeline, Medusa, SoCal, Apex — in the same transaction as the user row (a failed registration creates neither); a second account gets its own 12 copies with distinct ids, and deleting a workout from one library leaves the other untouched."
      - "Unit: each of the 12 frozen seed bodies decodes as a valid Workout, and compiling them yields (works, total seconds) of exactly Athletica (27,1605), Romans (24,2120), Miami Nights (24,1425), Panthers (27,1470), Docklands (36,1710), Red Diamond (36,2135), Crossfire (40,2235), Hammer (18,1110), Pipeline (36,2145), Medusa (27,2180), SoCal (36,2155), Apex (8,2135)."
      - "Integration: given a database migrated through 0002 with an existing user, when migration 0003 runs, that user's library contains the 12 seed workouts."
      - "Integration: ListWorkouts returns only the caller's workouts, and GetWorkout/DuplicateWorkout/RenameWorkout/DeleteWorkout against another user's workout id fail with WorkoutNotFound."
      - "e2e (chromium + webkit): after PIN login, `/` lists the 12 seed workouts; opening `Athletica` shows 3 pods, 9 stations, and total duration 26:45; Duplicate creates `Athletica (copy)` in the list; renaming the copy persists across a page reload; Delete removes it."
      - "e2e: a logged-out visit to `/workouts/<seed id>` shows the login screen, and completing PIN login renders that workout's detail without further navigation; `/account` renders the account screen via a nav link from the library home."
      - "e2e: completing registration via `/register?invite=<code>` lands the new user on the library home — never a blank page — and any authenticated visit to a path the route tree doesn't match redirects to `/`."
      - "The glass e2e suite passes unchanged (`/glass` still renders unauthenticated); the pre-existing auth e2e suites pass with edits limited to navigation for the routed home (AccountScreen assertions via `/account`, post-auth landing is the library) — no auth assertion weakened or removed; and `bun run check`, `bun run test`, and `bun run test:e2e` all exit 0."
  - id: live-session
    title: Server-authoritative live sessions — streaming sync, multi-phone controls, beeps/wake-lock, one-tap join
    status: validated
    depends_on: [plan-library, manual-timer]
    acceptance:
      - "Integration (TestClock): a session created from a library workout starts at the ready segment and its ticker advances exactly at chained segment deadlines, catching up across multiple boundaries after a long TestClock.adjust; pause freezes remaining time, resume re-anchors, skip/prev enter the target segment at full duration — all driven through SendSessionCommand-shaped service calls, including commands issued by a non-host participant."
      - "Integration: WatchSession delivers the current snapshot first, then every change — a subscriber joining after several transitions receives the current state as its first element; every published state carries serverNow and an absolute-epoch TimerRunning.endsAtMillis."
      - "Integration: subscribing adds the caller (userId + displayName) to participants and unsubscribing removes them; quit completes every subscriber's stream and removes the session; a session with zero subscribers for 60 consecutive seconds (TestClock) ends and disappears from ListActiveSessions."
      - "Integration: StartSession with another user's (or an unknown) workout id fails WorkoutNotFound; WatchSession and SendSessionCommand on an unknown session id fail SessionNotFound; every SessionRpcs member without a valid session cookie fails Unauthorized."
      - "e2e (chromium, two logged-in contexts): user A starts a session from a workout detail screen and lands on /session/<id>; within 10 seconds user B's home shows an active-session card naming A and the workout, and one tap lands B on the same session showing the same segment; B pausing shows Paused on A's screen; A skipping advances both to the next segment; A quitting returns B to the home screen."
      - "e2e: with Web Audio instrumented via init script, the join/start tap unlocks audio (data-audio=\"on\") and a segment transition fires at least one beep; with navigator.wakeLock instrumented, the lock is requested while running and released when paused."
      - "Integration: updating or deleting the source workout while a session runs on it leaves the running session's compiled segments unchanged (the session serves its own copy)."
      - "Sessions are in-memory only: no migration is added, and restarting the server (integration: rebuilding the layer) yields an empty ListActiveSessions while durable data is untouched."
      - "`bun run check`, `bun run test`, and `bun run test:e2e` all exit 0."
  - id: plan-editing
    title: Plan editing at parity — exercises, day structure, pods, work/rest
    status: validated
    depends_on: [plan-library]
    acceptance:
      - "Integration: CreateWorkout inserts a caller-owned row returned as a LibraryWorkout with fresh id and equal created/updated timestamps; UpdateWorkout replaces the whole body, bumps updated_at, preserves id and created_at; both against a foreign or absent id fail WorkoutNotFound; ListWorkouts reflects the edit."
      - "e2e (chromium + webkit): from the library home, New workout → editor: set name and focus, add a pod with two stations, set flow to sets with 3 uniform rounds of 30″ work / 10″ rest, Save → the detail screen shows the created workout and it appears in the library after a reload."
      - "e2e: editing a seed copy — switch flow laps→sets, rename a station, move a station down — then Save; the detail screen reflects all three changes after a page reload."
      - "e2e: the editor's live summary chip for an unmodified Athletica draft reads exactly 27 works · 26:45; with a station name cleared, Save is disabled and a validation message is visible."
      - "Unit: the uniform work/rest toggle expands one pair to N rounds and collapses N rounds to round 1's pair; a draft with an empty pod, empty station name, workSeconds 0, or negative restSeconds fails Workout decode and the editor surfaces the failure."
      - "`bun run check`, `bun run test`, and `bun run test:e2e` all exit 0."
  - id: flow-control
    title: Structural reflow (sets↔laps, pod regrouping) at edit-time and launch-time
    status: validated
    depends_on: [live-session, plan-editing]
    acceptance:
      - "Unit: applyReflow on the canonical example — a sets workout whose flattened stations include push-up, sit-up, and squat, regrouped into one 3-station pod run as laps with rounds carried over — matches an exact golden compiled segment sequence (stations interleaved within each lap), and the result keeps the source's name, focus, and note."
      - "Unit: applyReflow supports reordering stations across pods and dropping them (an unreferenced source station appears nowhere in the result); a rounds override replaces flow.rounds while an absent override carries the source rounds unchanged; an out-of-range or duplicated station index fails ReflowInvalid — never a crash or a silent fix-up."
      - "Integration: StartSession with a reflow spec starts a session whose SessionState.compiled equals compile(applyReflow(source, spec)) while the stored library workout row is unchanged; an ill-fitting spec fails ReflowInvalid; a foreign or unknown workout id still fails WorkoutNotFound."
      - "e2e (chromium + webkit): from a workout detail screen, Start with reflow opens the editor's launch mode; regrouping stations into one pod and flipping sets→laps updates the live works · MM:SS chip; Start lands on /session/<id> running the reflowed structure, and the library workout is unchanged after a page reload."
      - "e2e: the same launch-mode changes applied via Save to plan persist — the detail screen shows the new grouping after a page reload."
      - "e2e: launch mode offers no content edits (station names read-only, no add-station control); the normal editor's new cross-pod move relocates a station to another pod and the change persists after save and reload."
      - "`bun run check`, `bun run test`, and `bun run test:e2e` all exit 0."
  - id: session-history
    title: Per-participant completion log and history view
    status: designed
    depends_on: [live-session, flow-control]
    acceptance:
      - "Integration (TestClock): a session that progressed past the ready segment and is then quit writes one completion record per ever-participant — the host and a second user who watched then unsubscribed mid-session each see, via ListHistory, a record carrying the workout name, the as-run Workout snapshot, the host, both participants, startedAt, and endedAt."
      - "Integration (TestClock): a session quit while still in the ready segment writes no records for anyone; a session that progressed and is then GC'd after 60 idle seconds writes them."
      - "Integration: a session started with a reflow spec records the reflowed Workout as its snapshot — the spec's grouping, not the stored plan's."
      - "Integration: ListHistory returns only the caller's records, newest-first by endedAt, and fails Unauthorized without a valid session cookie; rebuilding the server layer (a restart) preserves completion rows while ListActiveSessions is empty."
      - "Integration: given a database migrated through 0004 with an existing user, migration 0005 creates session_completions and that user's ListHistory returns an empty list."
      - "e2e (chromium + webkit): two logged-in contexts run a short session (the host quits after the first work segment); /history, reached via a home nav link, shows the workout name, date, host display name, and both participant names — for both users."
      - "`bun run check`, `bun run test`, and `bun run test:e2e` all exit 0."
  - id: exercise-library
    title: First-class tagged exercise library seeded from program content
    status: validated
    depends_on: [plan-library]
    acceptance:
      - "Unit: every entry in seed-exercises.ts decodes as a valid Exercise; names are unique case-insensitively; the catalog has at least 80 entries; every MuscleGroup and every Equipment literal is used by at least one entry; entries named Rower (modality cardio, equipment includes rower), Barbell front squat (modality strength, equipment includes barbell), and Burpee (empty equipment) exist."
      - "Integration: registering an account creates the user row, the 12 seed workouts, and the full seed exercise catalog in one transaction (a failed registration creates none); a second account gets its own catalog with distinct ids; deleting an exercise from one account leaves the other untouched."
      - "Integration: given a database migrated through 0003 with an existing user, migration 0004 backfills that user's exercise catalog."
      - "Integration: ListExercises returns only the caller's exercises sorted case-insensitively by name; UpdateExercise and DeleteExercise against another user's (or an unknown) exercise id fail ExerciseNotFound."
      - "e2e (chromium + webkit): /exercises via a home nav link lists the seeded catalog; selecting a muscle-group filter chip narrows the list; creating an exercise shows it in the list and it persists across a reload; editing its tags persists across a reload; Delete removes it."
      - "`bun run check`, `bun run test`, and `bun run test:e2e` all exit 0."
  - id: workout-generation
    title: Rule-based workout generator — templates + constraints incl. no-repeat-recently
    status: designed
    depends_on: [session-history, exercise-library]
    acceptance:
      - "Unit: generate is deterministic — identical catalog, recent names, constraints, and seed yield an identical Workout — and its result always decodes as a valid Workout and compiles."
      - "Unit: every station in a generated workout names a catalog exercise whose equipment is a subset of the allowed set and whose modality matches the focus (cardio→cardio, strength→strength, hybrid→either); with an emphasis set, every strength-modality pick includes that muscle group; a name on the recent list is never picked (case-insensitive)."
      - "Unit: for every target from 15 to 45 minutes in 5-minute steps, with the full seed catalog and no exclusions, the generated workout's compiled total duration is within 10% of the target."
      - "Unit: an equipment filter that empties the pool, a recent list that starves it below the template's station count, and a duration no template fits each fail GenerationInfeasible with a reason naming the constraint — never a crash."
      - "Integration: GenerateWorkout assembles only the caller's catalog and their newest noRepeatSessions completion snapshots — an exercise named in the caller's recent history is absent from the result, an identical history on another account has no effect, and noRepeatSessions 0 disables exclusion; ListWorkouts is identical before and after (nothing persisted)."
      - "e2e (chromium + webkit): /generate via a home nav link: choosing focus, duration, equipment, and emphasis then Generate shows a preview with the workout codename and a works · MM:SS chip; Regenerate changes the preview's data-seed; Save lands the workout in the library and it survives a reload; Edit opens it in the workout editor."
      - "`bun run check`, `bun run test`, and `bun run test:e2e` all exit 0."
  - id: manual-timer
    title: Quick ad-hoc countdown timer on the domain timer machinery
    status: validated
    depends_on: [workout-domain]
    acceptance:
      - "Unit: the synthetic manual workout for work 40 / rest 20 / rounds 9 is schema-valid and compiles to one 5s ready segment, 9 work segments of 40s with 20s rests between consecutive rounds, no rest after the final work, total 525s; with rest 0 no rest segments appear at all."
      - "e2e (chromium + webkit): /timer is reachable via a nav link from the library home while logged in; with short inputs (5s work, 0 rest, 2 rounds) Start runs ready → work → work → Done with the round indicator advancing; Pause freezes the displayed count, Resume continues, Reset returns to the idle input state."
      - "e2e: with Web Audio instrumented via init script, the Start tap itself unlocks audio (the player shows data-audio=\"on\") and at least one beep fires on a segment transition; with navigator.wakeLock instrumented, the lock is acquired while running and released on pause and on Done."
      - "The player kit exists as packages/client/src/player/ modules (audio, wake-lock, use-countdown) with no imports from session code, and its audio/countdown units are covered by vitest tests that pass in `bun run test`."
      - "The timer runs entirely client-side: no new rpc, migration, or server route is added by this feature."
      - "`bun run check`, `bun run test`, and `bun run test:e2e` all exit 0."
  - id: liquid-glass-ui
    title: Liquid-glass visual layer — WebGL refraction port over shadcn, iOS-Safari-proof, CSS fallback
    status: validated
    depends_on: [walking-skeleton]
    acceptance:
      - Given `bun run dev`, when GET /glass loads in the chromium and webkit e2e projects, the demo page renders at least three glass surfaces and each reaches `data-glass-tier="refract"` within 5 seconds.
      - Given a surface with refraction active whose demo text mutates every 250ms, when the e2e test observes it for 2 seconds with no layout change, its `data-glass-renders` count does not increase; when the viewport is then resized, the count increases.
      - Given an e2e init script that makes `getContext("webgl2")` return null, when /glass loads, every surface reports `data-glass-tier="css"`, has a computed backdrop-filter containing blur, contains no refraction canvas, and the page logs no console errors.
      - Given /glass with all demo surfaces active, an e2e instrument wrapping `HTMLCanvasElement.prototype.getContext` counts exactly one "webgl2" context acquisition for the whole page.
      - The client is dark-only — the dark palette is `:root` in packages/client/src/index.css, theme-provider.tsx is deleted, and no light token block remains; the walking-skeleton e2e suite still passes unchanged.
      - Vitest unit tests cover the backdrop slice mapping (card rect ⨯ scroll ⨯ dpr → texture offset/scale) and geometry-key stability, passing as part of `bun run test`.
      - "`bun run check`, `bun run test`, and `bun run test:e2e` all exit 0."
  - id: exercise-animations
    title: Per-exercise animations during workouts (dropped at intake — revive via licensed source, e.g. Gymvisual ~$0.90/GIF)
    status: proposed
  - id: public-multi-tenancy
    title: Multi-tenancy beyond the invited circle (open registration)
    status: proposed
  - id: llm-generation
    title: LLM-assisted workout generation/library enrichment
    status: proposed
  - id: per-exercise-tracking
    title: Per-exercise performance tracking (reps/weights)
    status: proposed
```
