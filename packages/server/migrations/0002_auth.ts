import { SqlClient } from '@effect/sql'
import * as Effect from 'effect/Effect'

/**
 * The auth-accounts schema — four tables, exactly per
 * `docs/designs/auth-accounts/design.md`'s "Data model" section.
 *
 * Naming: the table and domain type are `auth_sessions` / `AuthSession` —
 * the bare word "Session" is pinned by the glossary to a live workout run.
 *
 * `users.username` is `UNIQUE COLLATE NOCASE` (case-insensitive; the
 * `Username` domain schema's charset is ASCII-only, so NOCASE is
 * sufficient). `users.role` is constrained to `owner`/`member` — the first
 * account ever created is the owner, every later one a member (enforced in
 * application code, not the schema). Every user has a `pin_hash`:
 * registration always sets one, so the PIN fallback login always exists;
 * passkeys are optional. Invites are single-use (`used_at` non-NULL means
 * spent); a "reset code" is just an invite with `reset_user_id` set.
 * `auth_sessions.token_hash` stores only the SHA-256 of the session cookie
 * token — the raw token is never persisted, only returned once at login.
 */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient

  yield* sql`CREATE TABLE users (
    id            TEXT PRIMARY KEY,
    username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
    display_name  TEXT NOT NULL,
    role          TEXT NOT NULL CHECK (role IN ('owner','member')),
    pin_hash      TEXT NOT NULL,
    created_at    TEXT NOT NULL
  )`

  yield* sql`CREATE TABLE invites (
    code           TEXT PRIMARY KEY,
    reset_user_id  TEXT REFERENCES users(id),
    created_by     TEXT REFERENCES users(id),
    created_at     TEXT NOT NULL,
    expires_at     TEXT,
    used_by        TEXT REFERENCES users(id),
    used_at        TEXT
  )`

  yield* sql`CREATE TABLE passkey_credentials (
    id            TEXT PRIMARY KEY,
    user_id       TEXT NOT NULL REFERENCES users(id),
    public_key    BLOB NOT NULL,
    counter       INTEGER NOT NULL,
    transports    TEXT,
    created_at    TEXT NOT NULL,
    last_used_at  TEXT
  )`

  yield* sql`CREATE TABLE auth_sessions (
    token_hash  TEXT PRIMARY KEY,
    user_id     TEXT NOT NULL REFERENCES users(id),
    created_at  TEXT NOT NULL,
    expires_at  TEXT NOT NULL
  )`
})
