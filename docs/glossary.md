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
- **Session** — one live run of a workout: server-owned state (current segment,
  clock, participants), synced to all joined phones. Ephemeral; only its
  completion record persists. (Login state is never called a "session" bare —
  code and schema say `AuthSession` / `auth_sessions`.)
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
