# auth-accounts — design

## What it is

Invite-gated accounts for the invited circle: the owner mints invite codes,
redeeming one is the only way to register, passkeys (WebAuthn) are the primary
login, username+PIN is the fallback, and sessions are long-lived httpOnly
cookies. Decisions and trade-offs are ADR-0002; this doc is the mechanism.
When this feature is done, every rpc except `ServerInfo` requires a logged-in
user, and downstream features get identity for free via a `CurrentUser`
service in their rpc handlers.

Built on the walking skeleton as landed on `integrate--walking-skeleton`
(monorepo, `J45Rpcs` over WebSocket at `/rpc`, SQLite + Migrator, shadcn/ui
client, Playwright e2e harness).

## Sizing note

This is the largest single-feature surface designed so far (schema + server
services + HTTP routes + middleware + four client screens). It is one feature
because it is one vertical slice with one acceptance story, but Plan should
expect to decompose it into several file-disjoint tasks (domain/migration,
server auth core, WebAuthn, client screens, admin surface).

## Data model — migration 0002_auth

Four tables. **Naming: the table and domain type are `auth_sessions` /
`AuthSession`** — the bare word "Session" is pinned by the glossary to a live
workout run and must not be used for login state.

```sql
CREATE TABLE users (
  id            TEXT PRIMARY KEY,              -- UserId, crypto.randomUUID()
  username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
  display_name  TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('owner','member')),
  pin_hash      TEXT NOT NULL,                 -- Bun.password (argon2id) — never plaintext
  created_at    TEXT NOT NULL                  -- ISO-8601 UTC, from Effect Clock
);

CREATE TABLE invites (
  code           TEXT PRIMARY KEY,             -- 8 chars, Crockford base32 (no 0/O/1/I)
  reset_user_id  TEXT REFERENCES users(id),    -- NULL = registration invite; set = reset code
  created_by     TEXT REFERENCES users(id),    -- NULL for the first-run invite
  created_at     TEXT NOT NULL,
  expires_at     TEXT,                         -- NULL = never (first-run invite)
  used_by        TEXT REFERENCES users(id),
  used_at        TEXT                          -- non-NULL = spent; single-use
);

CREATE TABLE passkey_credentials (
  id            TEXT PRIMARY KEY,              -- base64url credential id
  user_id       TEXT NOT NULL REFERENCES users(id),
  public_key    BLOB NOT NULL,
  counter       INTEGER NOT NULL,
  transports    TEXT,                          -- JSON array from the enrollment response
  created_at    TEXT NOT NULL,
  last_used_at  TEXT
);

CREATE TABLE auth_sessions (
  token_hash  TEXT PRIMARY KEY,                -- SHA-256(cookie token) — raw token never stored
  user_id     TEXT NOT NULL REFERENCES users(id),
  created_at  TEXT NOT NULL,
  expires_at  TEXT NOT NULL
);
```

Constraints the schema encodes: every user has a PIN (registration always sets
one, so the fallback login always exists; passkeys are optional and
encouraged). Invites are single-use. A "reset code" is just an invite with
`reset_user_id` set.

## Domain additions (`packages/domain`)

`packages/domain/src/auth.ts` — pure Schema, zero new deps (the package stays
`effect` + `@effect/rpc` only):

```ts
export const UserId = Schema.String.pipe(Schema.brand("UserId"))
export const Username = Schema.String.pipe(         // 3–20, [a-z0-9._-], starts alnum
  Schema.pattern(/^[a-z0-9][a-z0-9._-]{2,19}$/i), Schema.brand("Username"))
export const Pin = Schema.String.pipe(Schema.pattern(/^\d{4,8}$/), Schema.brand("Pin"))
export const InviteCode = Schema.String.pipe(Schema.brand("InviteCode"))

export class User extends Schema.Class<User>("User")({
  id: UserId, username: Username, displayName: Schema.String,
  role: Schema.Literal("owner", "member")
}) {}

export class CurrentUser extends Context.Tag("CurrentUser")<CurrentUser, User>() {}

export class Unauthorized extends Schema.TaggedError<Unauthorized>()("Unauthorized", {}) {}
export class Forbidden extends Schema.TaggedError<Forbidden>()("Forbidden", {}) {}
export class InvalidCredentials extends Schema.TaggedError<InvalidCredentials>()("InvalidCredentials", {}) {}
export class InvalidInvite extends Schema.TaggedError<InvalidInvite>()("InvalidInvite", {}) {}
export class UsernameTaken extends Schema.TaggedError<UsernameTaken>()("UsernameTaken", {}) {}
export class RateLimited extends Schema.TaggedError<RateLimited>()("RateLimited", {
  retryAfterSeconds: Schema.Number
}) {}

export class AuthMiddleware extends RpcMiddleware.Tag<AuthMiddleware>()("AuthMiddleware", {
  provides: CurrentUser,
  failure: Unauthorized
}) {}
```

