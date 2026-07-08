# Runbook — auth-accounts

Validated by the Validate agent against integration branch
`integrate--auth-accounts` (merge of `loop/auth-accounts` + all fifteen
sub-branches onto `main`; conflicts in `packages/server/src/main.ts`,
`packages/server/src/server.ts`, `bun.lock` (regenerated), and
`packages/client/src/app.tsx` resolved compositionally; `e2e/glass.spec.ts`'s
landing-page assertion adapted to the auth gate — an anonymous `/` now renders
the login screen). Bun 1.3.x, macOS (darwin).

## Bring-up

```sh
bun install
bun run dev
```

Observed: Vite dev server bound `:5173`, server bound `:3000`; with a fresh
`packages/server/data/j45.dev.sqlite` and `FIRST_RUN_INVITE` unset, the server
logged the first-run banner loudly at startup:

```
################################################################
# FIRST-RUN REGISTRATION INVITE: UJJR22Q9
################################################################
```

## Exercise

All curl probes went through the Vite proxy origin (`http://localhost:5173`,
which forwards `/auth`, `/rpc` ws, and `/healthz` to `:3000`) with
`Origin: http://localhost:5173` on POSTs.

1. **`POST /auth/register`** with the logged first-run code + username/display
   name/PIN → `200`, body `{"user":{…,"role":"owner"}}` (first account is the
   owner), and `Set-Cookie: j45_session=<token>; HttpOnly; SameSite=Lax;
   Path=/; Max-Age=31536000` (no `Secure` — http dev origin, per design).
2. **Same code again** → `400 {"_tag":"InvalidInvite"}` — single-use.
3. **`GET /auth/me`** with the cookie → `200` + the user; without → `401
   {"_tag":"Unauthorized"}`.
4. **`POST /auth/login/pin`** wrong PIN → `401 {"_tag":"InvalidCredentials"}`;
   correct PIN → `200` + `Set-Cookie`.
5. **Rate limit:** 5 consecutive wrong-PIN attempts (each `401`), then the
   *correct* PIN → `429 {"_tag":"RateLimited","retryAfterSeconds":900}`.
   A successful login observed earlier had reset the counter (4 failures after
   a success did not lock) — window and reset behavior match the design.
6. **CSRF:** `POST /auth/login/pin` with `Origin: https://evil.example` →
   `403 {"_tag":"Forbidden"}`.
7. **`POST /auth/logout`** with the cookie → `204`; `GET /auth/me` with the
   same (now-revoked) token → `401`.
8. **`bun run check`** → `@j45/domain`, `@j45/server`, `@j45/client` each
   exit 0. **`bun run lint`** and **`bun run format:check`** → clean.
9. **`bun run test`** → 33 files / 132 tests green, including:
   - `test/auth/first-run.test.ts` — boots the real entrypoint twice against
     one DB: unset `FIRST_RUN_INVITE` mints + logs a random Crockford code
     (redeemable; a restart mints nothing new); set, it logs exactly that code
     and it is redeemable.
   - `test/auth/accounts.test.ts` — first-user-is-owner / later-are-member,
     invite single-use + full transaction rollback, reset revokes all
     sessions and swaps the pin hash.
   - `test/auth/routes.test.ts` — design-table statuses/cookies/error tags,
     CSRF, PIN + invite rate limiting under `TestClock` (locked even for the
     correct PIN; 16 minutes unlocks), reset revoking the prior session,
     sliding `GET /auth/me` refresh past 7 days.
   - `test/auth/middleware.test.ts` — `AuthMiddleware` Unauthorized/success
     unit paths plus the merged `J45Rpcs` over a real Bun websocket:
     `Me`/`ListUsers`/`CreateInvite` with owner/member/garbage cookies.
   - `test/auth/rpc-serve.test.ts` — the production `ServerLive` composition
     spawned via `main.ts`: `ServerInfo` needs no auth; `Me` 401s without and
     succeeds with a valid session cookie on the ws upgrade.
   - `test/auth/schema-sessions.test.ts` — migration 0002 tables,
     NOCASE/CHECK constraints, `token_hash` = SHA-256(token) ≠ cookie value,
     `pin_hash` is `$argon2id$…` via a genuine `bun run` probe (real
     `Bun.password`).
10. **`bun run test:e2e`** → 23 passed, 1 skipped (12s): register/session/
    logout/cookie-attribute, invalid + spent + reused invite, PIN login
    right/wrong on **chromium + webkit**; owner mints an invite in the UI, a
    second context registers, the member sees no admin UI and a direct
    owner-only rpc over the ws fails `Forbidden` (both browsers); the passkey
    enroll → usernameless login ceremony via the CDP virtual authenticator on
    **chromium** (explicit annotated `test.skip` on webkit — no CDP there).
11. **`bun run deploy:sim`** → sanity-checks now include `APP_ORIGIN` in
    `deploy/config.sh` and `release.env`; push → hook → health check →
    rollback all green: `deploy:sim PASSED`.

## Expected observations

All of the above matched the design and acceptance criteria; the only
deviation encountered during validation was pre-existing `e2e/glass.spec.ts`
asserting the pre-auth landing page (fixed in this integration, see header).

## Teardown

```sh
# Ctrl-C the `bun run dev` process (here: pkill'd the backgrounded processes)
pkill -f "bun --watch src/main.ts"; pkill -f vite
rm -f packages/server/data/j45.dev.sqlite   # reset local SQLite state
```

`bun run deploy:sim` is self-contained (temp dir + `trap cleanup EXIT`) and
requires no teardown of its own.
