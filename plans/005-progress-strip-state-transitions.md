# 005 — Fade the progress strip's marks between states

- **Status**: TODO
- **Commit**: 4bbd91e
- **Severity**: LOW
- **Category**: Missed opportunities (preventing a jarring change)
- **Estimated scope**: 1 file, ~4 lines

## Problem

Every bar, cell and dot on the progress strip changes colour in a single frame
as the workout advances. `upcoming` → `active` → `done` is a class swap with no
transition, so the strip blinks under the arc at each station boundary.

```tsx
// packages/client/src/components/player/progress-strip.tsx:10-14 — current
const FILL: Record<CellState, string> = {
  done: 'bg-primary/50',
  active: 'bg-primary',
  upcoming: 'bg-input/60',
}
```

```tsx
// packages/client/src/components/player/progress-strip.tsx:52-59 — current
        Array.from(bar.cells, (state, cell) => (
          <span
            key={cell}
            data-testid={`session-strip-cell-${index}-${cell}`}
            data-state={state}
            className={cn('min-w-0 flex-1', FILL[state])}
          />
        ))
```

```tsx
// packages/client/src/components/player/progress-strip.tsx:121-132 — current
        {Array.from(strip.dots, (state, round) => (
          <span
            key={round}
            data-testid={`session-strip-dot-${round}`}
            data-state={state}
            className={cn(
              'size-2.5 rounded-full',
              state === 'active' && 'player-dot-pulse',
              FILL[state],
            )}
          />
        ))}
```

This is the lowest-leverage item on the list and close to free. The strip is
peripheral — a participant glances at it, they do not read it precisely — so
softening the change costs nothing in legibility.

## Target

A 150ms colour transition on the marks:

```css
/* target, expressed as Tailwind utilities on each mark */
transition: background-color var(--duration-state) var(--ease-out);
```

`--duration-state` is 150ms. `--ease-out` here is the repo's existing token
(the built-in `ease-out`), which is the right easing for a colour change and
does **not** need the stronger `--ease-player` curve.

Reduced motion **keeps** this: it is a colour change with no movement.

## Repo conventions to follow

- The repo writes Tailwind utilities with arbitrary values for tokens.
  Exemplar: `ease-[cubic-bezier(0.22,1,0.36,1)]` at
  `packages/client/src/components/ui/drawer.tsx:101`. Tailwind v4 has no
  `duration-*` theme namespace, so the token must be written as an arbitrary
  value — `duration-[var(--duration-state)]` — not as `duration-state`.
- Classes are composed through `cn(...)` from `@/lib/utils`. Add the transition
  classes to the existing `cn(...)` call, not to the `FILL` map — `FILL` is
  documented as "the three states as a fill" and must stay a pure colour map.

## Steps

1. In `packages/client/src/components/player/progress-strip.tsx`, add the
   transition to the bar's solid fill span (currently line 50):

   ```tsx
         {bar.cells.length === 0 ? (
           <span
             className={cn(
               'flex-1 transition-colors duration-[var(--duration-state)] ease-[var(--ease-out)]',
               FILL[bar.state],
             )}
           />
   ```

2. Add the same classes to the cell span (currently line 57):

   ```tsx
             className={cn(
               'min-w-0 flex-1 transition-colors duration-[var(--duration-state)] ease-[var(--ease-out)]',
               FILL[state],
             )}
   ```

3. Add the same classes to the dot span (currently lines 125-131):

   ```tsx
             className={cn(
               'size-2.5 rounded-full transition-colors duration-[var(--duration-state)] ease-[var(--ease-out)]',
               state === 'active' && 'player-dot-pulse',
               FILL[state],
             )}
   ```

4. Add a sentence to the `FILL` doc comment (currently
   `packages/client/src/components/player/progress-strip.tsx:5-9`) recording
   why the marks still never fill part-way:

   ```
    * The change between two states eases over `--duration-state`, but the
    * states themselves stay three: a mark is done, now or ahead, and the ease
    * is a colour crossing, not a part-way fill.
   ```

5. Do **not** add anything to the `prefers-reduced-motion` block.

## Boundaries

- Do NOT change the `FILL` map's colours or turn it into a class-plus-transition
  map.
- Do NOT add a transition to `width`, `flex`, `gap` or any layout property. The
  strip's widths come from `STRIP_BUDGET` maths and must land instantly.
- Do NOT touch `.player-dot-pulse` or its keyframes. Note that while a dot is
  `active`, the `player-dot-shift` keyframes animate `background-color` and
  therefore override this transition — that is expected; the transition applies
  when the dot leaves `active` for `done`.
- Do NOT touch `packages/client/src/lib/session.ts` or `progressStrip`.
- Do NOT add new dependencies.
- If the code at a cited line does not match the excerpt above, STOP and report.

## Verification

- **Mechanical**:
  - `bun run check` — passes.
  - `bun run lint` — passes.
  - `bun run test` — passes. Existing tests assert `data-state` attributes, not
    classes, so they are unaffected; confirm that is still true.
- **Feel check**: run the app, start a live session with short segments, and:
  - Watch the strip as a station completes. The cell's colour crosses rather
    than blinks, and the crossing is quick enough that you would not describe
    the strip as "animating".
  - Confirm **no bar changes width or position** during the transition. If
    anything slides horizontally, `transition-colors` has been widened to
    `transition-all` — revert it.
  - Watch the active round dot as its round finishes. Its pulse stops and its
    fill settles to the done colour without a jump.
  - Skip forward rapidly. The colours retarget mid-transition and never queue
    up or lag behind the arc.
  - DevTools → Rendering → "Emulate prefers-reduced-motion: reduce": the colour
    crossing must still happen.
- **Done when**: bars, cells and dots cross between states over 150ms with no
  layout movement anywhere on the strip.
