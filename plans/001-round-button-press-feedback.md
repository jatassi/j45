# 001 — Give the live session's round controls press feedback

- **Status**: TODO
- **Commit**: 4bbd91e
- **Severity**: HIGH
- **Category**: Physicality & origin (press feedback) / Missed opportunities
- **Estimated scope**: 2 files (1 CSS token block, 1 component), ~15 lines

## Problem

The live workout view's controls have **no `:active` state at all**. A tap on
Pause dispatches a command to the server and waits for the next snapshot to
come back over the watch stream before anything on screen changes. Until then
the screen is identical to before the tap. A participant mid-exercise cannot
tell whether the phone registered the touch.

`RoundButton` builds the Prev / Pause·Resume / Skip row and sets no pressed
styling:

```tsx
// packages/client/src/components/session-player-parts.tsx:169-176 — current
      className={cn(
        'flex items-center justify-center rounded-full disabled:opacity-40',
        primary
          ? 'size-16 bg-primary text-primary-foreground shadow-[0_10px_40px_-8px_var(--primary)]'
          : 'size-12 bg-foreground/5 text-foreground/70 ring-1 ring-border',
      )}
```

Two more raw `<button>` elements on the same screen have the same gap:

```tsx
// packages/client/src/components/session-player-parts.tsx:232 — current (LeaveDialog trigger)
      className="flex size-11 items-center justify-center rounded-full bg-destructive/15 text-destructive ring-1 ring-destructive/30"
```

```tsx
// packages/client/src/components/session-player-parts.tsx:272 — current (AudioIndicator)
      className="flex size-11 items-center justify-center rounded-full text-muted-foreground"
```

For contrast, the shared `Button` component **does** have press feedback
(`active:not-aria-[haspopup]:translate-y-px`, `packages/client/src/components/ui/button.tsx:7`).
These three hand-rolled buttons simply never got it.

## Target

A subtle scale-down on `:active`, sized to the control. Exact values:

```css
/* target — primary (size-16) Pause/Resume */
:active { transform: scale(0.95); }
transition: transform var(--duration-state) var(--ease-player);

/* target — the size-12 Prev/Skip, the size-11 Leave and Audio controls */
:active { transform: scale(0.97); }
transition: transform var(--duration-state) var(--ease-player);
```

`--duration-state` is 150ms, inside the 100–160ms press-feedback budget.
`--ease-player` is the new token added in step 1 below.

Timing is **symmetric** (the same 150ms in and out) on purpose. Asymmetric
press timing belongs to deliberate *hold* gestures (hold-to-confirm fills),
not to a single tap. Do not add an asymmetric variant.

Reduced motion keeps a gentler press rather than removing it — this is
feedback, not decoration:

```css
@media (prefers-reduced-motion: reduce) {
  .player-press:active,
  .player-press-lg:active {
    transform: scale(0.98);
  }
}
```

## Repo conventions to follow

- Motion tokens live in **two** places in `packages/client/src/index.css` and
  must be kept in step: the `@theme inline` block (lines 7–59) and the `:root`
  block (lines 61–117). `--duration-state`, `--duration-enter` and `--ease-out`
  are already declared in both (lines 56–58 and 114–116). Add the new token to
  both, in the same position.
- **Do not redefine `--ease-out`.** It is declared inside `@theme inline`, so in
  Tailwind v4 it backs the built-in `ease-out` utility used across the whole
  app. Changing it would silently re-time every unrelated component. Add a new
  token instead.
- Player-specific CSS classes are named `player-*` and live in
  `packages/client/src/index.css` with a comment block above them. Exemplar:
  `.player-digit-in` at `packages/client/src/index.css:200-202`.
- In Tailwind class strings, custom easings are written as arbitrary values.
  Exemplar: `ease-[cubic-bezier(0.22,1,0.36,1)]` at
  `packages/client/src/components/ui/drawer.tsx:101`.
- The `prefers-reduced-motion` block is a single shared block at
  `packages/client/src/index.css:310-326`. Add to it; do not create a second one.

## Steps

1. In `packages/client/src/index.css`, add the house easing token to the
   `@theme inline` block, immediately after the `--ease-out: ease-out;` line
   (currently line 58):

   ```css
   /* The player's strong ease-out, already hand-written at .player-digit-in
      and in ui/drawer.tsx. Tokenised so the curve has one definition. */
   --ease-player: cubic-bezier(0.22, 1, 0.36, 1);
   ```

2. Add the identical line to the `:root` block, immediately after
   `--ease-out: ease-out;` (currently line 116).

