# Design — glass-live-refraction

Upgrade the liquid-glass material so surfaces (1) **refract live content**
behind them instead of the static document gradient, and (2) **reflect** —
pick up color from surrounding content at the rim. Chosen direction (brief +
`docs/research/liquid-glass-live-refraction.md`): the **scene registry** —
components declare cheap visual proxies of themselves; a proxy compositor
draws them into the refraction texture. No DOM snapshotting, ever.

This feature changes `packages/client/src/glass/` only (plus its unit/e2e
suites and a perf harness on the demo route). It must land before
`player-screens` so the player is built once, on a known answer about which
tier runs mid-workout.

## What exists (interfaces being generalized)

- `backdrop.ts` — `rasteriseCardSlice(options): HTMLCanvasElement` draws the
  static `BACKDROP_STOPS` radial gradient for one card's document-space slice;
  `mapSliceToGradient` is the pure, unit-tested offset math. `installBackdrop`
  paints the matching full-document element.
- `renderer.ts` — singleton `refractionRenderer` on one shared WebGL2
  `OffscreenCanvas`; `render(gradient: TexImageSource, params): ImageBitmap |
  null` uploads the whole slice via `texImage2D` into `uGradient` each call.
- `use-liquid-glass.ts` — `renderSurface` re-renders only when
  `geometryKey(input)` changes (rect ⨯ dpr ⨯ radius; deliberately
  scroll-invariant, no rAF loop, no scroll listener).
- `glass.css` — 3 tiers via `data-glass-tier`: `refract` (canvas) → `css`
  (backdrop-filter blur) → reduced-transparency opaque.

## Scene registry (`glass/scene.ts`, new)

One document-anchored scene shared by every surface. Components register
proxies; the compositor replaces the gradient-only rasterisation.

```ts
export type DocRect = { left: number; top: number; width: number; height: number } // document space, CSS px

export type SceneProxy = {
  rect: DocRect
  z: number // paint order; backdrop gradient is implicitly z = -Infinity
  paint: (ctx: CanvasRenderingContext2D) => void // origin translated to rect's top-left, CSS px
}

export type SceneProxyHandle = {
  update: (next: Partial<SceneProxy>) => void // move/resize/repaint-def
  invalidate: (region?: DocRect) => void      // content changed; region defaults to rect
  dispose: () => void
}

export const sceneRegistry: {
  register: (proxy: SceneProxy) => SceneProxyHandle
  /** Composite every proxy intersecting `slice` (backdrop gradient first,
   *  then proxies by z) into a canvas — the generalization of
   *  `rasteriseCardSlice`, same slice/dpr contract. */
  compositeSlice: (options: RasteriseOptions) => HTMLCanvasElement
  /** Streams dirty document-space regions to the surface manager. */
  subscribe: (onDirty: (region: DocRect) => void) => () => void
}
```

Proxy vocabulary (helpers, not new kinds — everything is a `paint` fn):

- **Surface proxy** — rounded rect + token color (+ optional 1px hairline).
  A `useSceneSurface(ref, { color, radius })` hook auto-registers an opaque
  card/section and keeps `rect` synced via the same ResizeObserver plumbing
  `useLiquidGlass` uses. Opaque content cards are the main thing glass chrome
  scrolls over, so this alone makes refraction "live" for most screens.
- **Sprite proxy** — rasterize-once canvas sprite for static text/images
  (headings, badge rows). Painted once into an offscreen canvas at dpr, then
  `drawImage`d by `paint`.
- **Dirty-region proxy** — a small owner-painted canvas the component mutates
  and then `invalidate()`s; the timer digits are the canonical case. The
  proxy's canvas stays small (just the digit block), so an invalidation
  uploads a few-KB sub-rect, never a full slice.

Registration granularity is coarse by design: screens register their scroll
container's cards and hero text, not every DOM node. Un-proxied content
simply isn't refracted (the gradient shows instead) — visually acceptable
because tiers 1–2 never refracted it either. **No proxy may itself be a glass
surface** (no glass-refracting-glass recursion); the registry drops such
registrations in dev with a warning.

## Invalidation and the render path

`use-liquid-glass.ts` today: repaint iff `geometryKey` changed. Upgrade adds
two more triggers, all funneled through one rAF-coalesced scheduler
(`glass/scheduler.ts`, new):

