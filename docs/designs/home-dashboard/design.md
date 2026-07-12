# Design — home-dashboard

The redesigned Home tab at `/` — an action-first "start something" dashboard.
Layout: the **hero-first** variant chosen by eye in the Design-phase prototype
session (`src/proto/home-a.tsx` is the visual reference until the proto is
deleted; screenshots live in the session record). Builds on `design-system` +
`nav-shell`; no domain/server changes — everything composes existing rpcs.

## Layout (top to bottom, inside the tab layout's glass header/tab bar)

1. **Hero card** — one dominant card owning the fold; its content is
   priority-picked:
   - **Live session** (someone in the circle is mid-workout): sport-tinted
     card (hue from the workout focus) with a pulsing LIVE dot, workout name
     as the heavy display heading, "«host» is hosting", elapsed/participant
     meta line, and a full-width signature-orange **Join now** button →
     `/session/$id`. Data: the existing `ListActiveSessions` 5s poll pattern
     (today's `ActiveSessionsStrip` atom). Multiple live sessions: the hero
     shows the newest; others render as compact rows directly beneath it.
   - **Start last** (no live session, history non-empty): the caller's most
     recent completion (`ListHistory` head), resolved to a library workout by
     case-insensitive name match against `ListWorkouts`; hero shows the
     workout with a **Start** button (`StartSession`). If the name no longer
     resolves (renamed/deleted), fall through.
   - **Browse fallback** (fresh account / nothing to resume): hero promotes
     the library — first seed workout with Start, plus a "Browse library"
     link. The dashboard must never render an empty fold.
2. **Quick start row** — three equal action tiles: **Timer** (`/timer`),
   **Generate** (`/generate`), **New** (`/workouts/new`). Icons + eyebrow
   labels, 44px+ targets.
3. **Recent list** — compact tap-to-start rows: recent distinct workouts from
   history resolved to library ids (same name-resolution), padded out with
   library workouts; each row shows a focus-hued icon tile, name, works ·
   MM:SS line, and a per-row start affordance. Row tap → workout detail;
   start affordance → `StartSession` directly.

## Behavior

- Starting/joining navigates into `/session/$id` (push layout); the audio
  unlock rides the same tap per the player-kit contract.
- Feedback standard: skeletons for the hero and list while queries load;
  query failure → inline alert + retry; a failed `StartSession` → `sonner`
  toast. The live-session poll failing silently downgrades the hero to the
  start-last state (never an error fold for a background poll).
- No new capabilities: no stats, streaks, or feeds. The hero's "12 min in"
  style meta derives from `SessionSummary.startedAt`/`participantCount` only.

## e2e impact

New `home.spec.ts`: hero shows the joinable session within the poll interval
and one tap lands the second context in `/session/$id` (assertions currently
living in `live-session.spec.ts`'s join-path move here or update in place);
quick-start tiles route correctly; start-last hero appears after a completed
session. `library.spec.ts`'s home-list assertions move to `/library` (done in
`library-screens`).
