import { Rpc, RpcGroup } from '@effect/rpc'
import * as Schema from 'effect/Schema'

import {
  AuthMiddleware,
  Forbidden,
  InvalidCredentials,
  InviteCode,
  Invite as InviteSchema,
  PasskeySummary,
  User,
  UserId,
} from './auth.js'
import { Exercise, ExerciseId, ExerciseNotFound, LibraryExercise } from './exercise.js'
import { GenerationConstraints, GenerationInfeasible } from './generation.js'
import { SessionCompletion } from './history.js'
import { LibraryWorkout, WorkoutConflict, WorkoutId, WorkoutNotFound } from './library.js'
import { ReflowInvalid, ReflowRequest } from './reflow.js'
import {
  SessionCommand,
  SessionId,
  SessionNotFound,
  SessionState,
  SessionSummary,
} from './session.js'
import { Workout } from './workout.js'

/**
 * Snapshot of the running server, returned by the `ServerInfo` rpc.
 * `sha` and `version` prove the deployed build; `serverTime` proves the
 * server is the clock of record.
 */
export class ServerInfo extends Schema.Class<ServerInfo>('ServerInfo')({
  sha: Schema.String,
  version: Schema.String,
  serverTime: Schema.DateTimeUtc,
}) {}

/**
 * Rpcs that require no session — the `/rpc` websocket upgrade itself stays
 * unauthenticated, and `ServerInfo` is the connectivity probe.
 */
export class PublicRpcs extends RpcGroup.make(Rpc.make('ServerInfo', { success: ServerInfo })) {}

/**
 * Rpcs any logged-in user may call. Every member requires a valid session
 * (`AuthMiddleware` provides `CurrentUser`, fails `Unauthorized`).
 *
 * WebAuthn ceremony payloads cross as `Schema.Unknown` — `@simplewebauthn/server`
 * is the validator of record for those blobs; duplicating its types as
 * `Schema` would be maintenance without safety.
 */
export class AccountRpcs extends RpcGroup.make(
  Rpc.make('Me', { success: User }),
  Rpc.make('ListPasskeys', { success: Schema.Array(PasskeySummary) }),
  Rpc.make('DeletePasskey', { payload: { id: Schema.String }, error: Forbidden }),
  Rpc.make('PasskeyEnrollStart', { success: Schema.Unknown }),
  Rpc.make('PasskeyEnrollFinish', {
    payload: { response: Schema.Unknown },
    success: PasskeySummary,
    error: InvalidCredentials,
  }),
).middleware(AuthMiddleware) {}

/**
 * Rpcs restricted to `CurrentUser.role === "owner"`. Every member requires a
 * valid session like `AccountRpcs`; the role check itself happens in the
 * handler layer, which raises `Forbidden` for members — there is no
 * separate owner middleware. `error: Forbidden` is declared on every member
 * (not just the ones with another declared error) because a handler can
 * only fail with an rpc's own declared error schema — the middleware's
 * `Unauthorized` reaches the client through a separate channel (the group's
 * `.middleware(AuthMiddleware)`), but `Forbidden`, raised from inside the
 * handler itself, has to be part of each rpc's own contract.
 */
export class OwnerRpcs extends RpcGroup.make(
  Rpc.make('ListUsers', { success: Schema.Array(User), error: Forbidden }),
  Rpc.make('CreateInvite', {
    payload: { resetUserId: Schema.optional(UserId) },
    success: InviteSchema,
    error: Forbidden,
  }),
  Rpc.make('ListInvites', { success: Schema.Array(InviteSchema), error: Forbidden }),
  Rpc.make('RevokeInvite', { payload: { code: InviteCode }, error: Forbidden }),
).middleware(AuthMiddleware) {}

/**
 * Rpcs for the workout library. Every member requires a valid session
 * (`AuthMiddleware` provides `CurrentUser`, fails `Unauthorized`).
 */
