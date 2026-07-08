import type { Rpc } from '@effect/rpc'
import { CurrentUser, Forbidden, OwnerRpcs, User } from '@j45/domain'
import * as Effect from 'effect/Effect'
import type * as Layer from 'effect/Layer'

import { Invites } from './invites.js'
import { UserRepo, type UserRow } from './user-repo.js'

/** `UserRow` (persistence shape, carries `pinHash`/`createdAt`) → the public `User` `ListUsers` returns. */
const toDomainUser = (row: UserRow): User =>
  new User({ id: row.id, username: row.username, displayName: row.displayName, role: row.role })

/**
 * Every `OwnerRpcs` member requires `CurrentUser.role === 'owner'` — checked
 * here, in the handler layer, rather than a separate middleware (per
 * `@j45/domain`'s `OwnerRpcs` doc comment): `body` only runs once `user` is
 * confirmed an owner; otherwise the whole call fails `Forbidden`.
 */
const asOwner = <A, E, R>(
  body: (user: User) => Effect.Effect<A, E, R>,
): Effect.Effect<A, Forbidden | E, CurrentUser | R> =>
  Effect.gen(function* () {
    const user = yield* CurrentUser
    if (user.role !== 'owner') {
      return yield* Effect.fail(new Forbidden())
    }
    return yield* body(user)
  })

/**
 * Implements every `OwnerRpcs` member in one `toLayer` — unlike `AccountRpcs`,
 * no other task contributes to this group. `ListUsers`/`ListInvites` are
 * plain owner-gated reads; `CreateInvite` mints a registration invite
 * (7-day expiry) or, when `resetUserId` is set, a reset code (24h —
 * `Invites.mint`'s own rule) attributed to the calling owner; `RevokeInvite`
 * deletes a code outright. Every persistence call is wrapped in
 * `Effect.orDie` — a `SqlError` is a database/infra failure, not `Forbidden`
 * (the only typed failure these rpcs declare).
 */
export const OwnerHandlersLive: Layer.Layer<
  | Rpc.Handler<'ListUsers'>
  | Rpc.Handler<'CreateInvite'>
  | Rpc.Handler<'ListInvites'>
  | Rpc.Handler<'RevokeInvite'>,
  never,
  UserRepo | Invites
> = OwnerRpcs.toLayer(
  Effect.gen(function* () {
    const userRepo = yield* UserRepo
    const invites = yield* Invites

    return {
      ListUsers: () =>
        asOwner(() =>
          Effect.map(userRepo.list(), (rows) => rows.map(toDomainUser)).pipe(Effect.orDie),
        ),
      CreateInvite: ({ resetUserId }) =>
        asOwner((user) =>
          invites
            .mint(
              resetUserId === undefined
                ? { createdBy: user.id }
                : { createdBy: user.id, resetUserId },
            )
            .pipe(Effect.orDie),
        ),
      ListInvites: () => asOwner(() => invites.list().pipe(Effect.orDie)),
      RevokeInvite: ({ code }) => asOwner(() => invites.revoke(code).pipe(Effect.orDie)),
    }
  }),
)
