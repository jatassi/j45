import { SqlClient } from '@effect/sql'
import type { UserId, Username } from '@j45/domain'
import * as Effect from 'effect/Effect'
import * as Option from 'effect/Option'

export type UserRole = 'owner' | 'member'

/** A user row as callers construct it — the pin must already be hashed. */
export type NewUser = {
  readonly id: UserId
  readonly username: Username
  readonly displayName: string
  readonly role: UserRole
  readonly pinHash: string
  readonly createdAt: string
}

/** A user row as callers read it back. */
export type UserRow = NewUser

type UsersTableRow = {
  readonly id: string
  readonly username: string
  readonly display_name: string
  readonly role: string
  readonly pin_hash: string
  readonly created_at: string
}

const toUserRow = (row: UsersTableRow): UserRow => ({
  id: row.id as UserId,
  username: row.username as Username,
  displayName: row.display_name,
  role: row.role as UserRole,
  pinHash: row.pin_hash,
  createdAt: row.created_at,
})

/**
 * Persistence for the `users` table (migration `0002_auth`) — the sole
 * write/read surface other auth services use to create and look up
 * accounts. Depends only on the generic `SqlClient.SqlClient` tag.
 * `username` lookups rely on the column's own `COLLATE NOCASE` (declared in
 * the DDL), which SQLite applies by default to any comparison against that
 * column — no explicit `COLLATE` needed in the query.
 */
export class UserRepo extends Effect.Service<UserRepo>()('UserRepo', {
  effect: Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient

    const insert = (user: NewUser) =>
      sql`INSERT INTO users ${sql.insert({
        id: user.id,
        username: user.username,
        display_name: user.displayName,
        role: user.role,
        pin_hash: user.pinHash,
        created_at: user.createdAt,
      })}`.pipe(Effect.asVoid)

    const findByUsername = (username: string) =>
      sql<UsersTableRow>`SELECT * FROM users WHERE username = ${username}`.pipe(
        Effect.map((rows) => Option.fromNullable(rows[0]).pipe(Option.map(toUserRow))),
      )

    const findById = (id: UserId) =>
      sql<UsersTableRow>`SELECT * FROM users WHERE id = ${id}`.pipe(
        Effect.map((rows) => Option.fromNullable(rows[0]).pipe(Option.map(toUserRow))),
      )

    /** The total number of registered users — first-run bootstrap's `users` is empty check. */
    const count = () =>
      sql<{ readonly total: number }>`SELECT COUNT(*) AS total FROM users`.pipe(
        Effect.map((rows) => rows[0]?.total ?? 0),
      )

    /** Every registered user, oldest first — the `ListUsers` rpc's read side. */
    const list = () =>
      sql<UsersTableRow>`SELECT * FROM users ORDER BY created_at`.pipe(
        Effect.map((rows) => rows.map(toUserRow)),
      )

    return { insert, findByUsername, findById, count, list } as const
  }),
}) {}
