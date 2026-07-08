# J45 — Feature graph

Machine truth for the loop. The slicing and dependency order were approved at
intake; the owner performs detailed design on each feature (promoting it to
`designed` with acceptance criteria and a `docs/designs/<id>/design.md`) before
it may build.

## Feature graph

```yaml
design_version: 3
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
    status: designed
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
    status: designed
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
    status: proposed
    depends_on: [workout-domain, auth-accounts]
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
    status: designed
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
