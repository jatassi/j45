# J45

Self-hosted, F45-style workout app. See `docs/briefs/j45.md` and
`docs/architecture.md` for the full narrative; `docs/designs/` holds
per-feature design docs.

## Monorepo layout

Bun workspaces, three packages under `packages/`:

- `domain` — shared Effect Schema types and the `@effect/rpc` `RpcGroup`
  contract (`J45Rpcs`). Zero platform deps: only `effect` + `@effect/rpc`.
  Exported as TypeScript source directly (no build step).
- `server` — `@effect/platform-bun` server: rpc handlers, SQL layers.
- `client` — Vite + React + shadcn/ui client.

## Getting started

```sh
bun install
bun run check      # typecheck every workspace package
bun run test       # vitest (Node, via `bunx vitest run` — not `bun test`)
bunx playwright install chromium webkit   # one-time browser install for e2e
bun run test:e2e   # Playwright — chromium + webkit
```

Local SQLite files live under `data/` (gitignored); delete
`data/j45.dev.sqlite` to reset local state.

## End-to-end tests

`bun run test:e2e` runs the Playwright suite under `e2e/` against the real
stack — it builds the client, boots the real server (`packages/server/src/main.ts`)
on an ephemeral port with a temp SQLite DB, and asserts the page renders the
rpc-delivered server SHA. Two projects run every spec: **chromium** and
**webkit** (the standing CI proxy for iOS Safari, a first-class J45 client).

Playwright's browser binaries aren't installed by `bun install` — run this
once per machine (or whenever Playwright's version bumps):

```sh
bunx playwright install chromium webkit
```