WebAuthn ceremony payloads (creation/assertion options and responses) cross
the boundary as `Schema.Unknown` envelopes: `@simplewebauthn/server` is the
validator of record for those blobs (deep structural + cryptographic checks),
and duplicating its types as Schema would be maintenance without safety.
Everything J45-shaped around them (usernames, codes, the `User` result) is
real Schema.

`packages/domain/src/rpc.ts` grows from the current single-rpc group
(`Rpc.make("ServerInfo", { success: ServerInfo })`) to three merged groups:

```ts
export class PublicRpcs extends RpcGroup.make(
  Rpc.make("ServerInfo", { success: ServerInfo })
) {}

export class AccountRpcs extends RpcGroup.make(
  Rpc.make("Me", { success: User }),
  Rpc.make("ListPasskeys", { success: Schema.Array(PasskeySummary) }),
  Rpc.make("DeletePasskey", { payload: { id: Schema.String }, error: Forbidden }),
  Rpc.make("PasskeyEnrollStart", { success: Schema.Unknown }),          // creation options JSON
  Rpc.make("PasskeyEnrollFinish", { payload: { response: Schema.Unknown },
    success: PasskeySummary, error: InvalidCredentials })
).middleware(AuthMiddleware) {}

export class OwnerRpcs extends RpcGroup.make(
  Rpc.make("ListUsers", { success: Schema.Array(User) }),
  Rpc.make("CreateInvite", { payload: { resetUserId: Schema.optional(UserId) },
    success: Invite }),
  Rpc.make("ListInvites", { success: Schema.Array(Invite) }),           // unspent only
  Rpc.make("RevokeInvite", { payload: { code: InviteCode } })
).middleware(AuthMiddleware) {}                                          // + role check in handlers

export class J45Rpcs extends RpcGroup.merge(PublicRpcs, AccountRpcs, OwnerRpcs) {}
```

(Exact rpc field shapes are illustrative; the structure — three groups, the
middleware placement, `errors` as the tagged types above — is the contract.
`Forbidden` on owner rpcs is raised by the handler when
`CurrentUser.role !== "owner"`; there is no separate owner middleware.)

Passkey **enrollment** rides rpc (it needs auth, sets no cookies). Passkey
**login** cannot — see the HTTP surface below.

## How identity flows (the middleware mechanism)

Verified against the pinned `@effect/rpc@0.75.1` source: the WebSocket
protocol captures the upgrade request's HTTP headers and prepends them to
every rpc request on that connection —

```js
// RpcServer.js (makeProtocolWithHttpAppWebsocket → onSocket)
yield* onSocket(socket, Object.entries(request.headers))
...
if (message._tag === "Request" && headers) {
  message.headers = headers.concat(message.headers)
}
```

— so the browser's session cookie (sent automatically on the same-origin
`/rpc` upgrade) reaches `AuthMiddleware` in its `headers` argument on **every
call**, and the middleware re-validates the session per rpc (revocation and
expiry take effect mid-connection, not at the next reconnect). The server
implementation:

```ts
AuthMiddleware.of(({ headers }) =>
  Effect.gen(function* () {
    const token = Cookies.parseHeader(headers.cookie ?? "")["j45_session"]
    // hash token, look up auth_sessions (unexpired), load user — else Unauthorized
    return user
  }))
```

The `/rpc` upgrade itself stays unauthenticated (`ServerInfo` is public and
serves as the connectivity probe); protection is per-rpc via the middleware.
This refines the architecture's auth bullet and is recorded there.

## HTTP surface — `POST /auth/*` (recorded exception #2)

An rpc riding a WebSocket cannot set or clear cookies, so the cookie
lifecycle lives on plain HTTP routes, registered exactly like the existing
`HealthzRouteLive` (`HttpRouter.Default.use`). Bodies and responses are
Schema-validated (`HttpServerRequest.schemaBodyJson`); errors are the domain
tagged errors serialized as JSON with matching status codes (400/401/403/429).

