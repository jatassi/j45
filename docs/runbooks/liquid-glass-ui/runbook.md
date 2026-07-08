# liquid-glass-ui — validation runbook

Validated by the Validate agent against the integration tree merging
`loop/liquid-glass-ui` + `--dark-only`, `--backdrop-geometry`, `--renderer`,
`--glass-primitives`, `--demo-e2e` onto `main` (all merges clean). Bun,
macOS (darwin), Playwright chromium + webkit.

## Bring-up

```sh
bun install
bun run dev        # server on :3000, Vite client dev server on :5173
```

Observed: `curl http://localhost:3000/healthz` and
`curl http://localhost:5173/healthz` (proxied) both → 200
`{"sha":"dev","version":"0.0.0"}`; `curl http://localhost:5173/glass` → 200,
the client shell (the `/glass` route is a client-side pathname switch in
`packages/client/src/app.tsx`; the server's static fallback serves
`index.html` for it in a real deploy).

## Exercise

1. **`bun run check`** → `@j45/domain`, `@j45/server`, `@j45/client` each
   exit 0.
2. **`bun run test`** → 19 test files / 75 tests, all green. New for this
   feature:
   - `glass-geometry.test.ts` — card rect × scroll × dpr → buffer size and
     document-space slice offset/scale; geometry-key stability (invariant
     under scroll and repeated calls; changes on document move, CSS resize,
     dpr, radius).
   - `glass-backdrop.test.ts` — gradient constants as single source of
     truth; `installBackdrop` idempotence/repaint; `mapSliceToGradient`
     centre/radius math and its composition with `computeRenderParams`.
   - `glass-renderer.test.ts`, `use-liquid-glass.test.tsx`,
     `glass-card.test.tsx`, `glass-css.test.ts` — renderer availability/
     context-loss ladder, hook render contract, GlassCard composition, CSS
     tier stack.
   - `index-css-dark-only.test.ts`, `main-entry-no-theme-provider.test.ts`,
     `button-dark-only.test.tsx` — dark-only conversion.
3. **`bun run test:e2e`** → 12 tests (6 per browser × chromium + webkit),
   all green against the built client + real server:
   - `/glass` mounts ≥3 glass surfaces of distinct widths and corner radii;
     every surface reaches `data-glass-tier="refract"` within 5s in both
     browsers.
   - With the demo's text mutating every 250ms, a refracting surface's
     `data-glass-renders` is unchanged across a 2s observation window; a
     viewport resize then increases it.
   - With an init script forcing `getContext("webgl2")` → null (patched on
     both `HTMLCanvasElement` and `OffscreenCanvas` prototypes — the shared
     renderer acquires its context on an `OffscreenCanvas`), every surface
     stays `data-glass-tier="css"`, its computed backdrop-filter contains
     `blur`, no `.glass-layer` canvas exists, and zero console/page errors
     are logged.
   - With `getContext` instrumented the same way, exactly one `"webgl2"`
     acquisition is counted for the whole page.
   - `server-info.spec.ts` (walking-skeleton suite, byte-for-byte
     unchanged) still passes in both browsers.
4. **`bun run lint`** and **`bun run format:check`** → exit 0.
5. **`bun run deploy:sim`** → push → hook → build → health check serving the
   deployed SHA → `deploy:sim PASSED`.

## Teardown

Ctrl-C the dev process (kill the `bun run dev` process group; a lingering
server on :3000 can be found with `lsof -nP -iTCP:3000 -sTCP:LISTEN`), then
`rm -f data/j45.dev.sqlite`.
