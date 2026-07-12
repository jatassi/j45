# Validation procedure — glass-live-refraction

Replay record for the scene-registry live-refraction glass upgrade. Follows the
`walking-skeleton` binding contract (bring-up / exercise / teardown).

## Bring-up

- `bun install` (run by the integration worktree setup).
- The e2e harness (`bun run test:e2e`) manages its own server via
  `e2e/support/global-setup.ts`; no manual `bun run dev` is needed to exercise
  the criteria below. For interactive inspection: `bun run dev` (server :3000,
  Vite client :5173) and open `/glass`.

## Exercise & observations

All commands run from the integration worktree root; all exited 0.

- `bun run check` — typecheck across domain/server/client. Exit 0.
- `bun run lint` — oxlint --type-aware. Exit 0. One non-blocking warning
  (`no-console` at `packages/client/src/glass/scene.ts:199`) — the design-mandated
  dev-only warning when a glass surface is refused as a proxy; `no-console` is a
  warn-level rule in `.oxlintrc.json` and does not fail the command.
- `bun run test` — vitest, 82 files / 416 tests passed. Covers criterion 1:
  `packages/client/test/glass-scene.test.ts` asserts `intersectDocRects`
  (proxy/slice intersection), `dirtyToSubRect` (dirty-region → sub-rect, incl.
  dpr scaling and clamping), and `paintOrder` (ascending z, stable, non-mutating).
- `bun run test:e2e` — Playwright chromium + webkit, 63 passed / 3 skipped
  (the 3 skips are chromium-only two-context live-session/passkey specs correctly
  not run on webkit). Exit 0. Observed per criterion:
  - **C2** `proxy move re-renders a refracting surface; text mutation alone does
    not` — moving a registered proxy raises `data-glass-renders`; an un-proxied
    DOM mutation leaves it unchanged.
  - **C3** `dirty updates use texSubImage2D only … emit 10 samples` — init script
    wraps `texImage2D`/`texSubImage2D`; after initial upload, ten 1 Hz dirty
    ticks produce `texSubImage2D > 0` and `texImage2D == 0`; the scenario
    publishes 10 numeric per-update composite+upload durations in
    `data-glass-perf-samples`.
  - **C4** `scroll re-renders the fixed bar only` — fixed bar's count rises while
    scrolling; static card's does not; both flat within 2s of scroll stopping.
  - **C5** `css-tier surfaces carry a live --rim-tint that updates` (WebGL2
    disabled) — every `.glass-surface` has a non-empty `--rim-tint`; it changes
    when the dominant proxy color changes. `refract path requests uReflect and
    uploads a nonzero uniform value` — init script hooks WebGL2
    `getUniformLocation`/`uniform1f`; `uReflect` is requested and set to a
    nonzero value. Shader `glass.frag.glsl` declares `uReflect` and mixes an
    outward scene rim sample into the specular rim.
  - **C6** `capped surface stays on the css tier` — `maxTier: 'css'` surface
    holds `data-glass-tier="css"` with no `canvas.glass-layer` for 5s while other
    surfaces reach refract.
  - **C7** existing `e2e/glass.spec.ts` (unchanged) — ≥3 surfaces refract within
    5s, WebGL2-disabled path yields css tier with blur and zero console errors,
    exactly one webgl2 context per page.

## Teardown

- The e2e harness tears down its own server. For an interactive `bun run dev`
  session: Ctrl-C the dev process.
- Reset local state: `rm -f data/j45.dev.sqlite`.
