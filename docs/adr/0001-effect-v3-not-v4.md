# ADR-0001 — Build on Effect v3 stable, not the v4 beta

**Status:** accepted (2026-07-07)

## Context

The J45 rewrite is explicitly a "maximal Effect" project and the brief accepts
bleeding-edge pain. Effect v4 (beta since ~Feb 2026) rewrites the runtime (~3x
faster, much smaller bundles) and consolidates `@effect/platform`, `@effect/rpc`,
`@effect/sql`, and `@effect/cluster` into `effect/unstable/*` modules. The core
team's own guidance at decision time: v3 for production; v4 beta may break
between releases. J45 is a daily driver replacing a paid gym membership.

## Decision

Build on Effect v3 stable (`effect` 3.21.x line) with the standalone `@effect/*`
packages, all pinned in lockstep. Centralize Effect imports (barrel/util modules
rather than deep imports scattered everywhere) so the v4 move — largely package
renames into `effect/unstable/*` — stays a mechanical migration.

## Trade-off

We accept: learning some APIs that will be renamed, and forgoing v4's
performance gains for now. We get: a daily-driver app that doesn't break on a
beta bump, agent/skill/documentation coverage that overwhelmingly targets v3,
and a planned, mechanical upgrade path instead of a forced one. "Bleeding-edge
pain accepted" is spent on pre-1.0 packages (rpc, atom) — not on a beta runtime
under a daily-use app.
