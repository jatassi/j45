# Validation procedure — auth-screens

Replay of the inherited `walking-skeleton` validation binding, scoped to the
auth-screens acceptance criteria. All observations below were made against the
integration tree (`integrate--auth-screens`, redesign tip `c1152e1` + merge of
`loop/auth-screens`).

## Bring-up

- `bun install` — no changes (lockfile already satisfied).
- The Playwright suite (`bun run test:e2e`) manages its own bring-up via
  `e2e/support/global-setup.ts`: it builds the client, runs migrations, boots
  the real server with the auth env (`APP_ORIGIN`/`FIRST_RUN_INVITE`),
  registers the owner account, and mints per-project registration invites.
  For a manual bring-up instead: `bun run dev` (server :3000, Vite :5173).

## Exercise & expected observations

Criterion 1 — login surface (`e2e/auth-login.spec.ts`, chromium + webkit):
- `login-screen` visible; `#login-username` + `#login-pin` filled with the
  owner's real PIN; "Sign in with PIN" lands `library-screen` authenticated.
- A wrong PIN (`000000`) surfaces `login-error-invalid-credentials` inline and
  keeps `login-screen` mounted (typed `InvalidCredentials`, not a crash).
- The passkey hero action (`passkey-login-button`, "Sign in with passkey" with
  the Fingerprint icon) is exercised in the passkey spec below; the wordmark is
  rendered by `AuthLayout`, which wraps all three surfaces.
  Observed: 2/2 login specs green (chromium + webkit).

Criterion 2 — registration (`e2e/auth-register.spec.ts`, chromium + webkit):
- `/register?invite=<code>` prefills `#register-code` with the code before any
  typing (`toHaveValue(code)`).
- Completing the form shows `enroll-passkey-prompt`; skipping lands the user
  authenticated at `library-screen`, display name visible at `/account`.
- An unknown (`UNKNOWN9`) and a spent invite (the first-run code, and a
  second redemption of a per-project code) each surface
  `register-error-invalid-invite` inline and create no `j45_session` cookie.
  Observed: 3/3 register specs green per project.

Criterion 3 — passkey ceremony + cookie flags (`e2e/auth-passkey.spec.ts`,
chromium only via CDP virtual authenticator; cookie flags also in the register
spec):
- Enroll a passkey (`add-passkey-button` → `passkey-list`), log out, and
  `passkey-login-button` alone — username/PIN fields verified empty —
  authenticates back into `account-screen`.
- `context.cookies()` shows `j45_session` with `httpOnly === true` and
  `sameSite === 'Lax'`. Every prior auth assertion is preserved; the e2e diff
  only ADDS the invite-prefill assertion — none weakened or removed.
  Observed: passkey chromium spec green (2.1s); webkit skip is an explicit,
  visible `test.skip` (no webkit CDP WebAuthn), not a silent absence.

Criterion 4 — no bare `<input>` outside `ui/`:
- `grep '<input'` across `login-screen.tsx`, `register-screen.tsx`,
  `enroll-passkey-prompt.tsx`, `auth-layout.tsx` returns nothing; all fields
  now use the kit `Input` / `Field` / `FieldLabel` components.

Criterion 5 — `bun run check`, `bun run test`, `bun run test:e2e` exit 0:
- `check` — all three packages exit 0.
- `test` — 75 files, 350 tests passed.
- `test:e2e` — 51 passed, 3 skipped (the chromium-only live-session + passkey
  specs on webkit), exit 0.
- `lint` (`oxlint --type-aware`) — clean, no suppressions in the diff.

## Teardown

- The e2e harness tears down its own server. For a manual `bun run dev`
  bring-up: Ctrl-C the dev process and `rm -f data/j45.dev.sqlite` to reset
  local state.
