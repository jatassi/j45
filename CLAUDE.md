# j45

An F45-like workout app written in Effect.

Bun workspace monorepo (`packages/domain`, `packages/server`, `packages/client`).

## Commands

```sh
bun run check    # typecheck — tsc across all packages
bun run build    # build the client (tsc -b + vite)
bun run lint     # oxlint --type-aware
bun run format   # prettier (also sorts imports)
bun run test     # vitest
```

## Toolchain

On **TypeScript 7** (the native compiler) — plain `tsc` everywhere.

Linting is **oxlint**, not ESLint. Rules live in `.oxlintrc.json`;
import sorting is a Prettier plugin (`bun run format`).