1. **Geometry** (existing): rect/dpr/radius change → full slice re-composite
   + full `texImage2D` upload (unchanged path).
2. **Scene dirt** (new): a dirty region intersecting the surface's slice →
   re-composite only the intersection and upload it with **`texSubImage2D`**
   — never a full-canvas `texImage2D` re-upload (the measured ~9 ms stall
   from the personal-site port is the named failure mode). This requires the
   renderer to keep a persistent per-surface texture:

   ```ts
   // renderer.ts additions (uGradient uniform renamed uScene)
   type SurfaceTexture = {
     upload: (source: TexImageSource) => void                    // full texImage2D
     uploadRegion: (source: TexImageSource, x: number, y: number) => void // texSubImage2D
     render: (params: RefractionParams) => ImageBitmap | null
     dispose: () => void
   }
   refractionRenderer.surface(id: string): SurfaceTexture
   ```

3. **Scroll, fixed surfaces only** (new): position-fixed chrome (tab bar,
   sticky headers) moves through document space when the page scrolls, so its
   slice must follow. A passive scroll listener marks fixed surfaces dirty;
   the rAF scheduler coalesces to at most one composite+upload per frame per
   surface, and only while scroll position actually changes. Static-positioned
   surfaces keep today's scroll-invariance (their `geometryKey` still ignores
   scroll).

`data-glass-renders` keeps counting every upload (full or sub), so the
existing e2e idiom — "content mutation with no proxy dirt must not increase
the count" — still holds.

## Rim reflection

- **Refract tier** (`glass.frag.glsl`): the scene texture is already bound —
  sample it a few px *outward* along the rim normal and mix into the existing
  specular rim color (weight ~`uChroma`-scale, new uniform `uReflect`).
  Content-tinted rim, near-free (same texture, +1 sample per rim fragment).
- **CSS tiers**: per-surface, average the composited slice's border band to
  one color (cheap `drawImage` to a 1×1 canvas at composite time) and set
  `--rim-tint` on the element; `glass.css`'s `::after` rim gradient mixes it
  in via `color-mix`. Recomputed only when the surface re-composites, so
  tier-1 surfaces get ambient color at zero steady-state cost. Tier 3
  (reduced transparency) ignores rim tint entirely.

## Perf budget and the phone gate

The loop's validator asserts **mechanisms**; the owner measures **wall time**
on the two real phones (iOS Safari + Android Chrome) during the end-of-
overhaul QA pass — that split is deliberate.

- Validator-exercisable: render counters (`data-glass-renders`), upload-path
  assertions (an e2e init script wraps `texSubImage2D`/`texImage2D` and
  asserts dirt-driven updates never call full `texImage2D`), steady-state
  assertions (no proxy dirt + no scroll + no geometry change ⇒ zero renders
  over an observed window), and a `/glass` perf section that runs a scripted
  scenario (ticking digit proxy at 1 Hz over a fixed glass bar for 10 s) and
  reports composite+upload timings via `performance.measure` as data
  attributes.
- Owner gate (recorded, not validator-run): on real phones, the scripted
  scenario must not drop the player's countdown below 60 fps or visibly heat
  the phone; if it fails, `player-screens` mounts session-player chrome at
  the CSS tier while running (a one-line tier cap per surface —
  `useLiquidGlass(ref, { maxTier: 'css' })`, part of this feature) and the
  A+C role still stands.

## Rejected / future

- `backdrop-filter: url()` displacement (kube.io technique) as a Chromium
  progressive-enhancement tier: **not now.** It's a fourth code path serving
  only Android Chrome, and WebKit shows no movement (bug 245510, still open;
  w3c/svgwg#1142 has no vendor positions). Revisit only if the scene registry
  fails its phone gate. The filtered-copy SVG technique stays rejected for
  workout screens (WebKit CPU-rasterizes SVG filters per frame).
- HTML-in-Canvas: Chrome origin trial only; watch, don't build.

## Acceptance sketch (binding criteria live in the feature graph)

Demo-route scenarios on chromium + webkit e2e: live proxy refraction (moving
a proxy changes glass pixels), sub-texture upload discipline, steady-state
zero renders, scroll-following fixed chrome, rim tint present in refract and
CSS tiers, 3-tier fallback and the one-context invariant unchanged, unit
tests for slice compositing math and dirty-region intersection.
