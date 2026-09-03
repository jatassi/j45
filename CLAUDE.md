# j45

An F45-like workout app written in Effect.

Bun workspace monorepo (`packages/domain`, `packages/server`, `packages/client`).

## Commands

```sh
bun run check    # typecheck — tsc across all packages
bun run build    # build the client (tsc -b + vite)
bun run lint     # oxlint --type-aware
bun run format   # prettier (also sorts imports)
bun run test     # vitest - run full suite sparingly
```

## Toolchain

**TypeScript 7** (native compiler) — plain `tsc` everywhere.

Linting is **oxlint**, not ESLint. Rules live in `.oxlintrc.json`;
import sorting is a Prettier plugin (`bun run format`).

## Writing guidelines

### Style

Writing should adapt principles defined in **ASD-STE100** Simplified Technical English. Apply this style to:
- Claude's responses to the user
- Documentation
- Code comments
- Specs, issues, comments, reports

## Git hygiene

The goal is to keep the primary checkout on `main` branch when possible, and to keep `main` clean. Use worktrees to avoid dirtying primary checkout, then merge to main when ready. Always clean up worktrees after work is complete. Prefer harness-provided worktree tools over ad-hoc worktree management methods. Push frequently.


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
