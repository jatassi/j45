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

**TypeScript 7** (native compiler) — plain `tsc` everywhere.

Linting is **oxlint**, not ESLint. Rules live in `.oxlintrc.json`;
import sorting is a Prettier plugin (`bun run format`).

## Subagents

When spawning subagents, always include the model name in brackets at the beginning
of the agent title like this: `[Opus] Do the thing`.

## Agent skills

### Issue tracker

GitHub Issues on `jatassi/j45`, via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

The five canonical roles, used verbatim as label strings. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context — `docs/glossary.md` + `docs/adr/`. See `docs/agents/domain.md`.
