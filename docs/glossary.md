# J45 — Glossary

Terms with pinned, project-specific meanings. Standard industry terms are used
unrecorded wherever they fit.

- **Workout** — one runnable unit of exercise content (what the old app called a
  "day"): named pods plus a flow. The thing you start a session from.
- **Pod** — a named group of stations within a workout (a circuit). F45-inherited
  term.
- **Station** — one exercise slot within a pod.
- **Flow** — the execution shape of a workout's pods: `laps` (cycle through a
  pod's stations, repeating the cycle N times) or `sets` (repeat one station N
  times before moving on), with per-round work/rest intervals.
- **Round** — one pass of a flow (a lap or a set) carrying its work/rest
  interval. A flow is a nonempty list of rounds; the round count is the
  lap/set count.
- **Ladder** — a flow whose work/rest intervals differ per round (e.g.
  descending rest), as opposed to uniform intervals.
- **Segment** — one timed unit of a running session (`ready`, `work`, or
  `rest`), produced by compiling a workout's pods+flow into a flat ordered list.
  The session engine advances segment-by-segment.
- **Exercise** — a tagged entry in a user's exercise catalog (modality,
  muscle groups, equipment, intensity). Distinct from a **Station**, which
  stays free text inside a workout: the catalog is a vocabulary the
  generator draws from, never a foreign-key target for stations.
- **Reflow** — a structural transform on a workout that never authors content:
  regrouping its existing stations into different pods (reorder and drop
  allowed, never new or duplicated stations), switching flow type (sets↔laps),
  and optionally retiming rounds. Applicable permanently (edit-time) or as a
  one-off overlay at session launch (the saved plan untouched).
- **Reflow request** — a reflow spec together with the version of the source
  workout it was built against (`LibraryWorkout.updatedAt`). A reflow is
  positional indices, so it means nothing without saying which plan it indexes;
  the two travel as one value so a spec can never reach a resolver unversioned.
- **Source version** — a `LibraryWorkout.updatedAt` carried by a write or a
  launch to say which read it was built on. The server makes it a
  precondition: a whole-body `UpdateWorkout` built on a stale read fails
  **workout conflict** rather than silently discarding the other writer, and a
  reflow request whose source version has moved on is refused rather than
  resolved against a different plan. There is deliberately no merge — the
  loser re-fetches.
- **Session** — one live run of a workout: server-owned state (current segment,
  clock, participants), synced to all joined phones. Ephemeral; only its
  completion record persists. (Login state is never called a "session" bare —
  code and schema say `AuthSession` / `auth_sessions`.)
- **Source workout** — the library Workout that a Session started from. The
  Session keeps its `WorkoutId`, and the server can find every live Session
  that tracks one Workout. A Session that started with a launch-time Reflow
  overlay keeps the id, but tracks nothing: its compiled plan was never in the
  library.
- **Plan change** — a change to a stored Workout, announced by the library so
  that every live Session which tracks that Workout can follow it. The library
  publishes; the live-Session registry consumes. The library never knows that
  live Sessions exist. A rename is applied at once and raises no notice to
  Participants, because the new name is already on screen. A content edit
  waits for the next Segment boundary, so no interval is cut short, and then
  re-enters the plan at the same work ordinal.
- **Plan revision** — the count of plan changes a Session has applied, carried
  on its snapshot. It rises only when a change actually lands — never on a
  Participant join or leave, and never on a rename. A client raises its notice
  on the rise. Clients must not compare compiled plans to find a change: the
  snapshot is republished on every join and leave, so a comparison would
  report changes that never happened.
- **Glass chrome** — persistent UI furniture rendered in the liquid-glass
  material: the bottom tab bar, sticky headers, overlays, and control docks.
  Content cards stay opaque — chrome is one half of glass's decided role.
- **Hero glass** — the other half: at most one star glass surface on a
  screen that earns it (live-player elements, workout-complete). Never both
  roles diluted across everything.
- **Scene registry** — the document-anchored registry of scene proxies that
  the glass refraction texture is composited from. Glass refracts the
  registry's proxies, never DOM snapshots.
- **Scene proxy** — a component's cheap paintable stand-in in the scene
  registry: rounded rect + token color, a rasterize-once sprite, or a small
  owner-invalidated dirty-region canvas (the timer digits).
