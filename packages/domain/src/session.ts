import * as Schema from 'effect/Schema'

import { UserId } from './auth.js'
import { WorkoutId } from './library.js'
import { CompiledWorkout } from './segments.js'
import { TimerState } from './timer.js'

/**
 * Stable identity of a live session. Distinct from the workout library's
 * `WorkoutId` — a session is a running instance of a compiled workout, not
 * the stored plan.
 */
export const SessionId = Schema.String.pipe(Schema.brand('SessionId'))
export type SessionId = typeof SessionId.Type

/**
 * Someone present in a live session: the host plus every joined viewer.
 * `displayName` is denormalized so the session snapshot never needs a
 * user lookup to render the participant list.
 */
export class Participant extends Schema.Class<Participant>('Participant')({
  userId: UserId,
  displayName: Schema.String,
}) {}

/**
 * Why a live session stopped.
 *
 * - `closed` — the ordinary end: everybody left, or nobody was left watching
 *   and the session was collected.
 * - `plan-deleted` — the host removed the workout from the library, so there
 *   is no plan left for the session to follow.
 *
 * A participant must be able to tell the two apart. One means the workout is
 * over; the other means it was taken away.
 */
export const SessionEnd = Schema.Literal('closed', 'plan-deleted')
export type SessionEnd = typeof SessionEnd.Type

/**
 * Full live-session snapshot streamed to watchers. Carries the compiled
 * workout and timer state so a late joiner can render without replaying
 * history, plus `serverNow` so the client can correct for clock skew.
 *
 * `compiled` is the plan currently in force, not the plan the session
 * started under. A session is a live view of its library workout, and an
 * edit to that workout lands here at the next segment boundary.
 *
 * A client reads `planRevision` to learn that a change landed. It must never
 * compare one `compiled` with the next to find out. The snapshot is
 * republished on every participant join and leave, so a comparison would
 * report changes that never happened.
 */
export class SessionState extends Schema.Class<SessionState>('SessionState')({
  id: SessionId,
  host: Participant,
  workoutName: Schema.NonEmptyTrimmedString,
  compiled: CompiledWorkout,
  timer: TimerState,
  serverNow: Schema.Number,
  participants: Schema.Array(Participant),
  /**
   * How many plan changes this session has applied. `0` at start. It
   * increases only when a change lands: never on a join, a leave, a timer
   * advance, or a rename. A rename raises no notice, because the new name is
   * already on screen. One increase is one notice for the participant.
   */
  planRevision: Schema.Int,
  /**
   * Who made the change that `planRevision` counts, for the notice to name.
   * `null` until the first change lands.
   */
  planChangedBy: Schema.NullOr(Schema.String),
  /**
   * `null` while the session is live. The server publishes exactly one
   * snapshot with this set, and it is the last snapshot of the session: the
   * watch stream stops on it. A client therefore learns that the session
   * ended, and why, from the stream it already holds — it never has to ask.
   */
  ended: Schema.NullOr(SessionEnd),
}) {}

/**
 * Lightweight listing row for the lobby. Enough to pick a session to
 * join without downloading the full compiled workout and timer state.
 *
 * `workoutId` is the library workout that the session started from. A caller
 * resolves the session against that id, not against `workoutName`. The id of
 * a session that a different user hosts is absent from the caller's own
 * library. That id resolves to nothing, and this is the correct result.
 */
export class SessionSummary extends Schema.Class<SessionSummary>('SessionSummary')({
  id: SessionId,
  workoutId: WorkoutId,
  hostDisplayName: Schema.String,
  workoutName: Schema.NonEmptyTrimmedString,
  startedAt: Schema.DateTimeUtc,
  participantCount: Schema.Int,
}) {}

/**
 * Host-only control over a running session's timer. Maps 1:1 onto the
 * timer-advancing transitions in `./timer.js` (`pause`/`resume`/`skip`/`prev`).
 * There is no session-ending command — leaving a session is per-participant
 * (`LeaveSession`), and the session ends when the last participant leaves.
 */
export const SessionCommand = Schema.Literal('pause', 'resume', 'skip', 'prev')
export type SessionCommand = typeof SessionCommand.Type

/**
 * `Schema.TaggedError` itself, referenced through a lowercase alias.
 * `eslint-plugin-unicorn`'s `throw-new-error` rule flags any call whose
 * callee name ends in "Error" as a missing `new` — a known false positive
 * for this exact two-step factory (it already special-cases `Data.TaggedError`
 * for the same reason: sindresorhus/eslint-plugin-unicorn#2654). The alias
 * changes nothing about the factory or the classes it produces below.
 */
const taggedError = Schema.TaggedError

/** A session lookup or command that targeted an unknown `SessionId`. */
export class SessionNotFound extends taggedError<SessionNotFound>()('SessionNotFound', {
  id: SessionId,
}) {}