| Route | Auth | Effect |
|---|---|---|
| `POST /auth/register` `{code, username, displayName, pin}` | invite code | create user (+ spend invite + create session, one transaction) → `Set-Cookie` + `{user}` |
| `POST /auth/login/pin` `{username, pin}` | credentials | verify → `Set-Cookie` + `{user}`; failures count toward the rate limit |
| `POST /auth/login/passkey/options` `{}` | none | authentication options JSON (usernameless; challenge registered server-side, 2-min TTL) |
| `POST /auth/login/passkey` `{response}` | assertion | verify via `@simplewebauthn/server` → `Set-Cookie` + `{user}`; updates `counter`, `last_used_at` |
| `POST /auth/reset` `{code, newPin}` | reset code | set new `pin_hash`, revoke **all** the user's `auth_sessions`, spend code → `Set-Cookie` + `{user}` |
| `GET /auth/me` | cookie | `{user}` or 401; performs the sliding refresh (below) |
| `POST /auth/logout` | cookie | delete session row, clear cookie, 204 |

CSRF posture: all `/auth` POSTs require an `Origin` header equal to
`APP_ORIGIN` (403 otherwise); the cookie is `SameSite=Lax` so cross-site
POSTs and cross-site WS upgrades don't carry it. That plus invite gating is
proportionate for a private instance.

**Session cookie contract:** name `j45_session`; value = 32 random bytes
base64url (row stores only its SHA-256); `HttpOnly; SameSite=Lax; Path=/`;
`Secure` iff `APP_ORIGIN` is https; `Max-Age` 365 days matching
`expires_at`. Sliding renewal: `GET /auth/me` (hit on every app load) extends
the row and re-sets the cookie when more than 7 days of lifetime have been
consumed — a device used at least yearly never gets logged out.

## WebAuthn specifics

- **Library:** `@simplewebauthn/server` **v13.3.x** (Bun officially supported
  since the v13 WebCrypto rearchitecture) in `packages/server`;
  `@simplewebauthn/browser` v13.x in `packages/client`. Survey result: this
  is the standard TS implementation; hand-rolling CBOR/COSE verification is
  not on the table.
- **rpID / expected origin** derive from the `APP_ORIGIN` config: rpID is its
  hostname (`j45.atassi.org` in prod, `localhost` in dev and e2e — both valid
  WebAuthn rpIDs; secure-context rules are satisfied by https and localhost
  respectively).
- **Enrollment** (`PasskeyEnrollStart/Finish` rpcs): `residentKey:
  "required"`, `userVerification: "preferred"` — guarantees discoverable
  credentials so login is usernameless one-tap. Platform authenticators
  (iCloud Keychain, Google Password Manager) are the audience.
- **Login** is usernameless: empty `allowCredentials`, credential id from the
  assertion locates the user via `passkey_credentials`.
- **Challenge store:** in-memory `Effect.Service` (`Ref<Map>` keyed by
  challenge, 2-minute TTL via Effect `Clock`, consumed exactly once).
  Single-instance server; a restart mid-ceremony just means retrying — fine.

## PIN, rate limiting, invites

- PIN = 4–8 digits, hashed with `Bun.password` (argon2id defaults), verified
  with constant-time `Bun.password.verify`.
- **Rate limiter:** one in-memory fixed-window service (Effect `Clock`-driven,
  TestClock-tested): key `pin:<username>` — 5 failures / 15 min locks PIN
  login for that username (`RateLimited` with `retryAfterSeconds`); key
  `invite:<ip>` — 10 failed redemptions / 15 min (IP from `X-Forwarded-For`
  set by Caddy, else socket address). Counters reset on success.
- **Invite codes:** 8 chars Crockford base32, shown grouped `XXXX-XXXX`,
  shareable as a link `${APP_ORIGIN}/register?invite=<code>`. Owner-minted
  registration invites expire in 7 days; reset codes in 24 h.
- **First-run bootstrap:** at startup, if `users` is empty and no unspent
  registration invite exists, the server mints one (no expiry) and logs it
  loudly. Config `FIRST_RUN_INVITE` (optional) pins its value —
  deterministic for dev and the e2e harness; unset on the VPS, where
  `journalctl --user -u j45` shows it. **The first account ever created gets
  `role = 'owner'`;** all later accounts are `member`.
- **Recovery is social** (ADR-0002): owner mints a reset code from the admin
  screen and reads it to the locked-out user; redeeming sets a new PIN and
  revokes every existing session for that account. Stale passkeys are removed
  by the user from the account screen (`DeletePasskey`).

