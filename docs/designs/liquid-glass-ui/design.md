# liquid-glass-ui — design

## What it is

The J45 visual layer: a port of the owner's personal-site liquid-glass
refraction (`~/Git/personal-site/src/glass.ts` + `glass.frag.glsl`, itself a
WebGL port of Aave's "Building Glass for the Web") adapted from a one-card
animated art page into reusable primitives over shadcn/ui. Real optical
refraction at the rim with chromatic aberration, frost, and a specular edge —
not a frosted-noise fake — while staying essentially free at runtime: the GPU
draws only when layout changes, never per frame.

This slice delivers the **primitives plus a `/glass` demo route**. It does not
restyle existing screens (the landing page keeps its plain shadcn card); later
features adopt the primitives as they build their own UI.

Decisions settled at design interview (owner):

- **Dark-only, period.** J45 ships one palette. The skeleton's
  light/dark/system `ThemeProvider` and the light token set are removed; the
  dark palette becomes `:root`.
- **Document-anchored backdrop.** Cards refract the slice of the page
  background behind their *document* position, so the look is seamless and
  scrolling never triggers a re-render (the backdrop scrolls with content).
- **Fully static.** No tilt, no glare tracking, no motion of any kind.
  `tilt.ts` does not port.
- **Primitives + demo route** as the visible deliverable.

## What ports, what drops, what changes

From the personal-site implementation:

- **Ports:** the final refraction fragment shader (`glass.frag.glsl`) — the
  rounded-box SDF rim displacement with per-channel chromatic sampling — and
  the GL plumbing (program/texture helpers, the fullscreen-quad vertex
  shader); the CSS layer stack (frost tint `::before`, specular rim `::after`,
  refract canvas layer, `isolation: isolate` + `overflow: hidden` clipping).
- **Drops:** the contour-field pipeline (cell + composite passes, glyph
  atlas, everything under `scene/`), the per-frame `refractFrom(src, time)`
  driving, `tilt.ts`, and the `uField` texture path in the shader — the
  `backdrop()` function reduces to the gradient texture alone.
- **Changes:** rendering happens **only on geometry/theme change** (the
  original re-refracted every animation frame); the card's corner radius is
  **measured from computed `border-radius`** instead of a must-match-CSS
  option (the original's recorded wart); one **shared GL context** serves all
  surfaces instead of one context per card.

## Module shape

All new code lives in `packages/client/src/glass/`:

```
glass/
  renderer.ts    # shared singleton: ONE WebGL2 context on a detached canvas,
                 # refraction program compiled once; render(slice) → ImageBitmap
  backdrop.ts    # backdrop model: gradient constants (single source of truth),
                 # document-space slice math, card-space rasterisation
  geometry.ts    # pure: card rect ⨯ dpr ⨯ radius → render params (unit-tested)
  use-liquid-glass.ts  # React hook: display canvas, observers, render requests
  glass-card.tsx # <GlassCard> — shadcn Card composed with the glass surface
  glass.css      # .glass-surface tiers (imported from index.css)
```

The glass layer is **plain TypeScript at the React/DOM boundary** — no Effect.
"Effect maximally" applies where Effect idioms buy something (services, IO,
typed errors, time); a synchronous GPU paint driven by DOM observers is not
one, mirroring how shadcn components are plain React. Failures never surface
as errors: every unavailable capability degrades to the CSS tier.

## Renderer topology — one context, ImageBitmap blits

iOS Safari evicts the oldest live WebGL context beyond a small cap (~8–16); a
workout screen may hold several glass surfaces. So:

- `renderer.ts` owns the **only** WebGL2 context in the module, on a canvas
  never inserted into the DOM. Per render request it sizes the drawing buffer
  to the surface, draws the refraction pass, and hands back
  `canvas.transferToImageBitmap()`.
- Each surface's visible layer is a plain `<canvas>` with an
  `ImageBitmapRenderingContext` (`bitmaprenderer`) — cheap, not a GL context —
  positioned `absolute; inset: 0; z-index: 0; pointer-events: none` inside the
  surface element, `aria-hidden`.
- Guards: no WebGL2, no `bitmaprenderer`, or shader compile failure → the
  surface silently stays on the CSS tier. On `webglcontextlost` the renderer
  drops all surfaces to CSS, attempts one restore, and re-renders on success.

Renders are rare (layout changes), so per-render buffer resizing and the
bitmap transfer are well inside budget.

## Backdrop model

A single radial gradient anchored to the **top of the document** (centred
top-middle, radius ~1.25 × max(viewport dims), falling to a base colour), the
same shape the personal site uses. Gradient constants live in `backdrop.ts`
as the single source of truth; at startup the module paints them onto a
full-document backdrop element (one writer — no keep-in-sync comment). The
`:root` `--background` token must equal the gradient's base colour so content
past the gradient reads seamlessly.

For each surface, `backdrop.ts` rasterises the card-space slice of that
gradient into a small 2D canvas (document-space offset = viewport rect +
scroll offset) and uploads it as the shader's `uGradient` texture. The shader
interface after the `uField` removal:

```glsl
uniform sampler2D uGradient;  // page background slice, card space
uniform vec2  uResolution;    // card canvas size, drawing-buffer px
uniform float uDpr;           // drawing-buffer px per CSS px
uniform float uRadius;        // corner radius, CSS px (measured from computed style)
uniform float uBevel;         // refractive shoulder width, CSS px
uniform float uStrength;      // peak edge displacement, CSS px
uniform float uCurvature;     // shoulder ramp steepness
uniform float uChroma;        // chromatic aberration spread, 0–1
```

Port defaults carry over (`bevel 34, strength 11, curvature 3, chroma 0.24,
blur 1.5, saturate 1.5`) as `GlassOptions`, overridable per surface.

## Render triggers — the static contract

A surface re-renders **only** when its geometry key changes:
`document-space left/top ⨯ CSS size ⨯ devicePixelRatio ⨯ radius`. Watched via
a `ResizeObserver` on the element, a `ResizeObserver` on `document.body`
(catches reflows that move a card without resizing it), and window
`resize`/`orientationchange`. Scroll is deliberately **not** a trigger
(document-anchored backdrop makes it a no-op). No `requestAnimationFrame`
loop exists anywhere in the module.

Instrumentation is part of the contract: each surface exposes
`data-glass-renders="<count>"` on its element (and `data-glass-tier="css" |
"refract"`), which is what e2e asserts against.

## Fallback ladder (CSS tier)

1. **Baseline, always applied in CSS:** `backdrop-filter: blur() saturate()`
   frost, milky tint + top sheen (`::before`, screen-blended), specular rim
   traced by a masked gradient border (`::after`) — the personal-site layer
   stack, colours re-cut from the J45 dark tokens instead of hard-coded
   whites where they read wrong.
2. **Refraction tier (enhancement):** once the first bitmap lands, the opaque
   copy owns the interior — `backdrop-filter` is dropped on that element and
   `blur/saturate` apply as CSS `filter` on the layer canvas (both exactly as
   the port does).
3. **`prefers-reduced-transparency`:** surfaces render as opaque cards — no
   refraction, no frost; rim only.

## Primitives (the API downstream features consume)

```tsx
// use-liquid-glass.ts
export interface GlassOptions { bevel: number; strength: number; curvature: number;
  chroma: number; blur: number; saturate: number }  // radius is measured, not passed
export function useLiquidGlass(ref: React.RefObject<HTMLElement | null>,
  options?: Partial<GlassOptions>): void

// glass-card.tsx — composes the skeleton's shadcn Card unchanged:
//   <Card className="w-full max-w-sm" data-testid="...">  (packages/client/src/components/ui/card.tsx)
export function GlassCard(props: React.ComponentProps<typeof Card>): React.JSX.Element
```

`GlassCard` = shadcn `Card` + `glass-surface` class + the hook. Any element
can become glass via the hook + class — dialogs/popovers/chips in later
features reuse it without new machinery.

## Dark-only conversion

- `packages/client/src/index.css`: the `.dark` token block becomes `:root`;
  the light block and `@custom-variant dark` are removed.
- `packages/client/src/components/theme-provider.tsx` is deleted;
  `main.tsx` drops `ThemeProvider`.
- No theme toggle exists yet, so nothing else changes; the landing page
  renders identically except in the dark palette.

## Demo route

`/glass`, no router dependency: `App.tsx` switches on `location.pathname`
(a real router can subsume this when a multi-screen feature lands; the
server's static route already falls back to `index.html`, verified in
`packages/server/src/routes.ts`). The demo page shows the backdrop plus at
least three glass surfaces of different sizes/radii, one containing text that
updates every 250ms (visual + e2e proof that content changes don't re-render),
and a visible tier indicator (reads `data-glass-tier`).

## Testing

- **Unit (vitest, part of `bun run test`):** `geometry.ts` mapping math
  (card rect ⨯ scroll ⨯ dpr → slice offset/scale, geometry-key stability),
  options merge, gradient stop resolution.
- **e2e (Playwright, chromium + webkit, part of `bun run test:e2e`):** the
  acceptance criteria below, driven against the demo route. WebGL-unavailable
  is simulated with an init script that makes `getContext("webgl2")` return
  null; context counting wraps `HTMLCanvasElement.prototype.getContext` the
  same way.

## Out of scope

Restyling existing or future screens (each feature adopts `GlassCard`
itself); light theme; any motion (tilt, glare, animated backdrop); routing
beyond the pathname switch; theming machinery. Extra is a failure like
missing.
