# Design — auth-screens

The authentication surfaces redesigned on the design system: login, register,
and the passkey-enroll prompt. These render **outside the router** as
`AuthGate` states (unchanged architecture — the gate probes `/auth/me` and
shows these while anonymous), so they carry their own chrome: centered
column, the J45 wordmark as the identity anchor, no tab bar.

Auth logic, `/auth/*` routes, passkey flows, and cookie semantics are
untouched (`lib/auth-api.ts`, `lib/passkeys.ts`); this is presentation only.

## Screens

- **Login** (`login-screen.tsx`): wordmark lockup above a single card —
  **Sign in with passkey** as the hero action (primary orange, passkey icon),
  a visual divider, then the PIN fallback as kit `field`s (username, PIN with
  numeric keyboard) and a secondary sign-in button. Register link footer
  (invite-gated wording). Typed failures (`InvalidCredentials`, `RateLimited`
  with its window) render as inline `alert`s under the form — same states,
  new dress.
- **Register** (`register-screen.tsx`): reached via `/register?invite=`;
  invite code (prefilled from the query, editable), username, display name,
  PIN — kit `field`s with per-field validation; `InvalidInvite` as inline
  `alert`. Success flows into the existing two-phase enroll prompt.
- **Enroll passkey** (`enroll-passkey-prompt.tsx`): card with Add-passkey
  primary / Skip secondary; unchanged flow.

All three share an auth layout component (wordmark, vertical rhythm, ambient
backdrop consistent with the app ground — subtle, no phase tints).

## e2e impact

The four auth specs (`auth-login`, `auth-register`, `auth-passkey`,
`auth-admin`) update selectors only; every auth assertion (typed errors,
cookie flags, virtual-authenticator flow, invite single-use) is preserved
verbatim — the plan-library-era rule "no auth assertion weakened or removed"
applies to this slice too.
