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
import { LibraryWorkout, WorkoutId, WorkoutNotFound } from './library.js'

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
).middleware(AuthMiddleware) {}

/**
 * The single rpc contract shared by every J45 client and server. Defined
 * exactly once, here — both `packages/server` and `packages/client` import
 * it from `@j45/domain` rather than redeclaring it.
 */
export class J45Rpcs extends PublicRpcs.merge(AccountRpcs, OwnerRpcs, LibraryRpcs) {}
