# Brief — UI/UX Overhaul (design system + first-principles redesign)

## Intent

J45's frontend works but reads as a wireframe: bare shadcn defaults, native form
elements, raw kebab-case vocabulary ids in the UI, no navigation model, and a
fully-built liquid-glass system sitting unused behind a demo route. This intake
is a **complete UI/UX overhaul**: reimagine the app's layout and feel from first
principles around the existing feature set, expressed through a complete design
system — beautiful but functional — with the liquid-glass material as a
signature element, evolved from the legacy diet-f45 app's visual identity.

## Users

The owner and his girlfriend (phones in hand, mid-workout, low patience for
friction), plus invited friends and family — same as the project brief. The
overhaul must serve sweaty-thumb usability first and delight second.

## Scope envelope

**Feature-sized intake, but broad:** every screen of `packages/client`, plus the
small domain/server surface needed for per-participant leave. Structural changes
(navigation, IA, screen layout) are explicitly **in** — this is a first-principles
reimagining, not a reskin. The feature set itself is frozen: no new capabilities
beyond UX affordances.

**Explicitly out:**

- Light theme — the app stays dark-only.
- Exercise animations during workouts — separate future intake; the player
  design must leave an obvious slot for them.
- New capabilities (sharing, stats dashboards, PWA install flows, etc.).
- Branding beyond the app itself (a J45 wordmark treatment in-app is in scope;
  external marketing assets are not).

## Decided

- **First-principles redesign (scope b).** IA, navigation, layout, and feel all
  on the table, designed around the existing features.
- **shadcn-first componentry.** Heavy reliance on shadcn/ui primitives installed
  via `bunx shadcn add`; the client is on **shadcn v4 backed by `@base-ui/react`
  1.6 — Base UI, not Radix** (verified in-repo). All native form elements
  (`<select>`, bare `<input>`, hand-rolled fixed-overlay dialogs — nine files
  today) are replaced by `ui/` components. Custom styling is expressed through
  tokens and variants, not one-off Tailwind on raw elements. Key mappings:
  `field`/`input`/`select`/`combobox`/`toggle-group` for forms, `drawer` (bottom
  sheet) and `dialog`/`alert-dialog` for overlays, `sonner`/`skeleton`/`empty`/
  `alert`/`progress` for feedback, `badge`/`tabs`/`avatar`/`accordion` for
  display.
- **Visual identity: evolve the legacy app (direction a).** Near-black slate
  ground, hot-orange signature accent, sport-coded semantic hues
  (cardio=sky, strength=violet, hybrid=rose, work=green, rest=amber — they carry
  meaning, not decoration), heavy tight-tracked headings, big tabular-nums timer
  digits, Geist Variable. "diet-f45 grown up," with glass as the new layer.
