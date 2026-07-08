# walking-skeleton — design

## What it is

The foundation slice of J45: a deployable hello-world proving every seam the
later features build on — monorepo, shared rpc contract over WebSocket, SQLite
with migrations, shadcn/ui client, both test harnesses, and the git-push deploy
pipeline. When this feature is done, `git push deploy main` puts a working
(if nearly empty) J45 on the VPS in under a minute, and every command in the
architecture's Validation runbook is real.

This repo (`~/Git/j45`, private GitHub `j45`) is fresh; the legacy app stays in
`~/Git/diet-f45` and keeps running on the VPS at `/opt/diet-f45` until cutover.
Nothing here may depend on legacy code.

## Shape

Bun workspaces, three packages (per `docs/architecture.md`):

```
package.json              # workspaces: ["packages/*"]; root scripts (contract below)
packages/
  domain/                 # effect + @effect/rpc ONLY. Schema types + the RpcGroup.
  server/                 # @effect/platform-bun server, rpc handlers, sql layers.
  client/                 # Vite + React + shadcn/ui + @effect-atom/atom-react.
deploy/                   # config.sh, post-receive hook, systemd unit, bootstrap README
scripts/deploy-sim.sh     # local simulated VPS deploy (acceptance-critical)
data/                     # local SQLite files (gitignored)
```

