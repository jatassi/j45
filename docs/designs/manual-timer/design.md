# manual-timer — design

## What it is

A quick ad-hoc interval countdown — work seconds, rest seconds, round count —
run entirely on this phone, for warm-ups and improvised intervals. Legacy
parity: the "Timer" tab in diet-f45 (`public/app.js:300-351`), minus its bugs.
No server involvement beyond serving the page: no session, no persistence, no
rpc traffic while running.

This feature also **owns the client player kit** — the audio, wake-lock, and
countdown primitives under `packages/client/src/player/` that `live-session`
reuses for the synced player (a recorded cross-feature contract in
`docs/architecture.md`). It is deliberately the first player-shaped feature to
build: the kit gets proven on the simple local case before the streaming one.

## How it fits

- Depends only on `workout-domain`: the timer is the domain timer machinery
  (`timer.ts`) driven by the domain compiler (`segments.ts`) over a synthetic
  workout. No new domain types, no new rpcs, no schema or migration changes.
- New route `/timer` in the authenticated route tree (`router.tsx`), reached
  from a nav link on the library home. Accounts are required for everything
  (architecture), so there is no logged-out timer.

## The synthetic workout

A pure helper in `packages/client/src/lib/manual-workout.ts` builds a
schema-valid `Workout` from the three inputs and hands it to the domain
`compile` — the timer never reimplements sequencing:

```ts
// work=40, rest=20, rounds=9 →
new Workout({
  name: 'Manual timer',
  focus: 'hybrid',
  pods: [new Pod({ name: 'Timer', stations: [new Station({ name: 'Work' })] })],
  flow: new Flow({
    type: 'sets',
    rounds: [/* rounds × */ new Round({ workSeconds: 40, restSeconds: 20 })],
  }),
})
```

`compile` then yields exactly: one `ready` (5s), then `rounds` work segments
with a rest between consecutive rounds and **no rest after the final work**
(`restSeconds: 0` rounds get no rest segment at all). This is a deliberate,
small parity *improvement*: the legacy manual timer ran the rest after the
last round before showing Done, and had no ready lead-in — the new one behaves
exactly like a guided session, because it literally runs the same compiler.

## Driving the timer

The domain `TimerState` union and its transitions (`start`, `advanceIfDue`,
`pause`, `resume`, `quit`, `remainingMillis`, `nextTransitionAt`) run
client-side against `Date.now()`. The driver is the documented contract in
`timer.ts`: schedule a `setTimeout` for `nextTransitionAt`, call `advanceIfDue`
when it fires (it catches up across multiple boundaries if the tab slept), and
re-render. Display smoothness comes from the shared countdown hook (below),
not from state ticks. Skip/prev are not surfaced — parity: the legacy manual
timer had only Start/Pause/Resume/Reset, and extra is a failure like missing.

Controls: **Start** (reads inputs, enters ready), **Pause/Resume** toggle,
**Reset** (back to idle with inputs re-read). Inputs: work seconds (min 5),
rest seconds (min 0), rounds (min 1) — defaults 40 / 20 / 9, matching legacy.
Display: phase label (Get ready / Work / Rest / Done), the `M:SS` count
(`formatDuration`), and a context line at legacy parity: the settings summary
while idle (`9 rounds · 40″/20″`), `Round k of N` during work *and* rest
(rest shows the round about to start, from `RestSegment.nextWork.round`),
`Nice work` when done.

## The player kit (`packages/client/src/player/`)

Shared primitives, built here, consumed by `live-session`. All three are
UI-framework-thin: plain modules plus small hooks, unit-testable in vitest.

- **`audio.ts`** — beeps. **The legacy beeps are broken in practice (owner
  report), so this is a fix, not a port.** Design: one lazily-created
  `AudioContext`; `unlockAudio()` is called synchronously inside the explicit
  tap that enters a player (Start here; start/join in live-session) — never
  from passive document-level listeners, which is where legacy went wrong on
  iOS; `resume()` is re-attempted on `visibilitychange` and immediately
  before every beep. The module exposes its state (`running` | `blocked`) and
  the player surfaces it as a visible muted/sound indicator (tappable to
  retry unlock) plus a `data-audio` attribute so e2e can assert it. Beep
  vocabulary keeps the legacy tones: work 880Hz, rest 440Hz, ready 523Hz,
  done = rising three-note (660/880/1046), plus 3-2-1 countdown beeps in the
  last three seconds of every segment (legacy's rising `600 + (4−sec)·120` Hz).
  The `data-audio` attribute's values are exactly `"on"` (context running)
  and `"blocked"` — the strings the acceptance criteria assert.
- **`wake-lock.ts`** — a `useWakeLock(active: boolean)` hook wrapping
  `navigator.wakeLock`: request while active, release when not, re-acquire on
  `visibilitychange` while active. Absence of the API is silently tolerated.
- **`use-countdown.ts`** — `useCountdown(deadlineMillis | null)`: one
  `requestAnimationFrame` loop interpolating the remaining time for smooth
  display, emitting whole-second transitions (the hook is where the 3-2-1
  countdown beeps and segment-boundary beeps are triggered from). Timer
  *state* never advances here — display only.
There is no formatter in the kit: the count reuses the existing shared
`formatDuration` (`packages/client/src/lib/workouts.ts`) — unpadded `M:SS`
by ceil, the codebase's established display convention (`0:05`, `26:45`);
do not reintroduce legacy's zero-padded `00:05`.

What is deliberately **not** shared: the screen itself. The manual timer's
display (phase/count/round) and live-session's player (exercise, next-up,
context line, progress cells) are separate components; sharing a view shell
between them would couple two features for cosmetics.

## Testing

- **Unit (vitest):** `manual-workout.ts` — the synthetic workout is
  schema-valid and compiles to the exact expected segment sequence and total
  for representative inputs, including `rest = 0` (no rest segments at all).
  `audio.ts` state transitions and `use-countdown.ts` under fake rAF/clock.
- **e2e (chromium + webkit):** `/timer` via the home nav link; run a short
  timer (e.g. 5s work / 0 rest / 2 rounds) through ready → work → done;
  pause freezes the display, resume continues, reset returns to idle. Web
  Audio instrumented via init script (the glass suite's
  `getContext`-wrapping precedent) to assert beeps actually fire on segment
  transitions after the Start tap, and `navigator.wakeLock` instrumented to
  assert acquire-while-running and release on pause and on Done. The spec
  gets its logged-in account the way every suite does: its own invite pool
  registered in `e2e/global-setup.ts` (see `e2e/support/state.ts`).

## Notes for the builder

- The timer must keep correct time through tab sleeps: `advanceIfDue` is
  written for exactly that (chained deadlines, multi-segment catch-up) — the
  driver must always recompute from `Date.now()` on wake, never count ticks.
- Audio unlock must be in the same synchronous event handler as the Start
  tap. Do not defer it behind an await before first use.
- Keep the player kit free of any live-session imports — the dependency
  points the other way.
