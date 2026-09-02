# 002 — Ease the backdrop's pause desaturation instead of snapping it

- **Status**: TODO
- **Commit**: 4bbd91e
- **Severity**: MEDIUM
- **Category**: Missed opportunities (state change that teleports)
- **Estimated scope**: 2 files, ~8 lines

## Problem

Pausing a live workout desaturates the full-bleed phase backdrop. It is the
only whole-screen change pause makes — the digits and the arc simply freeze —
and it happens in a single frame, as an inline style appearing and disappearing:

```tsx
// packages/client/src/components/player/phase-backdrop.tsx:45-48 — current
  const style: CSSProperties & Record<'--phase-hue', string> = {
    '--phase-hue': PHASE_HUE[phase],
    ...(paused ? { filter: 'saturate(0.35)' } : {}),
  }
```

The element it lands on carries no transition for `filter`:

```css
/* packages/client/src/index.css:136-155 — current (abridged) */
.player-phase-backdrop {
  background: radial-gradient(...), radial-gradient(...), linear-gradient(...);
  animation: player-phase-pulse 5s ease-in-out infinite alternate;
}
```

The result is a hard cut of the entire screen's colour, in a dark room, at the
exact moment the user has tapped a button that otherwise gives no feedback.
Paired with plan 001 this is what makes a pause read as one deliberate gesture
rather than a glitch.

## Target

A 250ms saturation glide, in and out:

```css
/* target — added to .player-phase-backdrop */
transition: filter var(--duration-enter) var(--ease-player);
```

`--duration-enter` is 250ms. `--ease-player` is
`cubic-bezier(0.22, 1, 0.36, 1)`, added by plan 001.

The component must always write a `filter`, never omit it, so the transition
interpolates between two matching filter lists:

```tsx
/* target */
  const style: CSSProperties & Record<'--phase-hue', string> = {
    '--phase-hue': PHASE_HUE[phase],
    filter: paused ? 'saturate(0.35)' : 'saturate(1)',
  }
```

Reduced motion **keeps** this transition. It is a colour change with no
movement, and it aids comprehension of the paused state.

### Known limitation — do not try to fix it in this plan

The backdrop also registers itself as a glass scene proxy, painting one flat
colour to the canvas that the control dock refracts:

```tsx
// packages/client/src/components/player/phase-backdrop.tsx:43 — current
  useSceneSurface(ref, { color: withAlpha(resolvePhaseHue(phase), 0.25), z: -50 })
```

That call does not read `paused` at all, so the dock's refracted tint does not
desaturate today and will not follow this transition either. That is existing
behaviour, out of scope here, and almost certainly invisible behind the
frosted dock. Note it in your report; do not change `useSceneSurface`.

## Repo conventions to follow

- Motion tokens are declared twice and kept in step — the `@theme inline` block
  and the `:root` block of `packages/client/src/index.css`. `--duration-enter`
  already exists in both (lines 57 and 115). You are only *consuming* it here.
- Player CSS lives in `packages/client/src/index.css` under a comment block.
  Exemplar of a transition on a player element:
  `.player-digits { transition: --digit-color 500ms; }` at
  `packages/client/src/index.css:180-182`.
- The `prefers-reduced-motion` block is the single shared one at
  `packages/client/src/index.css:310-326`.

## Steps

1. **Dependency**: plan 001 must be applied first — it introduces
   `--ease-player`. If `--ease-player` is not present in
   `packages/client/src/index.css`, STOP and report.

2. In `packages/client/src/index.css`, add the transition to the
   `.player-phase-backdrop` rule (currently ending at line 155), after the
   `animation:` declaration:

   ```css
   .player-phase-backdrop {
     background: /* unchanged */;
     animation: player-phase-pulse 5s ease-in-out infinite alternate;
     /* Pause desaturates the whole screen. Without this it cuts in one
        frame — the only whole-screen change a pause makes. */
     transition: filter var(--duration-enter) var(--ease-player);
   }
   ```

   Leave the `background` and `animation` declarations exactly as they are.

3. In `packages/client/src/components/player/phase-backdrop.tsx`, replace the
   conditional spread (currently lines 45-48) so a `filter` is always written:

   ```tsx
     // Always a filter, never an omitted one: `saturate(0.35)` → `saturate(1)`
     // interpolates as a matching filter list, where a value → `none`
     // transition depends on the browser substituting identity functions.
     const style: CSSProperties & Record<'--phase-hue', string> = {
       '--phase-hue': PHASE_HUE[phase],
       filter: paused ? 'saturate(0.35)' : 'saturate(1)',
     }
   ```

4. Update the component's doc comment (currently
   `packages/client/src/components/player/phase-backdrop.tsx:26-33`) — change
   the sentence `` `paused` desaturates the tint in place. `` to:

   ```
    * `paused` desaturates the tint in place, over `--duration-enter`.
   ```

5. Do **not** add anything to the `prefers-reduced-motion` block. This
   transition is deliberately kept under reduced motion.

## Boundaries

- Do NOT change `useSceneSurface` or anything in `packages/client/src/glass/`.
- Do NOT change the `background` gradients or the `player-phase-pulse`
  animation.
- Do NOT change `data-paused`, `data-phase`, `data-testid` or the element's
  positioning classes.
- Do NOT convert the filter to a two-layer opacity crossfade in this plan. If
  the feel check below shows the filter transition hitching on a real phone,
  STOP and report that finding — a crossfade is a separate, larger change.
- Do NOT add new dependencies.
- If the code at a cited line does not match the excerpt above, STOP and report.

## Verification

- **Mechanical**:
  - `bun run check` — passes.
  - `bun run lint` — passes.
  - `bun run test` — passes. Check
    `packages/client/test/` for any assertion on the backdrop's inline
    `filter`; if one asserts the property is absent when not paused, it must be
    updated to expect `saturate(1)`, and you must say so in your report.
- **Feel check**: run the app, start a live session, and:
  - Tap Pause. The screen's colour drains over about a quarter of a second —
    fast enough to feel like a response to the tap, slow enough that there is
    no flash.
  - Tap Resume. The colour returns over the same beat. In and out must look
    like the same movement reversed.
  - Tap Pause and Resume rapidly, five times. The colour retargets from
    wherever it currently is; it must never jump to full saturation and
    restart. (This is why it is a transition and not a keyframe animation — if
    you see restarting, you used the wrong mechanism.)
  - Watch the phase word in the top strip and the digits while pausing. They
    must still change **instantly**; only the background tint eases.
  - **On a real phone** (not the desktop simulator): pause and resume ten
    times while the workout runs and the glass dock is on screen. Watch the
    countdown digits for dropped frames. A full-screen `filter` transition
    repaints the whole gradient; if the digits stutter during the 250ms, stop
    and report it rather than shipping.
  - DevTools → Rendering → "Emulate prefers-reduced-motion: reduce": the
    desaturation must still glide. It is a colour change, not movement.
- **Done when**: pausing and resuming eases the backdrop's saturation over
  250ms in both directions, the transition retargets cleanly when spammed, and
  every other element on the screen still changes instantly.