## Server layout

New `Effect.Service`s in `packages/server/src/auth/`, all persistence through
the `SqlClient.SqlClient` tag (never a concrete driver, per architecture):
`UserRepo`, `AuthSessions` (create / lookupAndTouch / revokeAllForUser /
delete), `Invites` (mint / redeem-in-transaction / list / revoke),
`Passkeys` (the four ceremony halves, wrapping simplewebauthn),
`ChallengeStore`, `RateLimiter`, plus `AuthRoutesLive` (the HTTP layer,
sibling of `HealthzRouteLive` in `ServerLive`) and `AuthMiddlewareLive`.
Multi-step writes (register = spend invite + insert user + insert session)
run in `sql.withTransaction`.

New config (`packages/server/src/config.ts` pattern, alongside
`PortConfig`/`ReleaseShaConfig`): `APP_ORIGIN` (default
`http://localhost:5173`), `FIRST_RUN_INVITE` (optional). The deploy hook's
`release.env` gains `APP_ORIGIN=https://j45.atassi.org` (source it from
`deploy/config.sh`).

## Client

Vite proxy adds `/auth` → `:3000` next to the existing `/rpc` + `/healthz`
entries. No routing library yet — this feature needs exactly two entry
states, decided from `window.location` at startup; a router is deferred to
the first feature with real navigation (plan-library). The static server
already falls back to `index.html`, so `/register` deep links work.

- **AuthGate** (wraps the current app content): an atom fetches
  `GET /auth/me` on load → `loading | anonymous | authenticated(User)`.
  Anonymous → LoginScreen; authenticated → the app (which now owns the
  WebSocket; unauthenticated rpc calls would fail `Unauthorized`, but the
  gate means they aren't made).
- **LoginScreen:** primary "Sign in with passkey" button
  (`@simplewebauthn/browser` `startAuthentication`), username+PIN form below,
  and an invite-code entry point for first-timers.
- **RegisterScreen** (`/register?invite=…` prefills the code): code,
  username, display name, PIN → on success, a one-time "Add Face ID /
  fingerprint?" passkey-enrollment prompt (skippable), then the app.
- **AccountScreen:** display name, username; passkey list with add/delete;
  logout. For the owner it additionally shows **People & Invites**: user
  list, mint-invite (copy link), unspent invites with revoke, and per-user
  "issue reset code".

All shadcn/ui components, matching the existing `ServerInfoCard` idiom
(`useAtomValue` + `Result.match`); no glass (that's `liquid-glass-ui`).

## Testing

- **Unit/integration (vitest + sqlite-node in-memory, as in
  `packages/server/test/sql.test.ts`):** rate-limiter windows under
  `TestClock`; invite redemption single-use + transactionality; session
  hashing (row ≠ cookie value, pin_hash is argon2id format); middleware
  Unauthorized/success paths (construct rpc headers with/without a valid
  cookie); first-run invite + first-user-is-owner rule.
- **e2e (existing Playwright harness):** `global-setup.ts` additionally sets
  `APP_ORIGIN=http://localhost:<port>` and a deterministic
  `FIRST_RUN_INVITE`. Passkey specs run **chromium-only** via the CDP
  `WebAuthn.enable` virtual authenticator (webkit has no equivalent —
  documented, not silently skipped: the spec is annotated to the chromium
  project); every other flow (register, PIN login, logout, invites, reset)
  runs on both chromium and webkit.

## Out of scope

Email anything; password managers/passwords (PIN is not a password); account
self-service beyond passkeys + logout (no username/display-name editing);
owner deleting users; multi-owner; open registration (`public-multi-tenancy`
revisits ADR-0002); rate-limit persistence across restarts; audit logging.
Extra is a failure like missing.

## Notes for the builder

- Pin `@simplewebauthn/server` and `/browser` at exact versions like every
  other dep; they are ESM-only.
- Keep `packages/domain` free of simplewebauthn imports — the `Unknown`
  envelope is deliberate.
- `users.username` uniqueness is `COLLATE NOCASE`; the `Username` schema
  lower-bounds the charset so NOCASE (ASCII-only) is sufficient.
- Timestamps are ISO-8601 UTC strings written via Effect `Clock`
  (`DateTime.now`), never `new Date()` — TestClock must drive expiry tests.
- The middleware does one SQL round-trip per rpc (session lookup + user
  join). At friends/family scale this is nothing; do not add caching.
