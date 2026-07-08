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
- **Reflow** — a structure-preserving-content transform on a workout: regrouping
  stations into pods and/or switching flow type (sets↔laps) with retiming.
  Applicable permanently (edit-time) or as a one-off overlay (launch-time).
- **Session** — one live run of a workout: server-owned state (current segment,
  clock, participants), synced to all joined phones. Ephemeral; only its
  completion record persists. (Login state is never called a "session" bare —
  code and schema say `AuthSession` / `auth_sessions`.)