Version pins (current stable at design time — builder verifies lockstep
compatibility and pins EXACT versions; all @effect/* move together):
`effect` 3.21.4, `@effect/platform` 0.96.2, `@effect/platform-bun` 0.90.0,
`@effect/rpc` 0.75.1, `@effect/sql` 0.51.1, `@effect/sql-sqlite-bun` 0.52.0,
`@effect/sql-sqlite-node` 0.52.0 (dev), `@effect/vitest` 0.29.0 (dev),
`@effect-atom/atom` 0.5.3, `@effect-atom/atom-react` 0.5.0.

## The one rpc, end-to-end

`packages/domain/src/rpc.ts` defines the entire contract; server and client both
import it. Shape (illustrative — builder may adjust field details, not the
structure):

```ts
export class ServerInfo extends Schema.Class<ServerInfo>("ServerInfo")({
  sha: Schema.String,          // git SHA the server was deployed from
  version: Schema.String,      // package.json version
  serverTime: Schema.DateTimeUtc,
}) {}

export class J45Rpcs extends RpcGroup.make(
  Rpc.make("ServerInfo", { success: ServerInfo }),
) {}
```

- **Server** (`packages/server`): `BunHttpServer` on `PORT` (Effect Config,
  default 3000). Routes: `/rpc` — `RpcServer.layerProtocolWebsocket` with
  `RpcSerialization.layerNdjson`; `/healthz` — plain HTTP GET returning
  `{ sha, version }` with 200 (the recorded ops exception to the
  everything-through-rpc rule); static serving of `packages/client/dist` for
  everything else. `sha` comes from Effect Config `RELEASE_SHA` (default
  `"dev"`); in production the deploy hook provides it via systemd
  `EnvironmentFile`.
- **Client** (`packages/client`): scaffolded with the pinned preset —
  `bunx --bun shadcn@latest init --preset b7BYO1Ags --template vite` — then
  wired into the workspace. An `AtomRpc.Tag`-derived client from `J45Rpcs`
  (WebSocket protocol to `/rpc`); the landing page renders one shadcn/ui
  component (e.g. Card) showing `sha`/`version`/`serverTime` from
  `useAtomValue` — proving rpc → atom → React end-to-end. Vite dev server
  (5173) proxies `/rpc` (ws) and `/healthz` to the server (3000).

## SQLite + migrations

`packages/server/src/sql.ts`: `SqliteClient.layer({ filename: DB_PATH })`
(Config, default `data/j45.dev.sqlite`) + `@effect/sql` Migrator loading
TypeScript migrations from `packages/server/migrations/` at startup.
Migration 0001 creates a trivial `app_meta(key TEXT PRIMARY KEY, value TEXT)`
table — enough to prove the seam. Services depend on the `SqlClient.SqlClient`
tag only; tests provide `@effect/sql-sqlite-node` in-memory instead (bun:sqlite
cannot load under Node-run vitest).

## Test harnesses

- **Unit/integration:** `@effect/vitest` running under Node vitest (`bunx
  vitest run` — NOT `bun test`, which is incompatible). At minimum: a domain
  schema round-trip test, and a server test that provides the sqlite-node
  layer, runs the Migrator, and asserts `app_meta` exists.
- **e2e:** Playwright, two projects — chromium and **webkit** (iOS Safari is a
  first-class client; webkit-in-CI is the standing proxy). The suite builds the
  client, starts the real server (ephemeral port, temp DB), loads the page, and
  asserts the rpc-delivered SHA renders. Playwright's browsers install via
  `bunx playwright install chromium webkit` (documented in README).

## Deploy pipeline

Target (from the owner): ssh alias `vps`, domain `j45.atassi.org`
(Cloudflare **grey-cloud** A record — must be created at bootstrap), internal
port **4517**, Bun preinstalled. Legacy app runs at `/opt/diet-f45` under
system systemd requiring sudo — J45 explicitly avoids that: **systemd user
service** (`~/.config/systemd/user/j45.service` + `loginctl enable-linger`) so
no post-bootstrap step ever needs sudo.

VPS layout: `/opt/j45/repo.git` (bare), `/opt/j45/app` (checkout),
`/opt/j45/data/j45.sqlite`, `/opt/j45/release.env` (written by hook:
`RELEASE_SHA=<sha>`, `PORT=4517`, `DB_PATH=/opt/j45/data/j45.sqlite`).

Verified on the VPS (2026-07-07): key-based `ssh vps` works in batch mode;
bun lives at `/home/jatassi/.bun/bin/bun` but is NOT on the PATH in
non-interactive shells — the hook must `export PATH="$HOME/.bun/bin:$PATH"`
(or use the absolute path) or the first real push dies with "bun: not found".
Lingering is currently disabled (`Linger=no`); bootstrap must enable it.

`deploy/post-receive` (installed into the bare repo, sources
`deploy/config.sh` for paths/port/restart-cmd/health-url so the same script
runs in the local simulation):

1. checkout pushed ref into APP_DIR (`git --work-tree`)
2. `bun install --frozen-lockfile`
3. `bun run build` (client → dist; server runs TS directly under Bun)
4. write release.env with the new SHA
5. `$RESTART_CMD` (prod: `systemctl --user restart j45`)
6. poll `$HEALTH_URL` (prod: `http://127.0.0.1:4517/healthz`) up to ~20s;
   **fail the hook loudly if the SHA served ≠ SHA pushed**

Laptop side: `git remote add deploy vps:/opt/j45/repo.git`; deploy is
`git push deploy main`; rollback is `git push -f deploy <last-good-sha>:main`.
Migrations run at server startup (forward-only), so rollback across a
migration must be compatible — already recorded in the Release runbook.

**Local simulation (`scripts/deploy-sim.sh`, wired as `bun run deploy:sim`):**
creates a temp bare repo + temp APP_DIR/DATA_DIR, installs the same
post-receive hook with a sim config (RESTART_CMD starts/replaces a background
`bun` process on an ephemeral port), pushes HEAD, asserts healthz serves the
pushed SHA; then pushes `HEAD~1` (or a second synthetic commit) and asserts
rollback. Exits 0 only if both hold. This is how the deploy pipeline is
validated without the real VPS.

`deploy/README.md` — one-time bootstrap, copy-paste blocks: create the DNS A
record (grey cloud) for `j45.atassi.org`; `sudo mkdir -p /opt/j45 && sudo
chown $USER /opt/j45`; init bare repo + install hook; install the user unit +
`loginctl enable-linger $USER`; add the Caddy site block
(`j45.atassi.org { reverse_proxy 127.0.0.1:4517 }`) and reload Caddy. The sudo
lines above are the ONLY sudo, ever.

## Root script contract

These names are load-bearing (Validation runbook + acceptance):

- `bun run dev` — server (3000, watch) + Vite (5173) concurrently
- `bun run check` — typecheck all packages (tsc project references)
- `bun run test` — vitest run (all packages)
- `bun run test:e2e` — Playwright (chromium + webkit)
- `bun run build` — client production build
- `bun run deploy:sim` — local simulated deploy

## Out of scope (later features)

No auth, no real domain model beyond ServerInfo, no live sessions, no plan UI,
no glass (shadcn baseline styling only — glass is `liquid-glass-ui`). Extra is
a failure like missing.

## Notes for the builder

- Centralize Effect imports per ADR-0001 (v4 migration stays mechanical).
- Idiomatic patterns: follow the vendored `.claude/skills/effectts` references
  (Effect.Service, Schema.TaggedError, Layer composition, @effect/vitest usage).
- `domain` exports TS source directly (`"exports": { ".": "./src/index.ts" }`);
  Bun and Vite both consume it — no build step for the shared package.
- Pin exact versions; a mismatch between @effect/* packages causes tag-identity
  bugs ("two versions of effect").