3. In `packages/client/src/index.css`, replace the two hardcoded curves so the
   token has no near-duplicate. Line 201 becomes:

   ```css
   .player-digit-in {
     animation: player-digit-in 450ms var(--ease-player);
   }
   ```

   and line 204 becomes:

   ```css
   .player-digit-out {
     animation: player-digit-out 450ms var(--ease-player) forwards;
   }
   ```

   Do **not** touch `packages/client/src/components/ui/drawer.tsx` — the drawer
   is out of scope for this plan.

4. In `packages/client/src/index.css`, add the press classes after the
   `.player-digit-*` block (after the `@keyframes player-digit-out` rule that
   currently ends at line 217), with a comment in the style of the surrounding
   blocks:

   ```css
   /* Immersive player: the hand-rolled round controls (Prev, Pause·Resume,
      Skip, Leave, Audio) depress on touch. A session command travels to the
      server and back before the screen changes, so without this the tap has
      no acknowledgement at all. `-lg` is the >=64px primary, which carries a
      little more travel because the target is bigger. */
   .player-press,
   .player-press-lg {
     transition: transform var(--duration-state) var(--ease-player);
   }
   .player-press:active {
     transform: scale(0.97);
   }
   .player-press-lg:active {
     transform: scale(0.95);
   }
   ```

5. In the shared `@media (prefers-reduced-motion: reduce)` block
   (`packages/client/src/index.css:310`), add — keeping the press, only
   reducing its travel:

   ```css
   /* Kept, not removed: this is touch acknowledgement, not decoration. */
   .player-press:active,
   .player-press-lg:active {
     transform: scale(0.98);
   }
   ```

6. In `packages/client/src/components/session-player-parts.tsx`, add the class
   to `RoundButton`'s `cn(...)` call (currently lines 169-176):

   ```tsx
       className={cn(
         'flex items-center justify-center rounded-full disabled:opacity-40',
         primary
           ? 'player-press-lg size-16 bg-primary text-primary-foreground shadow-[0_10px_40px_-8px_var(--primary)]'
           : 'player-press size-12 bg-foreground/5 text-foreground/70 ring-1 ring-border',
       )}
   ```

7. In the same file, add `player-press` to the `LeaveDialog` trigger's class
   string (currently line 232), as the first class:

   ```tsx
       className="player-press flex size-11 items-center justify-center rounded-full bg-destructive/15 text-destructive ring-1 ring-destructive/30"
   ```

8. In the same file, add `player-press` to `AudioIndicator`'s class string
   (currently line 272), as the first class:

   ```tsx
       className="player-press flex size-11 items-center justify-center rounded-full text-muted-foreground"
   ```

## Boundaries

- Do NOT change `packages/client/src/components/ui/button.tsx` — the shared
  `Button` already has press feedback and is used on many other screens.
- Do NOT change `packages/client/src/components/ui/drawer.tsx`.
- Do NOT redefine `--ease-out`.
- Do NOT touch `packages/client/src/components/design/sections.tsx` — it is a
  read-only showcase of the tokens; leaving it listing three tokens is fine.
- Do NOT change any markup, structure, handler, `data-testid` or `aria-label`.
  Class strings and the two CSS blocks only.
- Do NOT add a `:hover` state. These are touch targets on a phone held
  mid-workout; `:hover` fires falsely on tap.
- Do NOT add new dependencies.
- If the code at a cited line does not match the excerpt above (drift since
  commit 4bbd91e), STOP and report rather than improvising.

## Verification

- **Mechanical**:
  - `bun run check` — passes, no new type errors.
  - `bun run lint` — passes.
  - `bun run test` — passes. `packages/client/test/session-screen.test.tsx:282`
    clicks `session-pause`; class changes must not affect it.
- **Feel check**: run the app, start a live session, and on the player screen:
  - Press and hold Pause. The button shrinks slightly and **stays** shrunk
    while held; it returns on release. The shrink is small enough that the
    icon does not visibly blur or jump.
  - Press Prev and Skip. They shrink less than Pause does, and the three
    buttons do not appear to move by different *amounts of distance* — the
    larger button scaling further is what makes them look consistent.
  - Press and drag your finger off the button before releasing. The button
    returns to rest smoothly, it does not snap.
  - Go offline (DevTools → Network → Offline). The buttons become
    `disabled`; confirm a press produces **no** scale — a disabled control must
    not acknowledge a tap it will not act on.
  - In DevTools → Animations, set playback speed to 10% and press Pause:
    confirm the scale runs on `transform` only, with no layout shift of the
    dock or the row around it.
  - DevTools → Rendering → "Emulate prefers-reduced-motion: reduce": the press
    still visibly depresses, just less. It must not be gone.
- **Done when**: all five controls (`session-prev`, `session-pause`/
  `session-resume`, `session-skip`, `session-leave`, `session-audio-indicator`)
  depress on touch; `--ease-player` is declared in both token blocks; and no
  hardcoded `cubic-bezier(0.22, 1, 0.36, 1)` remains in
  `packages/client/src/index.css`.
