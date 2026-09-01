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
- **Emphasis** — a set of muscle groups that narrows the generator's strength
  picks. A strength exercise qualifies when it carries at least one of them,
  so every group added widens the pool, and an added group can never make
  generation fail. It does nothing to cardio picks, which always pass, so the
  field is disabled when the **Focus** is `cardio`. It is not a Focus: a Focus
  is `cardio | strength | hybrid`, it is stored on the Workout, and it says
  what the workout is. An Emphasis lives only at generation time, and no
  Workout ever holds one. There is no empty Emphasis — the value is a nonempty
  list of groups, or nothing at all, and nothing at all means no emphasis.
  This is the opposite of an empty equipment list, which means bodyweight
  only. The two are shaped differently because an absent Emphasis is an
  absence, and an empty kit is a choice.
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
  library. Tracking decides which Sessions a *content* change reaches. It does
  not decide which Sessions a delete reaches: a delete reaches every live
  Session of the Workout, because a plan that is gone leaves nothing to
  follow, overlay or not. Every completion record the Session writes keeps
  the same id, so a reader can find the Workout a record came from. The id is
  the host's, and it is the only key a reader may join on: a name is free
  text, two Workouts can hold one name, and a record of somebody else's plan
  holds their name, not yours. A record that resolves to nothing in the
  reader's own library is the true answer, not a miss. Records written before
  the id was kept hold none, and are not given one by guess.
- **Plan change** — a change to a stored Workout, announced by the library so
  that every live Session which tracks that Workout can follow it. The library
  publishes; the live-Session registry consumes. The library never knows that
  live Sessions exist. A rename is applied at once and raises no notice to
  Participants, because the new name is already on screen. A content edit
  waits for the next Segment boundary, so no interval is cut short, and then
  re-enters the plan at the same work ordinal. A paused Session runs no
  interval, and its next boundary comes only if somebody resumes, so a
  content edit applies to it at once. This is true for an edit that arrives
  during the pause, and for an edit that was already held when the pause
  began. The time left is re-derived from the Segment now in force when that
  Segment differs from the Segment the Participant holds. The time left is
  kept as it stands when the two Segments are equal. An edit that changes a
  later Station does not change this interval, so a Participant with 10s left
  resumes with 10s left. A save that compiles to the plan already in force is
  not a change. The plan holds the Flow, so a save that flips the Flow is a
  change, even when the Segments are the same. It puts the whole stored plan
  on the Session: the name, the focus and the note. A completion record holds the whole plan, and it must
  not hold two versions of it. Such a save raises no notice. Once the timer is
  done the plan is frozen, and a later change never reaches the Session. A
  delete ends every live Session of the Workout.
- **Plan exhaustion** — a new plan has no work at the ordinal the Session
  already reached, because it holds fewer works than the Session ran. The
  Session finishes: it goes to done on the plan it was running, because a
  clamp backwards would replay a Station the Participant completed. Nothing
  else moves — the plan, the name and the Plan revision all stand — so on
  screen the finish is the same one the last Segment of that plan would have
  produced. The completion record is the one place that shows what happened.
  It counts the Session to the furthest Segment that the Session published,
  not to the end of the plan, because the trimmed Stations never ran.
- **Completion progress** — how far a Session got, carried on every
  completion record that it writes. Both numbers are counted in the one plan
  that the record holds, which is the last plan applied while the timer was
  live. The total is the Segment count of that plan. The count reached is the
  furthest Segment that the Session published while it ran that plan. A record
  can never name a Segment that its own plan does not hold.
- **Session end** — why a live Session stopped, carried on the one last
  snapshot it publishes: `closed` for the ordinary end (everybody left, or
  nobody was left watching), or `plan-deleted` when the host removed the
  Workout while the Session was still running. A Session whose timer already
  reached done ends `closed` even for a delete: its Participants completed the
  workout, so nothing was taken from them. That snapshot is what ends a
  watcher's stream, so a Participant always learns which of the two happened.
  Completion records are written either way, from the last plan applied while
  the timer was live.
- **Recently-ended record** — the short, bounded list of how the last live
  Sessions ended, kept by the server after the Sessions themselves are gone. A
  Participant who was disconnected when their Session ended receives no last
  snapshot, so their retried watch fails; the failure carries the reason from
  this record, and the two endings stay apart for them too. The bound is a
  count, not an age: a count needs no clock and no sweeper, and it caps the
  memory exactly. An ending the record no longer holds reads as the ordinary
  end.
- **Lobby feed** — the live view of which Sessions are running, and of what
  each one looks like from outside: the host, the Workout name, and how many
  Participants are in it. A subscriber receives the whole set as its first
  value, and the whole set again on every change. A subscriber that
  reconnects thus needs no history. The feed carries a change inside a
  Session as well as a Session starting or ending: a Participant who joins or
  leaves, and a new Workout name. It does not carry the timer. Nothing the
  timer does changes a lobby row, so the feed stays quiet while a Session
  runs.
- **Plan revision** — the count of plan changes a Session has applied, carried
  on its snapshot. It rises only when a change actually lands — never on a
  Participant join or leave, and never on a rename. A client raises its notice
  on the rise. Clients must not compare compiled plans to find a change: the
  snapshot is republished on every join and leave, so a comparison would
  report changes that never happened.
- **Stale snapshot** — the last Session snapshot a Participant received, kept on
  screen after the connection to the server goes away. The live view never
  clears itself: the workout, the clock and the controls stay as they were, and
  the Participant is told that the snapshot is stale. A break short enough to
  heal itself is never announced, because a notice on every blip costs more
  than the blip. The clock counts on, and it stays true, because the
  **Segment** it counts to carries an absolute end from the server. It then
  stops at zero and waits. The client never advances to the next Segment on its
  own, although it holds the whole compiled plan: the server owns the timer,
  and a second timer would disagree with the first. A Participant cannot drive
  a timer they cannot reach, so the timer commands stand down. Leaving does
  not: a Participant who leaves with no connection goes home, and the server
  learns it when their watch stream drops. Their completion record is then
  written when the Session ends, and it carries the Session's **Completion
  progress**, not the point where they stopped. Before the first snapshot
  arrives there is no stale snapshot to keep, and the screen says only that it
  is connecting.
- **Progress arc** — the player's centrepiece: an open SVG arc that depletes
  around the countdown digits as the current **Segment** runs down. It is driven
  only by a remaining fraction, so it keeps no timer of its own, and it freezes
  with the digits when a **Session** pauses. The live Session player and the
  manual timer draw the same arc. It is never called a ring. The shape is open,
  not closed, and the gap it leaves is the room the digits grow into.
- **Progress strip** — how far a live Session has got, shown as one bar per
  group and one dot per **Round**. The group is the **Pod** when the **Flow**
  is `laps`, and the **Station** when it is `sets`, because a `sets` workout is
  often one Pod, where a Pod bar says nothing. A bar carries one cell per
  Station in its group: a Pod bar therefore shows which Station is running, and
  a Station bar holds one cell and stays plain. A bar is never called a
  **Segment**. A Segment is one timed unit; a bar is a group of them. Every
  bar, cell and dot holds one of three states — done, now, ahead — and nothing
  fills part-way, so the strip never reports a position it did not reach. The
  dots wrap and the bars do not, so the strip keeps one height for one workout.
  A pod authored with more stations than a bar can divide gives up its cells
  and renders plain: the strip then says less, and it still says nothing false.
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