- **Liquid glass role: chrome + hero (A + C).** Glass chrome — bottom tab bar,
  sticky headers, overlays — for constant material identity; hero glass on star
  surfaces (live-player phase card, workout-complete). Content cards stay opaque
  for readability. Validated by the `/proto` prototype on the `redesign` branch
  (variants A/B/C; B's all-glass content was rejected).
- **Glass material upgrade.** The material must evolve to (1) **refract live
  content** behind it, not the current static gradient, and (2) **reflect** —
  pick up color from surrounding content. Full feasibility survey with verdict
  table and citations: [`docs/research/liquid-glass-live-refraction.md`](../research/liquid-glass-live-refraction.md)
  (July 2026). The **scene-registry** approach is the chosen direction; the
  changes it implies to `packages/client/src/glass/`:
  - `backdrop.ts`: `rasteriseCardSlice` (today: draws the static
    `BACKDROP_STOPS` gradient) becomes a **proxy compositor** — a registry
    where components declare cheap visual proxies of themselves: rounded
    rect + token color for cards/surfaces, rasterize-once canvas sprites for
    text, a small dedicated dirty-region texture for the timer digits. The
    compositor draws proxies into the refraction texture (`uGradient` →
    rename `uScene`).
  - **Invalidation replaces geometry-only re-render:** today surfaces re-render
    only on geometry-key change (rect + `window.scrollY`); the upgrade adds
    proxy-level dirty tracking, with `texSubImage2D` sub-texture uploads (never
    full-canvas re-upload — the ~9 ms `texImage2D` stall measured in
    personal-site is the known failure mode).
  - `glass.frag.glsl`: add **rim reflection** — sample the scene texture a few
    px outward along the rim normal and mix into the specular color
    (content-tinted rim, near-free since the texture is already bound).
    Apple's Liquid Glass does the analogous "light from colorful content
    spills onto the surface" (WWDC25); no web recreation found does it — this
    is novel territory, hence prototype-first.
  - **CSS tiers stay honest:** downsample the scene texture per region and
    feed a `--rim-tint` custom property into the existing `::after` rim
    gradient, so tiers 1–2 pick up ambient color too. The 3-tier fallback
    stack survives unchanged.
  - **Perf gate before adoption:** measure the timer-digit re-upload cost on
    real phones first; if the budget fails, glass falls back to CSS-blur tier
    during running sessions and the A+C role still stands (see Assumptions).
  - **Prior art to mine:** `~/Git/personal-site/` (`src/glass.ts`,
    `glass.frag.glsl`) — the WebGL port of Aave's "Building Glass for the Web"
    that J45's copy descends from. Note it also refracts a *known scene* (its
    contour field), not DOM — same architecture as the scene registry, so its
    displacement + chromatic-aberration shader treatment carries over intact.
  - Rejected (details + citations in the research doc): html2canvas snapshots
    (static, upload stalls), SVG-filter backdrop displacement
    (`backdrop-filter: url()` unsupported in WebKit — bug 245510; the
    filtered-copy variant CPU-rasterizes per frame on iOS), CSS `element()`
    (Firefox-only), HTML-in-Canvas (Chrome origin trial only). The Chromium
    `backdrop-filter: url()` displacement tier (kube.io technique) remains a
    possible progressive enhancement, Design's call.
- **Vocabulary labels live in the domain.** The six `Schema.Literal` unions
  (`Modality`, `Intensity`, `MuscleGroup`, `Equipment`, `Focus`, `FlowType`)
  have no label field anywhere — that's the id-instead-of-label bug. Fix:
  exhaustive `Record<Literal, string>` label maps co-located with each union in
  `@j45/domain`; a literal without a label is a compile error. No generic
  humanizer fallback. The client never renders vocabulary literals raw.
- **Frontend CLAUDE.md.** A concise `packages/client/CLAUDE.md` ships with the
  overhaul: the labels rule, Base-UI-not-Radix, design-system conventions, and
  the glass gotcha discovered during prototyping (`.glass-surface` forces
  `position: relative`, so Tailwind positioning classes on the same element
  silently lose — glass surfaces need a positioned wrapper).
- **Navigation: action-first tab bar (option b).** Persistent bottom tabs
  **Home · Library · Generate · History**; account via header avatar chip. Home
  is a "start something" dashboard: start/join/resume a session first, recent
  workouts, quick link to the ad-hoc timer. Session player and editors push over
  the tabs.
- **Quit semantics: per-participant leave (option b).** A mid-workout exit on
  the player, behind a confirm; leaving records the participant's progress in
  their history; the session ends when the last participant leaves. This is the
  one item that touches domain + server.
- **Feedback-state standard (blanket, every screen):** skeletons for query
  loading; empty states with a CTA; query failures render inline alert + retry
  (never indistinguishable from loading); command failures surface as toasts —
  nothing silently swallowed; destructive actions get `alert-dialog` confirms;
  success is quiet unless invisible on-screen.
