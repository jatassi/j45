# workout-domain — validation runbook

Pure-domain feature (`packages/domain` only: workout model, segment compiler,
timer state machine). All acceptance criteria are exercised by the typecheck
and vitest suites; the dev bring-up is exercised to confirm the walking-skeleton
binding still holds around the new exports.

## Bring-up

```sh
bun install
bun run dev        # server on :3000, Vite client dev server on :5173
```

Observed: `curl http://localhost:3000/healthz` → 200, `curl
http://localhost:5173/` → 200.

## Exercise

```sh
bun run check      # tsc --noEmit in domain, server, client — all exit 0
bun run test       # vitest: 10 files, 34 tests, all pass
bun run test:e2e   # Playwright chromium + webkit — 2 passed
bun run lint       # oxlint (type-aware) — clean
bun run format:check
```

Expected observations, per criterion:

1. **Golden fixtures** — `packages/domain/test/segments.test.ts` asserts the
   full segment sequence (type, per-segment duration, work ordering,
   `workIndex`, station identity) for Athletica / Docklands / Medusa / Apex
   against hand-derived goldens in `test/fixtures/legacy-goldens.ts`; one
   leading 5s ready segment, no rest after the final work; totals asserted at
   1605s / 1710s / 2180s / 2135s.
2. **Ladder bridge rests** — explicit tests: Docklands lap1→lap2 bridge = 30s
   (lap 1's rest, not lap 2's 15s), Docklands pod1→pod2 bridge = 5s (lap 4's
   rest, not 30s), Medusa station1→station2 bridge = 30s (set 3's rest, not
   15s).
3. **Zero rest** — a `restSeconds: 0` round compiles to adjacent work
   segments (`['ready','work','work','work','rest','work']`).
4. **Schema round-trips** — Round, Station, Pod, Flow, FlowType, Focus,
   Workout, Segment (all three variants), CompiledWorkout, and all four
   TimerState variants round-trip encode/decode; decoding rejects empty
   pods, empty stations, empty rounds, `workSeconds <= 0`, `restSeconds < 0`.
5. **Timer under TestClock** — boundary-exact advancement at chained
   deadlines, multi-segment catch-up after a 25s adjust (three boundaries in
   one `advanceIfDue`), pause freezing `remainingMillis` across
   `TestClock.adjust`, resume re-anchoring `endsAt`, skip/prev entering the
   target at full duration, prev-on-segment-0 no-op, prev-from-done → last
   segment, skip-on-last → done.
6. **Package boundary** — `packages/domain/package.json` dependencies remain
   exactly `effect` + `@effect/rpc`; `src/rpc.ts` untouched; `bun run check`
   and `bun run test` exit 0 at the repo root.

## Teardown

Ctrl-C the dev process (kill any listeners left on :3000/:5173), then:

```sh
rm -f data/j45.dev.sqlite
```

Observed: `:3000/healthz` unreachable after teardown.
