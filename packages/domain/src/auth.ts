import { RpcMiddleware } from '@effect/rpc'
import * as Context from 'effect/Context'
import * as Schema from 'effect/Schema'

/**
 * Branded identifiers and inputs shared by every auth rpc/route. Kept as
 * pure `Schema` — this module adds zero dependencies beyond `effect` and
 * `@effect/rpc`.
 */
export const UserId = Schema.String.pipe(Schema.brand('UserId'))
export type UserId = typeof UserId.Type

/** 3–20 chars, `[a-z0-9._-]`, must start alphanumeric (case-insensitive). */
export const Username = Schema.String.pipe(
  Schema.pattern(/^[a-z0-9][a-z0-9._-]{2,19}$/i),
  Schema.brand('Username'),
)
export type Username = typeof Username.Type

/** PINs are exactly this many digits; the auth screens render this many OTP slots. */
export const PIN_LENGTH = 4

export const Pin = Schema.String.pipe(
  Schema.pattern(new RegExp(`^\\d{${PIN_LENGTH}}$`)),
  Schema.brand('Pin'),
)
export type Pin = typeof Pin.Type

/** 8-char Crockford base32 invite/reset code (charset enforced by minting). */
export const InviteCode = Schema.String.pipe(Schema.brand('InviteCode'))
export type InviteCode = typeof InviteCode.Type

/**
 * The logged-in user, as returned by the `Me` rpc and provided by
 * `AuthMiddleware`.
 */
export class User extends Schema.Class<User>('User')({
  id: UserId,
  username: Username,
  displayName: Schema.String,
  role: Schema.Literal('owner', 'member'),
}) {}

/**
 * An invite/reset code, as listed by `ListInvites` and returned by
 * `CreateInvite`. `resetUserId` set means this is a reset code for that
 * user rather than a registration invite.
 */
export class Invite extends Schema.Class<Invite>('Invite')({
  code: InviteCode,
  resetUserId: Schema.optional(UserId),
  createdBy: Schema.optional(UserId),
  createdAt: Schema.DateTimeUtc,
  expiresAt: Schema.optional(Schema.DateTimeUtc),
}) {}

/**
 * A caller's own passkey, as listed by `ListPasskeys`. Never carries the
 * public key or counter — those stay server-side.
 */
export class PasskeySummary extends Schema.Class<PasskeySummary>('PasskeySummary')({
  id: Schema.String,
  createdAt: Schema.DateTimeUtc,
  lastUsedAt: Schema.optional(Schema.DateTimeUtc),
}) {}

/** The logged-in user, provided into context by `AuthMiddleware`. */
export class CurrentUser extends Context.Tag('CurrentUser')<CurrentUser, User>() {}

/**
 * `Schema.TaggedError` itself, referenced through a lowercase alias.
 * `eslint-plugin-unicorn`'s `throw-new-error` rule flags any call whose
 * callee name ends in "Error" as a missing `new` — a known false positive
 * for this exact two-step factory (it already special-cases `Data.TaggedError`
 * for the same reason: sindresorhus/eslint-plugin-unicorn#2654). The alias
 * changes nothing about the factory or the classes it produces below.
 */
const taggedError = Schema.TaggedError

/** No/invalid/expired session cookie — `AuthMiddleware`'s failure mode. */
export class Unauthorized extends taggedError<Unauthorized>()('Unauthorized', {}) {}

/** A logged-in user without the role an owner-only rpc/route requires. */
export class Forbidden extends taggedError<Forbidden>()('Forbidden', {}) {}

/** A username+PIN or passkey login attempt that didn't verify. */
export class InvalidCredentials extends taggedError<InvalidCredentials>()(
  'InvalidCredentials',
  {},
) {}

/** An invite/reset code that is unknown, spent, or expired. */
export class InvalidInvite extends taggedError<InvalidInvite>()('InvalidInvite', {}) {}

/** Registration with a username already taken by another account. */
export class UsernameTaken extends taggedError<UsernameTaken>()('UsernameTaken', {}) {}

/** Too many failed attempts against a rate-limited key. */
export class RateLimited extends taggedError<RateLimited>()('RateLimited', {
  retryAfterSeconds: Schema.Number,
}) {}

/**
 * Guards every rpc in `AccountRpcs` and `OwnerRpcs`: parses and validates
 * the session cookie from the rpc call's headers, provides `CurrentUser` on
 * success, and fails `Unauthorized` otherwise. The live implementation
 * lives in `packages/server` (this tag carries the contract only).
 */
export class AuthMiddleware extends RpcMiddleware.Tag<AuthMiddleware>()('AuthMiddleware', {
  provides: CurrentUser,
  failure: Unauthorized,
}) {}
