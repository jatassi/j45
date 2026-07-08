# J45 — Feature graph

Machine truth for the loop. The slicing and dependency order were approved at
intake; the owner performs detailed design on each feature (promoting it to
`designed` with acceptance criteria and a `docs/designs/<id>/design.md`) before
it may build.

## Feature graph

```yaml
design_version: 5
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
    status: designed
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
    status: proposed
    depends_on: [plan-library]
  - id: plan-editing
    title: Plan editing at parity — exercises, day structure, pods, work/rest
    status: proposed
    depends_on: [plan-library]
  - id: flow-control
    title: Structural reflow (sets↔laps, pod regrouping) at edit-time and launch-time
    status: proposed
    depends_on: [live-session, plan-editing]
  - id: session-history
    title: Per-participant completion log and history view
    status: proposed
    depends_on: [live-session]
  - id: exercise-library
    title: First-class tagged exercise library seeded from program content
    status: proposed
    depends_on: [plan-library]
  - id: workout-generation
    title: Rule-based workout generator — templates + constraints incl. no-repeat-recently
    status: proposed
    depends_on: [session-history, exercise-library]
  - id: manual-timer
    title: Quick ad-hoc countdown timer on the domain timer machinery
    status: proposed
    depends_on: [workout-domain]
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
