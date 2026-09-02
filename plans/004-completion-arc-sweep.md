# 004 — Draw the arc closed when the workout completes

- **Status**: TODO
- **Commit**: 4bbd91e
- **Severity**: MEDIUM
- **Category**: Missed opportunities (rare, high-emotion moment with no delight)
- **Estimated scope**: 3 files (component, CSS, test), ~70 lines

## Problem

Finishing a workout is the emotional peak of the product and it renders as
nothing. At `done`, `arcFraction` returns 0, so the progress arc's sweep path
retracts to invisible and the centrepiece is an empty track with `0:00`
standing in it. The only marks of completion are the backdrop turning orange
and the dock swapping to a Finish button.

```ts
// packages/client/src/lib/session.ts:271-275 — current
export const arcFraction = (state: SessionState, remainingMillis: number): number => {
  const durationMillis = currentSegmentDurationMillis(state)
  if (durationMillis <= 0) return 0
  return Math.max(0, Math.min(1, remainingMillis / durationMillis))
}
```

```tsx
// packages/client/src/components/player/progress-arc.tsx:341-354 — current
        <path
          data-testid="player-progress-arc-sweep"
          d={ARC_SWEEP_PATH}
          fill="none"
          stroke={PHASE_HUE[phase]}
          strokeWidth={ARC_STROKE}
          strokeLinecap="round"
          pathLength={ARC_SWEEP_LENGTH}
          strokeDasharray={ARC_SWEEP_LENGTH}
          strokeDashoffset={arcDashOffset(fraction)}
        />
```

This is the one place on this screen where the delight budget is allowed to be
spent: it happens once per workout, it is terminal, and nothing waits on it.

## Target

On `phase === 'done'` only, draw two extra paths on the same geometry:

1. **The fill.** The arc draws itself closed in `var(--primary)` over 700ms,
   growing from the right end of the chord, over the top, to the left — the
   same direction the depleting arc gathers its ink.
2. **The sheen.** A short bright dash rides the fill's growing tip and exits
   the far end as the fill completes.

```css
/* target */
.player-arc-complete {
  stroke-dasharray: var(--arc-sweep-length);
  animation: player-arc-complete 700ms var(--ease-player) forwards;
}
.player-arc-sheen {
  stroke-dasharray: 40 var(--arc-sweep-length);
  animation: player-arc-sheen 700ms var(--ease-player) forwards;
}
@keyframes player-arc-complete {
  from { stroke-dashoffset: var(--arc-sweep-length); }
  to   { stroke-dashoffset: 0; }
}
@keyframes player-arc-sheen {
  from { stroke-dashoffset: 0; }
  to   { stroke-dashoffset: var(--arc-sweep-length-negative); }
}
```

`--ease-player` is `cubic-bezier(0.22, 1, 0.36, 1)`, added by plan 001.

**700ms is over the 300ms UI budget on purpose.** The budget governs
interactive UI a user is waiting on. This fires once per workout, at the end,
with nothing behind it. Do not shorten it to fit a rule that does not apply
here, and do not lengthen it either.

Keyframes, not a transition, are correct here: `done` is terminal and fires
once, so there is nothing to interrupt or retarget.

Reduced motion draws the arc **full and static** — the completion mark stays,
the travel goes:

```css
@media (prefers-reduced-motion: reduce) {
  .player-arc-complete { animation: none; stroke-dashoffset: 0; }
  /* Hidden, not frozen: a stalled highlight would sit on the arc as a bug. */
  .player-arc-sheen { animation: none; display: none; }
}
```

### Why the dash maths is what it is

With `pathLength={ARC_SWEEP_LENGTH}`, offsets are in the same units as the
declared length, and a point `p` along the path is painted when
`(p + offset) mod (dash + gap)` falls inside the dash.

- **Fill** — `dasharray: L` means dash `L`, gap `L`. Offset `L` paints nothing;
  offset `0` paints the whole path. Animating `L → 0` grows the arc from the
  path's start. This matches `arcDashOffset` exactly
  (`progress-arc.tsx:120-123`), so the fill grows the way the countdown's ink
  gathers.
- **Sheen** — `dasharray: 40 L` puts a 40-unit dash at the path start when the
  offset is `0`, and at the path end when the offset is `-L`. Animating
  `0 → -L` walks it the length of the arc. Both animations share a duration and
  a curve, so the sheen's dash sits on the fill's growing tip throughout.

`ARC_SWEEP_LENGTH` is about 447.7 user units, so the 40-unit dash is roughly a
twelfth of the arc.

## Repo conventions to follow

