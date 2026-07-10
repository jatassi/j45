# J45 — Architecture

J45 (formerly diet-f45) is a self-hosted, F45-style workout app: per-user workout
libraries, server-authoritative live sessions synced across phones in real time,
structural control over workout flow, and rule-based procedural workout
generation. It replaces a paid gym membership for its owner and is shared with an
invited circle of friends and family. The rewrite is also deliberately a maximal
Effect-TS project: Effect idioms are used everywhere they apply, as a learning
vehicle, on Effect v3 stable (see ADR-0001).

The brief is `docs/briefs/j45.md`; decisions there are settled. This document is
the system narrative every per-feature design session inherits.

This repository is fresh; the legacy app lives on in `~/Git/diet-f45` (and runs
on the VPS at `/opt/diet-f45`) until cutover. Seed content sources for later
features: `public/workouts.json` in the legacy repo, merged with
`overrides.json` on the VPS. Nothing in this repo depends on legacy code.

## Stack

- **Runtime & tooling:** Bun (VPS runtime, package manager, workspaces).
- **Language:** TypeScript, Effect v3 (`effect` 3.21.x line), all `@effect/*`
  packages pinned in lockstep at exact versions.
- **Server:** `@effect/platform-bun` (`BunHttpServer`) serving the built client
  and the rpc endpoint.
- **API:** one shared `@effect/rpc` `RpcGroup` over WebSocket
  (`RpcServer.layerProtocolWebsocket`, ndjson serialization). Typed unary calls
  and typed `Stream`s from the same contract. The protocol is a pluggable layer;
  falling back to HTTP/ndjson is a one-layer swap if WebSocket-through-Caddy
  ever misbehaves.
- **Persistence:** SQLite via `@effect/sql-sqlite-bun` (`SqliteClient.layer`),
  forward-only migrations via `@effect/sql` Migrator (TypeScript migration files
  in-repo, run at server startup). Tests provide `@effect/sql-sqlite-node`
  (in-memory) against the same `SqlClient` tag.
- **Client:** React + Vite, shadcn/ui (initialized from the owner's preset:
  `bunx --bun shadcn@latest init --preset b7BYO1Ags --template vite`), Effect
  state via `@effect-atom/atom-react` with `AtomRpc` deriving atoms from the
  shared `RpcGroup`. Routing via `@tanstack/react-router` (code-based route
  tree, introduced by plan-library); the auth screens are `AuthGate` states
  outside the router, and `/glass` stays a pre-gate pathname switch. The UI is **dark-only** (single palette, no theme
  switching). Liquid-glass visual layer per the brief (WebGL refraction over a
  static document-anchored backdrop, one shared GL context, rendered on layout
  change only — never per frame; CSS frost+rim fallback; must work on iOS
  Safari; see `docs/designs/liquid-glass-ui/design.md`).
- **Testing:** `@effect/vitest` running under Node vitest (not `bun test` — it
  is incompatible with @effect/vitest), `TestClock` for all timer logic;
  Playwright for the browser e2e suite.

## Monorepo layout

Bun workspaces, three packages:

```
packages/
  domain/   # shared: Effect Schema types, branded IDs, the RpcGroup contract,
            # tagged errors, pure domain logic (segment compiler, reflow,
            # generator rules). Zero platform deps: only `effect` + `@effect/rpc`.
  server/   # Bun: rpc handlers, services (Effect.Service), SqlClient + Migrator
            # layers, live-session engine, BunHttpServer wiring.
  client/   # Vite + React: AtomRpc client, atoms, shadcn UI, glass layer.
```

`domain` is imported by both sides as TypeScript source (workspace protocol,
`exports` pointing at `./src`); no build step for the shared package.

## Boundaries and cross-feature contracts

These contracts are the spine; per-feature designs quote and refine them but do
not contradict them.

