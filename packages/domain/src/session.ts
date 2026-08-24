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
 * Full live-session snapshot streamed to watchers. Carries the compiled
 * workout and timer state so a late joiner can render without replaying
 * history, plus `serverNow` so the client can correct for clock skew.
 */
export class SessionState extends Schema.Class<SessionState>('SessionState')({
  id: SessionId,
  host: Participant,
  workoutName: Schema.NonEmptyTrimmedString,
  compiled: CompiledWorkout,
  timer: TimerState,
  serverNow: Schema.Number,
  participants: Schema.Array(Participant),
}) {}

/**
 * Lightweight listing row for the lobby. Enough to pick a session to
 * join without downloading the full compiled workout and timer state.
 *
 * `workoutId` is the library workout the session was started from — the
 * identity a caller resolves the session against instead of matching
 * `workoutName`. A session hosted by someone else names an id that is not in
 * the caller's own library, and resolving to nothing there is correct.
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