- **Design-system deliverable (option b):** evolved token set in `index.css`;
  the full variant-extended `ui/` kit with glass variants where decided;
  `docs/design-system.md` (palette semantics, type scale, spacing, glass usage
  rules); and a **dev-only `/design` gallery route** rendering every token,
  component, and variant with the real glass system.
- **Working agreements:** design options are prototyped live and judged by eye —
  initial prototype builds dispatched to **Opus subagents**, iterated in the main
  session. All overhaul work lands on the **`redesign` branch** (worktree
  `.claude/worktrees/redesign`, dev server via the `j45-redesign` launch config).

## Deferred (deliberately left for Design)

- The concrete token values: final palette (oklch-tuned from the legacy hexes),
  type scale, spacing/radius scales, motion language.
- Home-screen dashboard layout, player-screen layout, and every per-screen
  design — to be prototyped, not spec'd in prose.
- Scene-registry API design (how components register proxies, invalidation
  granularity, timer-digit dirty-texture strategy) and the perf-budget
  measurement plan; whether the Chromium `backdrop-filter: url()` tier is worth
  adding as progressive enhancement.
- Exact leave-workout protocol (domain events, server session state machine
  changes, reconnection edge cases).
- Where the ad-hoc timer and exercise library live in the IA (Home quick link
  vs Library section vs elsewhere).
- Tab-bar iconography and the J45 in-app wordmark treatment.
- Migration order across screens (big-bang vs screen-by-screen), and how the
  existing e2e suite is updated alongside.

## Assumptions (unverified, proceeding on)

- The scene-registry direction survives its first perf prototype on real phones
  (sub-texture uploads keep the timer path cheap). If it doesn't, the CSS-blur
  tier remains the mid-workout default and refraction stays on static/ambient
  surfaces — the A+C role still works.
- WebGL2 remains available on both target phone browsers; the reduced-
  transparency tier remains an accessibility requirement.
- The existing Playwright e2e infrastructure can absorb redesigned flows
  without a harness rewrite.
- Friends/family scale — no perf concerns from the UI overhaul server-side.

## Constraints

- **Stack is fixed:** React 19, Tailwind v4, shadcn v4 on `@base-ui/react`
  (never Radix), TanStack Router, @effect-atom/atom-react, Geist Variable;
  TypeScript 7 + oxlint toolchain; `bun run check` / lint / format / test gate
  every commit (pre-commit hook enforces).
- **Dark-only, phone-first** (~390px design target; desktop is a centered
  column).
- **Timer performance and battery are sacred:** glass effects must not degrade
  countdown smoothness or burn batteries during 45-minute sessions; the 3-tier
  fallback (refract → CSS blur → reduced-transparency opaque) must survive the
  overhaul.
- Domain/server changes limited to what leave-workout requires.
- Feature set frozen; parity of existing behavior preserved through the
  redesign.

## Done looks like

1. **Zero raw vocabulary ids rendered** — all display text for the six enum
   vocabularies comes from the domain label records.
2. **Zero native form elements** in `src/components/` — everything composes
   from `ui/`.
3. **Navigation shipped** — persistent bottom tab bar (Home · Library ·
   Generate · History), action-first Home with start/join/resume, account via
   header avatar.
4. **Leave-workout shipped** — per-participant, confirmed, history-recorded;
   session ends when the last participant leaves.
5. **Feedback standard holds on every screen** — skeleton / empty-with-CTA /
   inline-error-with-retry / toast-on-command-failure / destructive confirms.
6. **Liquid glass live in its A+C role on real screens** — all three tiers
   functioning, and countdown smoothness on phones unharmed.
7. **`/design` gallery route** renders every token, component, and variant.
8. **Docs shipped** — `docs/design-system.md` + `packages/client/CLAUDE.md`.
9. **Suites green** — unit + e2e pass, e2e updated where flows changed.
10. **Owner visual QA** — a screen-by-screen pass with the owner approving the
    result as beautiful *and* functional.
