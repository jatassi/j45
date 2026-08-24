# Domain Docs

How the engineering skills should consume this repo's domain documentation when
exploring the codebase.

## Before exploring, read these

- **`docs/glossary.md`** — this repo's ubiquitous language. It plays the role the
  skills' templates call `CONTEXT.md`; there is deliberately no root
  `CONTEXT.md`, so don't create one.
- **`docs/adr/`** — read ADRs that touch the area you're about to work in.

This is a single-context repo. The `packages/*` workspaces (`domain`, `server`,
`client`) are layers of one application sharing one glossary, not separate
bounded contexts — there are no per-package `CONTEXT.md` files or per-package
ADR directories.

If a doc doesn't exist, **proceed silently**. Don't flag its absence; don't
suggest creating it upfront. The `/domain-modeling` skill creates entries lazily
when terms or decisions actually get resolved.

## File structure

```
/
├── docs/
│   ├── glossary.md        ← the ubiquitous language (the CONTEXT.md role)
│   └── adr/
│       ├── 0001-effect-v3-not-v4.md
│       └── 0002-invite-gated-passkey-auth.md
└── packages/
    ├── domain/src/
    ├── server/src/
    └── client/src/
```

New ADRs follow the existing `NNNN-kebab-slug.md` numbering.

## Use the glossary's vocabulary

When your output names a domain concept (an issue title, a refactor proposal, a
hypothesis, a test name), use the term as defined in `docs/glossary.md`. Don't
drift to synonyms the glossary explicitly avoids — it pins several deliberately
(a **Station** is free text inside a workout; an **Exercise** is a catalog
entry; they are not the same thing).

If the concept you need isn't in the glossary yet, that's a signal — either
you're inventing language the project doesn't use (reconsider) or there's a real
gap (note it for `/domain-modeling`).

## Flag ADR conflicts

If your output contradicts an existing ADR, surface it explicitly rather than
silently overriding:

> _Contradicts ADR-0001 (Effect v3, not v4) — but worth reopening because…_

## Note: the-loop owns `docs/`

This project also runs the-loop, which owns `docs/feature-graph.json`,
`docs/briefs/`, `docs/designs/`, `docs/releases/`, and `docs/validation/`. Read
them freely for context; don't rewrite them as a side effect of another skill's
work.
