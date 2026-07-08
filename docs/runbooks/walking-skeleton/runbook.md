# Runbook — walking-skeleton

Validated by the Validate agent against integration tree `6713d64` (merge of
`loop/walking-skeleton` + all six sub-branches, `bun.lock` regenerated at
each conflict). Bun 1.3.9, macOS (darwin).

## Bring-up

```sh
bun install
bun run dev
```

Observed: server bound `:3000`, Vite dev server bound `:5173`, both up
within ~6s.

## Exercise

1. **`GET http://localhost:3000/healthz`** (while `bun run dev` is up)
   → `200 OK`, `Content-Type: application/json`,
   body `{"sha":"dev","version":"0.0.0"}`. `sha` is the `RELEASE_SHA` Effect
   Config value (default `"dev"` outside a real deploy per
   `packages/server/src/config.ts`; the deploy hook/deploy:sim below prove it
   carries the real git SHA in a real deploy).
2. **`GET http://localhost:5173/`** → `200 OK`, `text/html`, the Vite/React
   client shell (`<div id="root">`).
3. **`bun run check`** → `@j45/domain`, `@j45/server`, `@j45/client` each
   exit 0 (tsc project references).
4. **`bun run test`** → `bunx vitest run`, 7 test files / 10 tests, all
   green, including:
   - `packages/server/test/sql.test.ts` — provides the in-memory
     `@effect/sql-sqlite-node` `SqlClient` layer, runs `MigratorLive`,
     asserts `sqlite_master` contains the `app_meta` table created by
     migration `0001_app_meta.ts`.
   - `packages/domain/test/rpc.test.ts` — `ServerInfo` schema round-trip.
   - `packages/client/test/dev-script.test.ts` — spawns `bun run dev` for
     real and asserts both `:5173` and `:3000/healthz` come up.
5. **`bunx playwright install chromium webkit`** then **`bun run test:e2e`**
   → builds the client, boots the real server on an ephemeral port with a
   temp SQLite DB (`e2e/support/global-setup.ts`), then both the
   **chromium** and **webkit** projects load the page and assert the
   `data-testid="server-info-sha"` cell (inside the shadcn/ui `Card` at
   `data-testid="server-info-card"`) equals the `RELEASE_SHA` the harness
   handed the server — proving the value round-tripped through the
   `ServerInfo` rpc rather than being hardcoded. `2 passed (3.5s)`, exit 0.
6. **`bun run deploy:sim`** → sanity-checks `deploy/config.sh`,
   `deploy/post-receive` (bun-on-PATH export), `deploy/j45.service`
   (`EnvironmentFile=/opt/j45/release.env`, port 4517); builds a temp bare
   repo + APP_DIR/DATA_DIR, installs the real unmodified `post-receive` hook
   with a sim config; pushes a new commit and asserts
   `http://127.0.0.1:<ephemeral>/healthz` serves that SHA (polls up to 15s);
   force-pushes the prior SHA and asserts `/healthz` reverts to it.
   `deploy:sim PASSED`, exit 0.
7. **`packages/domain/src/rpc.ts`** inspected directly: `ServerInfo` is
   defined exactly once there; `packages/server/src/rpcHandlers.ts` imports
   `{ J45Rpcs, ServerInfo }` from `@j45/domain`, and
   `packages/client/src/lib/rpc-client.ts` derives its `AtomRpc.Tag` client
   from the same `J45Rpcs` import — no second definition anywhere in the
   tree (`grep -rn "class ServerInfo" packages/` returns one hit).
8. **`deploy/README.md`** read end-to-end: DNS grey-cloud A record for
   `j45.atassi.org`, `/opt/j45` layout diagram, bare-repo + hook install,
   systemd **user** unit + `loginctl enable-linger`, Caddy site block
   (`reverse_proxy 127.0.0.1:4517`); a `## Bootstrap complete — everything
   below is sudo-free` marker separates the two sudo-requiring steps (`mkdir
   /opt/j45`, the Caddy edit/reload) from every step after.

## Expected observations

All of the above matched expectations exactly; no deviations.

## Teardown

```sh
# Ctrl-C the `bun run dev` process (here: killed the backgrounded process
# group directly since it was launched non-interactively)
pkill -f "bun run dev"; pkill -f vite; pkill -f "src/main.ts"
rm -rf packages/server/data data/j45.dev.sqlite  # reset local SQLite state
```

`bun run deploy:sim` is self-contained (temp dir + `trap cleanup EXIT`) and
requires no teardown of its own.