- The arc's geometry constants are module-level and heavily commented in
  `packages/client/src/components/player/progress-arc.tsx:18-118`. Reuse
  `ARC_SWEEP_PATH`, `ARC_STROKE` and `ARC_SWEEP_LENGTH`; do not recompute them.
- Both new paths **must** use `strokeWidth={ARC_STROKE}`. A unit test asserts
  that every shape in the svg satisfies `ARC_RADIUS + strokeWidth / 2 ===
  BOX_WIDTH / 2` (`packages/client/test/player-progress-arc.test.tsx:178-185`).
  A thinner sheen would break that invariant for any future done-phase test.
- Phase colours come from the `PHASE_HUE` map only, never a hex literal
  (`packages/client/src/components/player/phase.ts:14-19`).
- Player CSS lives in `packages/client/src/index.css` under a comment block.
  Exemplar of a one-shot forwards animation:
  `.player-digit-out { animation: player-digit-out 450ms ... forwards; }` at
  `packages/client/src/index.css:203-205`.
- The `prefers-reduced-motion` block is the single shared one at
  `packages/client/src/index.css:310-326`. The `display: none` idiom for a
  frozen overlay is already used there (lines 316-321).
- Custom properties passed from React are set with `setProperty` and take no
  unit suffix, but pass them as **strings** to be certain.

## Steps

1. **Dependency**: plan 001 must be applied first — it introduces
   `--ease-player`. If it is missing, STOP and report.

2. In `packages/client/src/index.css`, add the completion block after the
   `.player-dot-pulse` block (after `@keyframes player-dot-shift`, currently
   ending at line 253):

   ```css
   /* Immersive player: the arc draws itself closed when the workout ends. At
      `done` the depleting sweep is empty, so the centrepiece would otherwise
      be a bare track — the one rare, terminal moment on this screen where the
      delight budget is worth spending. The fill grows from the right end of
      the chord over the top to the left, the direction the depleting ink
      gathers, and a short bright dash rides its growing tip and leaves at the
      far end. Both lengths arrive as custom properties from the component, so
      the geometry stays in one place. 700ms is past the UI budget on purpose:
      nothing waits on this. */
   .player-arc-complete {
     stroke-dasharray: var(--arc-sweep-length);
     animation: player-arc-complete 700ms var(--ease-player) forwards;
   }
   .player-arc-sheen {
     stroke-dasharray: 40 var(--arc-sweep-length);
     animation: player-arc-sheen 700ms var(--ease-player) forwards;
   }
   @keyframes player-arc-complete {
     from {
       stroke-dashoffset: var(--arc-sweep-length);
     }
     to {
       stroke-dashoffset: 0;
     }
   }
   @keyframes player-arc-sheen {
     from {
       stroke-dashoffset: 0;
     }
     to {
       stroke-dashoffset: var(--arc-sweep-length-negative);
     }
   }
   ```

3. In the shared `@media (prefers-reduced-motion: reduce)` block
   (`packages/client/src/index.css:310`), add:

   ```css
   /* The completion mark stays; only its travel goes. */
   .player-arc-complete {
     animation: none;
     stroke-dashoffset: 0;
   }
   /* Hidden, not merely frozen: a stalled highlight would sit on the finished
      arc as a bright wedge. */
   .player-arc-sheen {
     animation: none;
     display: none;
   }
   ```

4. In `packages/client/src/components/player/progress-arc.tsx`, inside the
   `<svg>` and **after** the existing `player-progress-arc-sweep` path
   (currently ending at line 353), add the two done-only paths:

   ```tsx
        {phase === 'done' && (
          <>
            <path
              data-testid="player-progress-arc-complete"
              className="player-arc-complete"
              d={ARC_SWEEP_PATH}
              fill="none"
              stroke={PHASE_HUE.done}
              strokeWidth={ARC_STROKE}
              strokeLinecap="round"
              pathLength={ARC_SWEEP_LENGTH}
            />
            <path
              data-testid="player-progress-arc-sheen"
              className="player-arc-sheen"
              d={ARC_SWEEP_PATH}
              fill="none"
              stroke="rgb(255 255 255 / 0.55)"
              strokeWidth={ARC_STROKE}
              strokeLinecap="round"
              pathLength={ARC_SWEEP_LENGTH}
            />
          </>
        )}
   ```

5. In the same file, pass the two lengths to the `<svg>` as custom properties
   so the CSS can read them. Change the opening svg tag (currently line 337,
   `<svg viewBox={ARC_VIEW_BOX} className="size-full" aria-hidden="true">`) to:

   ```tsx
       <svg
         viewBox={ARC_VIEW_BOX}
         className="size-full"
         aria-hidden="true"
         style={
           {
             '--arc-sweep-length': String(ARC_SWEEP_LENGTH),
             '--arc-sweep-length-negative': String(-ARC_SWEEP_LENGTH),
           } as CSSProperties
         }
       >
   ```

   Add `CSSProperties` to the existing type-only React import at the top of the
   file (currently `import type { JSX, ReactNode, RefObject } from 'react'`).