- **All client↔server traffic is the one `RpcGroup`** defined in `domain`.
  No side-channel fetches. Every payload, success, and error shape is Effect
  Schema; parsing failures at the boundary are defects, not silent coercions.
  Two recorded exceptions: `GET /healthz` (ops surface for deploy hooks and
  uptime checks, not client traffic) and the `/auth/*` routes (cookie
  lifecycle — an rpc riding a WebSocket cannot set or clear cookies; bodies
  and responses are still Effect Schema).
- **The server is the clock of record.** Live-session state carries absolute
  server timestamps (`endsAt`, `serverNow`); clients interpolate with
  `requestAnimationFrame` for smooth countdowns but never advance state
  themselves. All server time flows through Effect `Clock` so TestClock can
  drive it.
- **Live sessions are in-memory actors:** a `LiveSessions` `Effect.Service`
  holding one handle per active session — a `SubscriptionRef<SessionState>`
  mutated only through serialized updates, plus a ticker fiber
  (`Effect.forkScoped`) owned by the session's `Scope`. Subscribers consume
  `subscriptionRef.changes`: current snapshot first, then every change — that
  stream is wired directly into a streaming rpc. Session end closes the scope,
  killing the fiber and completing subscriber streams. Sessions are not
  persisted mid-flight; a server restart drops live sessions (acceptable — a
  workout is minutes long) but never durable data.
- **Persistence goes through `SqlClient`** (the tag, never a concrete driver)
  so the node/bun layer swap works. Durable truth lives in SQLite; in-memory
  session state is derived and disposable.
- **Auth:** invite-gated registration (owner mints codes), passkey-first
  (WebAuthn via `@simplewebauthn`) with username+PIN fallback (ADR-0002).
  Long-lived httpOnly session cookies, set/cleared only by the plain-HTTP
  `/auth/*` routes. The cookie rides the `/rpc` WebSocket upgrade, whose
  headers `@effect/rpc` folds into every rpc request on that connection, so
  the `AuthMiddleware` rpc middleware re-validates the session per call and
  provides a `CurrentUser` service; handlers never parse credentials, and
  revocation takes effect mid-connection. Details:
  `docs/designs/auth-accounts/design.md`.
- **Durable user content has exactly one owner.** There is no shared or
  global content: seed workouts are copied into each account's library at
  registration (existing accounts were backfilled by migration), and copies
  evolve independently. Library rpcs are scoped to `CurrentUser`; a foreign
  id is indistinguishable from an absent one (`WorkoutNotFound`, never a
  leak). Cross-user experiences (joining a live session, later sharing)
  stream or copy content — they never grant access to another user's rows.
- **The client player kit is owned by `manual-timer` and reused by
  `live-session`.** `packages/client/src/player/` holds the shared
  primitives — beep audio, wake lock, the rAF countdown hook — with no
  imports from session code; the dependency points
  from live-session to the kit, never back. Beeps and wake lock are
  client-side concerns fired off interpolated segment transitions. Audio is
  a known hazard, not a port: the legacy app's beeps don't work in practice,
  so the kit unlocks its `AudioContext` synchronously inside the explicit
  tap that enters a player, re-resumes on visibility changes and before
  every beep, and surfaces its state in the UI and as a `data-audio`
  attribute (values exactly `"on"`/`"blocked"`) for e2e assertion.
- **Domain purity:** segment compilation, flow/reflow transforms, timer math,
  and generation rules are pure functions in `domain`, unit-tested exhaustively.
  Server features orchestrate them; they do not reimplement them.
- **Errors:** expected failures are `Schema.TaggedError` types in the rpc
  contract, rendered by the client from typed `Result` failures. Unexpected
  errors are defects: crash the fiber, log loudly, never swallow. No stringly
  error codes.

## Non-goals

- Public/open registration or any multi-tenancy beyond the invited circle.
- Offline/serverless operation (the old single-file player is retired).
- Per-exercise performance tracking (reps/weights).
- LLM-backed generation; any external SaaS/API dependency for core function.
- Exercise animations (dropped: no source cleared the quality/licensing bar
  free; Gymvisual ~$0.90/GIF is the recorded route if ever revived — see the
  `exercise-animations` proposed record).
