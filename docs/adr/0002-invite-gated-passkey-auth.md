# ADR-0002 — Invite-gated registration, passkey-first auth, username+PIN fallback

**Status:** accepted (2026-07-07)

## Context

The brief requires accounts for everything (no anonymous guests), near-zero
join friction for sweaty phone users, friends/family scale, and forbids email
infrastructure — which rules out the standard verification and reset flows that
normally make passwords tolerable.

## Decision

- **Registration is invite-gated:** the owner mints invite codes; redeeming one
  is the only way to create an account. This is also the security boundary that
  makes lightweight credentials acceptable — strangers can't register.
- **Passkey-first:** WebAuthn credentials are the primary and encouraged login
  (Face ID / fingerprint on phones — the lowest-friction repeat login that
  exists).
- **Username + PIN fallback:** for devices/browsers where passkeys are awkward
  (shared iPad, older Android). PINs are low-entropy by design; this is
  acceptable only because registration is invite-gated and the deployment is a
  single private instance. Server-side: hashed (Bun.password), rate-limited.
- **Recovery is social, not email:** the owner can re-invite/reset an account.

## Trade-off

We accept a weak fallback credential and owner-mediated recovery in exchange
for zero email infrastructure, minimal login friction, and a registration flow
a new guest completes in under two minutes. Revisit (stronger fallback,
real recovery) before any move beyond the invited circle —
`public-multi-tenancy` explicitly depends on rethinking this ADR.