export class LibraryRpcs extends RpcGroup.make(
  Rpc.make('ListWorkouts', { success: Schema.Array(LibraryWorkout) }),
  Rpc.make('GetWorkout', {
    payload: { id: WorkoutId },
    success: LibraryWorkout,
    error: WorkoutNotFound,
  }),
  Rpc.make('DuplicateWorkout', {
    payload: { id: WorkoutId },
    success: LibraryWorkout,
    error: WorkoutNotFound,
  }),
  Rpc.make('RenameWorkout', {
    payload: { id: WorkoutId, name: Schema.NonEmptyTrimmedString },
    success: LibraryWorkout,
    error: WorkoutNotFound,
  }),
  Rpc.make('DeleteWorkout', { payload: { id: WorkoutId }, error: WorkoutNotFound }),
  Rpc.make('CreateWorkout', { payload: { workout: Workout }, success: LibraryWorkout }),
  /**
   * Whole-body replace under an optimistic-concurrency precondition:
   * `updatedAt` is the version the caller read, and the write only lands if
   * the stored row is still that version. A write built on a stale read fails
   * `WorkoutConflict` rather than silently discarding the other writer's save
   * — there is deliberately no merge, the loser re-fetches.
   */
  Rpc.make('UpdateWorkout', {
    payload: { id: WorkoutId, workout: Workout, updatedAt: Schema.DateTimeUtc },
    success: LibraryWorkout,
    error: Schema.Union(WorkoutNotFound, WorkoutConflict),
  }),
).middleware(AuthMiddleware) {}

/**
 * Rpcs for the exercise library. Every member requires a valid session
 * (`AuthMiddleware` provides `CurrentUser`, fails `Unauthorized`).
 */
export class ExerciseRpcs extends RpcGroup.make(
  Rpc.make('ListExercises', { success: Schema.Array(LibraryExercise) }),
  Rpc.make('CreateExercise', { payload: { exercise: Exercise }, success: LibraryExercise }),
  Rpc.make('UpdateExercise', {
    payload: { id: ExerciseId, exercise: Exercise },
    success: LibraryExercise,
    error: ExerciseNotFound,
  }),
  Rpc.make('DeleteExercise', { payload: { id: ExerciseId }, error: ExerciseNotFound }),
).middleware(AuthMiddleware) {}

/**
 * Rpcs for live workout sessions. Every member requires a valid session
 * (`AuthMiddleware` provides `CurrentUser`, fails `Unauthorized`).
 */
export class SessionRpcs extends RpcGroup.make(
  /**
   * Starts a session over the caller's stored plan, optionally under a
   * launch-time reflow. The reflow arrives as a `ReflowRequest` — spec plus
   * the source version it was built against — because the spec is positional
   * indices: resolving one against a plan that changed underneath would start
   * a session over a valid-but-different set of stations. A version mismatch
   * fails `ReflowInvalid`, same as an ill-fitting spec.
   */
  Rpc.make('StartSession', {
    payload: { workoutId: WorkoutId, reflow: Schema.optional(ReflowRequest) },
    success: SessionSummary,
    error: Schema.Union(WorkoutNotFound, ReflowInvalid),
  }),
  Rpc.make('ListActiveSessions', { success: Schema.Array(SessionSummary) }),
  Rpc.make('WatchSession', {
    payload: { id: SessionId },
    success: SessionState,
    error: SessionNotFound,
    stream: true,
  }),
  Rpc.make('SendSessionCommand', {
    payload: { id: SessionId, command: SessionCommand },
    error: SessionNotFound,
  }),
  Rpc.make('LeaveSession', { payload: { id: SessionId }, error: SessionNotFound }),
).middleware(AuthMiddleware) {}

/**
 * Rpcs for session completion history. Every member requires a valid session
 * (`AuthMiddleware` provides `CurrentUser`, fails `Unauthorized`).
 */
export class HistoryRpcs extends RpcGroup.make(
  Rpc.make('ListHistory', { success: Schema.Array(SessionCompletion) }),
).middleware(AuthMiddleware) {}

/**
 * Rpcs for pure workout generation. Every member requires a valid session
 * (`AuthMiddleware` provides `CurrentUser`, fails `Unauthorized`). Nothing is
 * persisted — the handler reads the caller's exercise catalog and completion
 * history, runs the domain generator, and returns the `Workout` (or
 * `GenerationInfeasible` when constraints starve the pool).
 */
export class GenerationRpcs extends RpcGroup.make(
  Rpc.make('GenerateWorkout', {
    payload: GenerationConstraints,
    success: Workout,
    error: GenerationInfeasible,
  }),
).middleware(AuthMiddleware) {}

/**
 * The single rpc contract shared by every J45 client and server — the merge
 * of `PublicRpcs` + `AccountRpcs` + `OwnerRpcs` + `LibraryRpcs` +
 * `ExerciseRpcs` + `SessionRpcs` + `HistoryRpcs` + `GenerationRpcs`. Defined
 * exactly once, here — both `packages/server` and `packages/client` import it
 * from `@j45/domain` rather than redeclaring it.
 */
export class J45Rpcs extends PublicRpcs.merge(
  AccountRpcs,
  OwnerRpcs,
  LibraryRpcs,
  ExerciseRpcs,
  SessionRpcs,
  HistoryRpcs,
  GenerationRpcs,
) {}
