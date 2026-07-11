# Research — liquid glass with live refraction & reflection (July 2026)

Feasibility survey for upgrading J45's liquid-glass material to (1) refract
live content behind glass surfaces and (2) reflect color from surrounding
content. Commissioned by the UI/UX overhaul intake
([brief](../briefs/ui-ux-overhaul.md)); consumed by its Design phase.

## Context

- Current implementation: `packages/client/src/glass/` — WebGL2
  fragment-shader refraction (`glass.frag.glsl`), which rasterizes only a
  static gradient backdrop (`backdrop.ts` → `rasteriseCardSlice`,
  `BACKDROP_STOPS`), re-rendered only on geometry-key change
  (rect + `window.scrollY`). 3-tier fallback in `glass.css`:
  refract → CSS `backdrop-filter` blur → reduced-transparency opaque.
- Origin: `~/Git/personal-site/` (`src/glass.ts` + `glass.frag.glsl`) — a
  WebGL port of Aave's "Building Glass for the Web". Note: there the
  refraction also samples a *known scene* (the contour field), not arbitrary
  DOM — same architecture as J45's gradient, at higher scene complexity.
  Useful there: the shader's displacement/chromatic-aberration treatment and
  the measured finding that full-canvas `texImage2D` uploads cost ~9 ms
  (which killed snapshot-based approaches).

## (a) Verdict table

| Technique | iOS Safari | Android Chrome | Live DOM? | Perf cost | Effort | Verdict |
|---|---|---|---|---|---|---|
| 1. `backdrop-filter: url(#feDisplacementMap)` | **No** — WebKit bug 245510 open since 2022, still NEW/unassigned as of Jun 2026 | Yes, GPU-composited | Yes (true backdrop) | Low on Chromium | Low | Chromium-only enhancement tier |
| 2. `filter: url()` on a counter-positioned DOM clone (Outpace/PallavAg family) | **Yes** — but WebKit runs SVG filters in software, re-rasterizing per frame | Yes (GPU) | Yes | High on iOS (CPU raster during scroll → battery) | Medium | Works everywhere; iOS perf is the risk for 45-min sessions |
| 3. HTML-in-Canvas (`texElementImage2D`) | No (no WebKit/Mozilla commitment) | Chrome 148 origin trial only, snapshot + `requestPaint` model | Yes-ish | Low-medium | Medium | Watch; future ideal Chromium path, not shippable |
| 4. html2canvas snapshot → WebGL (liquidGL, 741★) | Yes | Yes | **No** — static snapshot; dynamic content needs manual re-capture; `texImage2D(canvas)` is a ~9 ms stall (measured in the personal-site port) | High when content changes | Medium | Wrong fit for a live timer UI |
| 5. Scene-registry proxies → WebGL (curtains.js pattern, extended) | **Yes** (WebGL2 fine) | Yes | Yes, by construction | You control it — redraw only invalidated proxies | High-ish, but incremental on existing code | **Best fit** |
| 6. CSS `element()` | No | No (Firefox-only, unchanged) | — | — | — | Dead |

## (b) Most promising paths for live refraction

**1. Scene-registry hybrid (extend what exists).** `rasteriseCardSlice`
already implements the pattern at n=1 scene object (the gradient).
Generalize: components register visual proxies (rounded rect + token color,
text as rasterize-once canvas sprites, timer digits as a small dirty-region
texture) drawn into the `uGradient` texture (rename: `uScene`), re-uploaded
only when a proxy invalidates. curtains.js / gpu-curtains proves the DOM↔GL
sync pattern (https://github.com/martinlaxenaire/curtainsjs,
https://www.curtainsjs.com/); no off-the-shelf "liquid glass over proxy
scene" library exists — this builds the thing the games technique implies.
Fits the 3-tier fallback untouched.

**2. Filtered-copy SVG technique (cross-browser, no WebGL).** Render the
backdrop content twice; the copy sits under the lens, counter-positioned,
with `filter: url(#displacement)` — standard `filter` works everywhere
`backdrop-filter: url()` doesn't. Write-ups:
https://glass.outpacestudios.com/, https://webtricks.dev/blog/liquid-glass-css,
https://github.com/PallavAg/liquid-glass-web-react (41★; per-update
filter-ID churn needed on Safari, `userSpaceOnUse` on iOS, size caps, no
`<video>` through filters on WebKit). Caveat: WebKit rasterizes SVG filters
on CPU per frame — the exact reason the personal-site port moved
displacement to the GPU. Viable as a *middle tier*, dubious as the primary
during workouts.

**3. Chromium backdrop-filter tier.** The kube.io technique (Snell's-law
displacement map via `feImage` + `feDisplacementMap` in `backdrop-filter`)
is the highest-quality zero-copy option — Chromium-only:
https://kube.io/blog/liquid-glass-css-svg/. Standardization only just
requested (w3c/svgwg#1142, opened Jun 2026, no vendor positions):
https://github.com/w3c/svgwg/issues/1142. WebKit bug:
https://bugs.webkit.org/show_bug.cgi?id=245510. HTML-in-Canvas is the other
Chromium-only future: https://github.com/WICG/html-in-canvas,
https://byteiota.com/html-in-canvas-api-draw-live-dom-inside-webgl-chrome-2026/.

## (c) Reflection findings

- **Apple:** lensing is a planar 2D displacement map; specular highlights
  sync to the **gyroscope**, and larger controls let "light from colorful
  content spill onto the surface" — i.e. ambient content sampling, per
  WWDC25 "Meet Liquid Glass"
  (https://developer.apple.com/videos/play/wwdc2025/219/,
  https://1ar.io/updates/how-liquid-glass-works). Nothing lower-level
  published.
- **Web recreations all fake it geometrically:** rim intensity = surface
  normal · fixed light direction, pre-baked into the displacement map's blue
  channel (Outpace) or a separate `feImage` highlight layer (kube.io).
  **No one found doing environment maps built from page content**; nothing
  shipping in production beyond static rim gradients.
- **Cheap real version for J45:** the refract tier already has the scene
  texture in-shader — sample it a few px *outward* along the rim normal in
  `glass.frag.glsl` and mix into the specular color (content-tinted rim,
  ~free). For CSS tiers: downsample the scene-registry texture to 1×1 per
  region and feed a `--rim-tint` custom property into the existing `::after`
  gradient.

## (d) Prototype first

The **scene registry**. It's the only path that is live, iOS-safe,
battery-controllable, and it's a delta on the existing renderer rather than
a rewrite: swap `rasteriseCardSlice` for a proxy compositor with
dirty-region invalidation, then add the rim-tint sample to the shader for
reflection. Measure the timer-digit re-upload cost first (keep the dirty
texture small — sub-texture `texSubImage2D` uploads, not full-canvas). Add
the filtered-copy technique later only if glass must sit over arbitrary
un-proxied content, and the Chromium `backdrop-filter: url()` tier only as
progressive enhancement.
