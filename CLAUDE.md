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

Avoid **mannered prose**:

Mannered prose substitutes metaphor and flourish for direct statement. Instead of "a parameter worth varying," the mannered writer produces "a dial worth turning." Instead of "this point still matters," they write "this point earns its keep." The phrases exist to display the writer, not to convey the idea, and readers can tell. That is why mannered prose irritates: it makes the reader work harder so the writer can perform. It is also imprecise. Metaphors drag in connotations the writer did not choose and cannot control. The fix is to say what you mean. When a literal phrase is available, use it.

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
