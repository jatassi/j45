# 003 — Cross-fade the backdrop tint across phase changes

- **Status**: TODO
- **Commit**: 4bbd91e
- **Severity**: MEDIUM
- **Category**: Missed opportunities (preventing a jarring change)
- **Estimated scope**: 1 file (CSS), ~12 lines

## Problem

Every Work→Rest and Rest→Work boundary cuts the full-bleed backdrop from green
to amber (or back) in a single frame. On a phone held at arm's length in a dark
gym, a whole-screen hue cut every 20–40 seconds reads as a flash.

The hue arrives as an inline custom property:

```tsx
// packages/client/src/components/player/phase-backdrop.tsx:45-48 — current
  const style: CSSProperties & Record<'--phase-hue', string> = {
    '--phase-hue': PHASE_HUE[phase],
    ...(paused ? { filter: 'saturate(0.35)' } : {}),
  }
```

and is consumed by three gradients:

```css
/* packages/client/src/index.css:136-155 — current (abridged) */
.player-phase-backdrop {
  background:
    radial-gradient(120% 90% at 50% 0%,
      color-mix(in oklab, var(--phase-hue) 46%, transparent) 0%, ...),
    radial-gradient(130% 60% at 50% 100%, ...),
    linear-gradient(to bottom, ...);
  animation: player-phase-pulse 5s ease-in-out infinite alternate;
}
```

`--phase-hue` is an **unregistered** custom property, so it is a token stream,
not a colour. It cannot interpolate at all — a transition on it is silently
ignored. That is why the cut exists.

## Target

Register the property so it becomes an interpolable colour, then transition it:

```css
/* target */
@property --phase-hue {
  syntax: '<color>';
  inherits: true;
  initial-value: oklch(0.754 0.139 232.661);
}

.player-phase-backdrop {
  /* ...background and animation unchanged... */
  transition:
    filter var(--duration-enter) var(--ease-player),
    --phase-hue var(--duration-enter) var(--ease-player);
}
```

`--duration-enter` is 250ms. `--ease-player` is
`cubic-bezier(0.22, 1, 0.36, 1)`, added by plan 001.

`initial-value` cannot contain `var()`, so it is the literal value of
`--hue-cardio` (`packages/client/src/index.css:104`) — the `ready` phase the
player always starts in. Using the starting hue as the initial value means the
property can never fade in from an unrelated colour on first paint.

**Everything else at the phase boundary stays instant.** The arc stroke, the
phase word, the digit reset and the segment beep must all still land on the
frame. The tint is the only thing that eases — it is the large, bright,
peripheral surface, and it is the only one that flashes.

Reduced motion **keeps** this transition: it is a colour change with no
movement, and it reduces visual harshness rather than adding it.

## Repo conventions to follow

- **This exact pattern already exists in this file.** `--digit-color` is
  registered and transitioned so the countdown's urgency tiers glide instead of
  snapping. Copy its shape:

  ```css
  /* packages/client/src/index.css:172-182 — the exemplar */
  @property --digit-color {
    syntax: '<color>';
    inherits: true;
    initial-value: white;
  }
  .player-digits {
    transition: --digit-color 500ms;
  }
  ```

  Like `--digit-color`, `--phase-hue` is fed a `var(--hue-*)` reference rather
  than a colour literal, and that works: for a registered property the `var()`
  is substituted first, then parsed against the declared syntax.

- Player CSS blocks in `packages/client/src/index.css` carry a comment
  explaining the intent. Match that style.
- The `prefers-reduced-motion` block is the single shared one at
  `packages/client/src/index.css:310-326`.

## Steps

1. **Dependencies**: plans 001 and 002 must be applied first. 001 introduces
   `--ease-player`; 002 adds the `transition: filter ...` declaration this plan
   extends. If either is missing, STOP and report.

2. In `packages/client/src/index.css`, immediately **above** the
   `.player-phase-backdrop` rule (currently starting at line 136), add the
   property registration with a comment:

   ```css
   /* `--phase-hue` is registered so the tint can interpolate. Unregistered it
      is a token stream and a transition on it is silently dropped, which is
      what made every Work→Rest boundary cut in one frame. Same device as
      `--digit-color` below. The initial value is the literal of `--hue-cardio`
      — the `ready` phase the player starts in — because `initial-value` may
      not contain `var()`; keep the two in step. */
   @property --phase-hue {
     syntax: '<color>';
     inherits: true;
     initial-value: oklch(0.754 0.139 232.661);
   }
   ```

3. In the same file, extend the `.player-phase-backdrop` rule's `transition`
   declaration (added by plan 002) to cover the hue as well:

   ```css
     transition:
       filter var(--duration-enter) var(--ease-player),
       --phase-hue var(--duration-enter) var(--ease-player);
   ```

   Leave the `background` and `animation` declarations untouched.

4. Do **not** add anything to the `prefers-reduced-motion` block. This
   transition is deliberately kept.

5. No TypeScript changes. `phase-backdrop.tsx` already writes `--phase-hue`
   correctly.

## Boundaries

- Do NOT touch `packages/client/src/components/player/progress-arc.tsx`. The
  arc's `stroke={PHASE_HUE[phase]}` (line 347) is an SVG presentation attribute
  and must keep cutting instantly.
- Do NOT touch the phase word's colour in
  `packages/client/src/components/session-player-parts.tsx:350`. It must keep
  cutting instantly.
- Do NOT touch `packages/client/src/components/player/phase.ts` or the
  `--hue-*` token values.
- Do NOT change `useSceneSurface` — the glass canvas will still snap its
  refracted tint at the boundary. That is pre-existing and out of scope.
- Do NOT lengthen the duration past `--duration-enter` (250ms). A slower tint
  would start to lag behind the beep.
- Do NOT add new dependencies.
- If the code at a cited line does not match the excerpt above, STOP and report.

## Verification

- **Mechanical**:
  - `bun run check` — passes.
  - `bun run lint` — passes.
  - `bun run test` — passes. Note that jsdom does not implement `@property`;
    any existing test asserting the inline `--phase-hue` style value still
    passes because the component is unchanged.
- **Feel check**: run the app, start a live session with short segments
  (e.g. 5s work / 5s rest) so boundaries come quickly, and:
  - Watch a Work→Rest boundary. The background hue slides green→amber; the
    phase word, the arc's colour and the beep all still land on the same
    instant. If the tint feels like it is *reporting* the change rather than
    softening it, the duration is too long — but do not change it without
    reporting first.
  - Confirm the change is a **hue slide, not a fade to grey and back**. Because
    the mix is `in oklab`, the midpoint should be a plausible colour between
    the two, not a wash. If you see a grey midpoint, the property did not
    register and the transition is falling back to a discrete swap — stop and
    report.
  - Load the session screen fresh. There must be **no** flash from a wrong
    colour on the first paint. If you see one, the `initial-value` does not
    match `--hue-cardio`.
  - Skip forward rapidly (tap Skip five times fast). The tint retargets from
    its current colour each time and never restarts from a previous phase's
    hue.
  - In DevTools → Animations at 10% playback, confirm only the background
    repaints — no layout, and the countdown keeps ticking smoothly through it.
  - **On a real phone**: watch the countdown digits across ten phase boundaries
    with the glass dock on screen. The tint transition repaints three
    full-screen gradients for 250ms; if the digits stutter, report it.
  - DevTools → Rendering → "Emulate prefers-reduced-motion: reduce": the tint
    must still cross-fade.
- **Done when**: a phase boundary slides the background hue over 250ms while
  the phase word, arc colour, digits and beep all still change on the frame.
