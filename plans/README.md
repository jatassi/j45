# Animation plans — the live workout view

Plans produced by `improve-animations` for `/session/$sessionId`
(`packages/client/src/components/session-screen.tsx` and the shared player kit
in `packages/client/src/components/player/`).

All were written against commit `4bbd91e`. Each plan is self-contained: exact
files, exact values, exact verification. None of them may be started before its
dependencies are applied.

## Plans

| # | Title | Severity | Depends on | Status |
| --- | --- | --- | --- | --- |
| [001](001-round-button-press-feedback.md) | Give the live session's round controls press feedback | HIGH | — | TODO |
| [002](002-pause-desaturation-transition.md) | Ease the backdrop's pause desaturation instead of snapping it | MEDIUM | 001 | TODO |
| [003](003-phase-tint-crossfade.md) | Cross-fade the backdrop tint across phase changes | MEDIUM | 001, 002 | TODO |
| [004](004-completion-arc-sweep.md) | Draw the arc closed when the workout completes | MEDIUM | 001 | TODO |
| [005](005-progress-strip-state-transitions.md) | Fade the progress strip's marks between states | LOW | — | TODO |

## Recommended order

**001 → 002 → 003 → 004 → 005.**

- **001 is the gate.** It adds `--ease-player`
  (`cubic-bezier(0.22, 1, 0.36, 1)`) to both token blocks in
  `packages/client/src/index.css` and retires the two hardcoded copies of that
  curve. Plans 002, 003 and 004 all consume the token and will stop if it is
  missing.
- **002 before 003.** Both write the `transition` declaration on
  `.player-phase-backdrop`; 003 extends the one 002 adds. Applied out of order
  they will conflict on the same line.
- **004 is independent of 002/003** once 001 has landed, so it can run in
  parallel with them if you are dispatching more than one executor. It is the
  only plan that touches `progress-arc.tsx` and the only one that adds a test.
- **005 depends on nothing** and touches one file no other plan touches. Run it
  whenever.

Only 001 and 004 change behaviour a user would name. 002, 003 and 005 are
polish that is felt together and not noticed apart.

## Shared facts an executor should know

- `--ease-out`, `--duration-state` and `--duration-enter` are declared in
  `packages/client/src/index.css` **twice** — once in `@theme inline`
  (lines 7–59) and once in `:root` (lines 61–117). Keep the two blocks in step.
- Before these plans, those three tokens had **no consumers** outside the design
  showcase at `packages/client/src/components/design/sections.tsx:56`. These
  plans are their first real use.
- Never redefine `--ease-out`. It sits inside `@theme inline`, so it backs
  Tailwind's built-in `ease-out` utility across the whole app.
- Tailwind v4 has no `duration-*` theme namespace. Write durations as arbitrary
  values: `duration-[var(--duration-state)]`.
- There is one shared `@media (prefers-reduced-motion: reduce)` block, at
  `packages/client/src/index.css:310-326`. Add to it; never open a second one.
- The live player re-renders every animation frame — `useCountdown`
  (`packages/client/src/player/use-countdown.ts`) drives a rAF loop into React
  state for the whole session. **Every plan here is CSS-only motion for that
  reason.** Do not add JS-driven animation to this screen.

## Rejected — do not implement

These were considered and deliberately not planned. If a future change proposes
one, the reason it was rejected is here.

- **A looping shimmer inside the progress arc.** The arc is the functional
  readout, on screen continuously for 30–45 minutes. A permanent travelling
  highlight is decoration on data, and an animated SVG stroke gradient repaints
  the path every frame over the canvas glass compositor. The shimmer is spent
  once instead, at completion — plan 004.
- **Easing the arc's refill at each segment boundary.** The arc's only job is
  to be true about remaining time; a transition would put it out of step with
  the digits inside it.
- **Cross-fading the station name in `WorkMeta`.** That name is the
  instruction. It must be readable on the frame the phase changes.
- **A pulse on the arc for the final five seconds.** Every segment, tens of
  times per workout. The digit colour glide and the 3-2-1 beeps already carry
  it.
- **An enter transition on `ReconnectingChip`.** This is a layout defect, not a
  motion one: the chip is a flex child of the main column
  (`packages/client/src/components/session-screen.tsx:212`), so it shoves the
  arc and countdown down the screen when it appears. Take it out of flow first;
  a fade is only worth adding after that.