6. Extend the component's doc comment (currently
   `packages/client/src/components/player/progress-arc.tsx:311-330`) with a
   sentence recording the new behaviour, in the file's existing voice:

   ```
    * At `done` the sweep is empty, so the arc draws itself closed instead: a
    * one-shot fill in the done hue with a bright dash riding its growing tip.
    * Both player screens share it — the manual timer ends the same way.
   ```

7. In `packages/client/test/player-progress-arc.test.tsx`, add a test to the
   existing `describe` block. Imitate the file's existing structure (the
   `handle()` and `shapes()` helpers and the `sceneRegistry.register` spy are
   already defined at the top):

   ```tsx
     it('draws the closing arc and its sheen only when the workout is done', () => {
       vi.spyOn(sceneRegistry, 'register').mockReturnValue(handle())

       render(
         <ProgressArc fraction={0} phase="work">
           <span>0:00</span>
         </ProgressArc>,
       )
       expect(screen.queryByTestId('player-progress-arc-complete')).toBeNull()
       cleanup()

       render(
         <ProgressArc fraction={0} phase="done">
           <span>0:00</span>
         </ProgressArc>,
       )
       // The track, the (empty) sweep, the closing fill and its sheen — all
       // on the one path, so the geometry has a single source.
       const drawn = shapes()
       expect(drawn).toHaveLength(4)
       const sweep = screen.getByTestId('player-progress-arc-sweep').getAttribute('d')
       for (const shape of drawn) {
         expect(shape.getAttribute('d')).toBe(sweep)
         expect(Number(shape.getAttribute('stroke-width'))).toBe(
           Number(screen.getByTestId('player-progress-arc-sweep').getAttribute('stroke-width')),
         )
       }
     })
   ```

## Boundaries

- Do NOT change `arcFraction` (`packages/client/src/lib/session.ts:271`), the
  `arcDashOffset` helper, or the existing `player-progress-arc-sweep` path. The
  depleting arc must stay exactly as it is.
- Do NOT change `ARC_SWEEP_PATH`, `ARC_STROKE`, `ARC_RADIUS`,
  `ARC_SWEEP_LENGTH`, `ARC_INNER_SHARE` or the viewBox.
- Do NOT make the sheen loop. It runs once, `forwards`, and stops.
- Do NOT add a second sheen pass, a glow, a `filter`, or a scale on the arc.
- Do NOT gate this to the live session only. `ProgressArc` is the shared player
  kit and the manual timer at `/timer` reaches `done` through the same
  component; both screens getting the same ending is intended.
- Do NOT touch the digits, the dock, or `SessionDock`'s "Workout complete" line.
- Do NOT add new dependencies.
- If the code at a cited line does not match the excerpt above, STOP and report.

## Verification

- **Mechanical**:
  - `bun run check` — passes.
  - `bun run lint` — passes.
  - `bun run test` — passes, including the new test and the existing
    "draws the track over the sweep only" test at
    `packages/client/test/player-progress-arc.test.tsx:186-204`, which renders
    `phase="work"` and must still see exactly 2 shapes.
  - `bun run build` — passes.
- **Feel check**: run the app and reach the end of a workout (the fastest route
  is `/timer` with 5s work / 0s rest / 1 round, which uses the same component):
  - The arc draws itself closed from the **right** end of the chord, over the
    top, ending at the left. If it grows from the left, the dash direction is
    inverted — report it.
  - The bright dash rides the tip of the growing fill and leaves at the far end
    exactly as the fill lands. If the dash arrives early, late, or crosses an
    already-filled arc, the two animations are out of step.
  - The fill **stays** on screen afterwards. If it snaps back to empty, the
    `forwards` fill mode is missing.
  - It plays **once**. Watch for ten seconds after completion — no repeat, no
    flicker.
  - In DevTools → Animations at 10% playback, step through it: the arc should
    read as one continuous stroke being laid down, never as a dashed line
    resolving into a solid one. A visible second dash means `stroke-dasharray`
    on the fill path is wrong.
  - Check both screens: `/timer` and a live session. They must end identically.
  - DevTools → Rendering → "Emulate prefers-reduced-motion: reduce": the arc
    appears **already full** in the done hue, with no travel and no white dash
    anywhere on it.
- **Done when**: completing a workout on either player screen draws the arc
  closed once in the done hue, with a highlight that rides its tip and exits,
  and the finished arc stays on screen.