- Native mobile apps. Phone browsers (esp. iOS Safari) are the client.

## Error posture

Fail loudly and early. Boundary data is schema-validated or rejected; internal
invariant breaks are defects that crash the affected fiber and surface in logs;
the client renders typed failures as human-readable states, never blank screens.
The live-session stream must degrade gracefully on disconnect: client shows
"reconnecting", `Stream.retry` with backoff, and a fresh snapshot heals all
drift on resubscribe.

## Validation procedure

These commands are the binding contract the `walking-skeleton` feature
establishes; every later feature inherits them.

- **Bring-up:** `bun install`, then `bun run dev` at the repo root — server on
  :3000, Vite client dev server on :5173 (proxies `/rpc` ws + `/healthz` to
  :3000).
- **Exercise:** `bun run check` (typecheck all packages), `bun run test`
  (vitest unit/integration suites), `bun run test:e2e` (Playwright, chromium +
  webkit, against a server it manages itself), `bun run deploy:sim` (local
  simulated deploy: push → hook → health check → rollback).
- **Teardown:** Ctrl-C the dev process; delete the local SQLite file to reset
  state (`rm -f data/j45.dev.sqlite`).

## Release runbook

Deploy target: the owner's VPS (`ssh vps`), behind existing Caddy at
`j45.atassi.org` (Cloudflare grey-cloud A record), Bun preinstalled. J45 runs
as a **systemd user service** (`systemctl --user`, lingering enabled) on
internal port **4517** with its SQLite file at `/opt/j45/data/j45.sqlite` —
after one-time bootstrap, no deploy step requires sudo. The `walking-skeleton`
feature builds this pipeline; `deploy/README.md` holds the bootstrap steps.

- **Ready checks:** `bun run check && bun run test && bun run test:e2e` green
  locally; working tree clean on the release branch.
- **Deploy:** `git push deploy main` (remote `deploy` = `vps:/opt/j45/repo.git`);
  the post-receive hook checks out to `/opt/j45/app`, runs
  `bun install --frozen-lockfile`, builds the client, writes
  `/opt/j45/release.env` (RELEASE_SHA, PORT, DB_PATH), restarts the `j45` user
  unit (migrations run at server startup), then polls the health endpoint and
  fails the push loudly if the served SHA ≠ pushed SHA. Target: under a minute
  end to end.
- **Health check:** `curl -fsS https://j45.atassi.org/healthz` returns 200 with
  the deployed git SHA.
- **Rollback:** `git push -f deploy <last-good-sha>:main` (hook redeploys that
  ref). Migrations are forward-only, so schema-breaking releases must ship the
  compatibility window in the migration itself.
- **Cutover (one-time, at parity):** point the old app's Caddy route at J45,
  verify seed workouts run timing-identical, stop and disable the old
  `diet-f45` service.

## Operations toolkit

All ops run against the VPS over `ssh vps`; J45 is the `j45` systemd user
service (lingering enabled).

- **Status:** `ssh vps systemctl --user status j45`
- **Logs:** `ssh vps journalctl --user -u j45 -n 200 -f`
- **Restart:** `ssh vps systemctl --user restart j45`
- **Health:** `curl -fsS https://j45.atassi.org/healthz` (200 + deployed git
  SHA)
- **Data:** SQLite at `/opt/j45/data/j45.sqlite`; inspect read-only via
  `ssh vps sqlite3 'file:/opt/j45/data/j45.sqlite?mode=ro' ...`
- **Release env:** `/opt/j45/release.env` (RELEASE_SHA, PORT=4517, DB_PATH)

Read-only inspection (status, logs, health, ro queries) is freely available;
anything that mutates the instance (restart, DB writes, env edits) is
human-gated.
