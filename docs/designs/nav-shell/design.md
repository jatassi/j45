# Design — nav-shell

The navigation model and app shell for the redesigned client: a persistent
glass bottom tab bar (**Home · Library · Generate · History**), glass sticky
headers, account via a header avatar chip, and the route-tree restructure that
gives every redesigned screen its place. Decided IA (interview): the ad-hoc
**Timer is a Home quick action**, the **Exercise catalog is a segment inside
Library**. This feature ships the shell and the moved routes; each screen's
interior is redesigned by its own feature.

## Route tree (TanStack Router, code-based — `src/router.tsx`)

Two layout groups under the root:

- **Tab layout** (renders `AppHeader` + `TabBar` + `Outlet`):
  - `/` — Home dashboard (interior: `home-dashboard`)
  - `/library` — workout library list (moves from `/`; interior:
    `library-screens`)
  - `/library/exercises` — exercise catalog as a Library segment (moves from
    `/exercises`; a `tabs`/segmented control switches Workouts | Exercises)
  - `/generate` — generator (interior: `generate-screen`)
  - `/history` — history (interior: `secondary-screens`)
  - `/workouts/$workoutId` — workout detail keeps the tab bar (it is Library
    browsing context; Library tab stays active)
- **Push layout** (no tab bar; `PushHeader` with back affordance + title):
  - `/session/$sessionId` — live player (also no header chrome while
    running; the player owns its screen — see `player-screens`)
  - `/timer` — manual timer (player-like: wake lock, full focus)
  - `/workouts/new`, `/workouts/$workoutId/edit`,
    `/workouts/$workoutId/reflow` — editors
  - `/account` — account, reached from the avatar chip (not a tab)

Legacy path `/exercises` gets a `beforeLoad` redirect to `/library/exercises`;
the catch-all `/$` → `/` redirect stays. `/glass` remains the pre-gate
pathname switch outside the router; `/proto` is deleted at the end of the
overhaul. Tab activity derives from the matched route's group (`/workouts/*`
non-editor → Library).

## Shell components (`src/components/shell/`, new)

- **`TabBar`** — floating glass chrome (the approved variant-A pattern):
  positioned wrapper (the `.glass-surface` position gotcha) + `useLiquidGlass`
  div, safe-area inset padding (`env(safe-area-inset-bottom)`), four
  `Link`-wrapped items — lucide icons `Home`, `LibraryBig`, `Sparkles`,
  `History` (the validated `/proto` set), active = signature orange + heavier
  stroke, 44px+ targets. Registered as a **scene proxy exclusion** (glass is
  never proxied — see `glass-live-refraction`).
- **`AppHeader`** — sticky glass header for tab roots: J45 wordmark
  (treatment judged in the prototype session; captured in
  `docs/design-system.md`), right-aligned `Avatar` chip (initials from
  `displayName`) linking to `/account`.
- **`PushHeader`** — sticky glass header for pushed screens: back chevron
  (router `history.back()` with a `/` fallback), screen title, optional
  right-side action slot (editors put Save there).
- **Scroll containers** register their content as scene proxies so chrome
  refracts what slides beneath it (the `useSceneSurface` hook from
  `glass-live-refraction`); until that feature merges, chrome renders on the
  static-gradient material unchanged — no coupling in either direction beyond
  the hook call.

The `RouterContext` (`{ user, onLoggedOut }`) is unchanged; `AppHeader`
consumes `user` for the avatar.

## What this feature deliberately does NOT do

Interior redesign of any screen. Existing screen components mount inside the
new shell with their current markup; per-screen features replace them. Two
consequences handled here:

- `LibraryNav` (the old header text-link nav) is deleted — the shell replaces
  its function.
- Because the workout list moves to `/library`, `/` gets an **interim home**:
  the existing `ActiveSessionsStrip` plus plain links to `/timer` and
  `/workouts/new` (everything else is a tab). `home-dashboard` replaces this
  interior wholesale; it exists only so no capability is unreachable
  mid-migration.

## e2e impact

Navigation-dependent specs update here, once, to the new IA: flows that
reached Timer/Generate/Exercises/History/Account via `LibraryNav` links now
navigate via the tab bar, the Home quick action (timer), the Library segment
control (exercises), or the avatar chip (account). Deep-link paths change
only for exercises (`/library/exercises`). Auth specs are untouched
(`AuthGate` renders outside the shell).
