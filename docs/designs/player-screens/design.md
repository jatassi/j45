# Design — player-screens

The redesigned live-session player (`/session/$sessionId`) and manual timer
(`/timer`). Layout: the **immersive** variant chosen by eye in the
Design-phase prototype session (`src/proto/player-b.tsx` is the visual
reference until the proto is deleted): no hero card — the countdown floats
directly on a phase-tinted backdrop inside a depleting progress ring, with a
compact glass control dock at the bottom. Depends on `glass-live-refraction`
(tier answer + scene registry) and `session-leave` (the leave rpc); reuses
the player kit (`src/player/`) and the session feed atoms unchanged.

## Session player layout (push layout, no tab bar, player owns the screen)

- **Phase-tinted backdrop**: full-bleed radial tint + slow CSS-only pulse in
  the phase hue — work `--hue-work` (green), rest `--hue-rest` (amber),
  ready/countdown-in `--hue-cardio` (sky), done → signature orange. Guarded by
  `prefers-reduced-motion`. The backdrop registers as a scene proxy so glass
  picks it up.
- **Top strip**: **Leave** control top-left (distinct rose tint, door/exit
  icon) — opens an `alert-dialog` confirm mid-workout ("Leave workout? Your
  progress is saved to history"), calls `LeaveSession`, navigates home. The
  audio-state indicator sits top-right (`data-audio` contract unchanged).
  Center: LIVE eyebrow + workout name + round context.
- **Center stack**: phase eyebrow with hue dot; the countdown — the single
  most important element, huge `tabular-nums` display digits readable at
  arm's length from the floor — wrapped in a thin SVG **progress ring** that
  depletes across the current segment (driven from the same interpolated
  `remainingMillis` the digits use, `stroke-dashoffset`, no extra timers);
  exercise name (heavy heading) + station/pod context line beneath.
- **Demo chip**: a small inline media chip below the ring — the reserved
  slot for future exercise animations. Renders the exercise `detail` text (or
  nothing gracefully) today; the slot must not look broken while empty.
- **Progress dots**: per-pod segment dot clusters (today's `ProgressGrid`
  content, restyled) — completed / active (phase hue, throb) / upcoming.
- **Participant pills**: avatar-initial pills for each `participants` entry.
- **Bottom glass dock**: NEXT UP line ("Next · Sit-up", from the compiled
  segment sequence) above the control row — Prev / Pause·Resume / Skip, round
  buttons, center primary 64px+, sides 48px+. The dock is glass chrome; it
  may sit over the digits area on short screens, which is exactly the
  scene-registry dirty-texture case — the countdown registers as a
  dirty-region proxy. If the phone perf gate capped glass mid-workout, the
  dock mounts with `maxTier: 'css'` while the timer runs.
- **States**: paused → digits keep last interpolated value, ring frozen,
  backdrop desaturates, Resume primary. Done → orange tint, workout summary,
  **Finish** button (calls `LeaveSession`, no confirm — nothing is lost).
  Reconnecting → dimmed overlay chip on the same layout (existing
  `SessionFeed` reconnecting state). Ended (host of the last leave already
  gone / GC) → existing navigate-home-with-notice behavior, restyled as a
  toast.

Beeps, wake lock, and countdown interpolation are the player kit's, unchanged
(`unlockAudio` synchronously in the join/start tap; `useWakeLock(running)`;
`useCountdown` with second-transition cues).

## Manual timer (`/timer`)

Same visual language, minus session concerns:

- **Idle**: work / rest / rounds as kit `field` inputs (stepper affordances,
  numeric keyboards) replacing the three native number inputs; Start unlocks
  audio in-tap.
- **Running**: identical center stack (phase tint, ring, digits, round
  indicator instead of pod dots), bottom dock with Pause·Resume / Reset. No
  participants, no leave confirm (Reset returns to idle in place), no next-up
  line — the round indicator carries position.
- Runs fully client-side on the synthetic manual workout (`buildManualWorkout`)
  — no new rpc or server surface, as pinned by the manual-timer feature.

## e2e impact

`live-session.spec.ts` and `timer.spec.ts` update selectors and add: the leave
confirm flow (A leaves → B's participant list shrinks; B leaves → session
ends), the done-state Finish-as-leave, and ring/phase-attribute assertions
(`data-phase` on the player root). Audio/wake-lock instrumented assertions
carry over unchanged.
