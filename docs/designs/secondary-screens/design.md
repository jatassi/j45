# Design — secondary-screens

History and Account redesigned on the design system. Small, shared-treatment
surfaces; no domain/server changes beyond consuming what `session-leave`
already added (the optional `progress` on `SessionCompletion`).

## `/history` (History tab)

- Completion rows as opaque cards, newest first (existing `ListHistory`
  order): workout name (heavy heading), date (relative for the last week,
  absolute after), host + participant pills, and — when the record carries
  `progress` — a compact completion indicator ("Finished" vs a fraction like
  "23/36", rendered as a small bar or ring, not raw numbers alone).
- Rows expand (`accordion`) to the as-run structure summary (pods/stations
  from the snapshot) — read-only; snapshots are truth, not links back to the
  library.
- Feedback standard: skeleton rows; `empty` with a "Start a workout" CTA
  into the library; inline alert + retry on failure.

## `/account` (push layout, via the header avatar chip)

- **Identity card**: avatar-initial block, display name, username.
- **Passkeys**: the existing `PasskeyList` flows on kit components (list,
  add, delete-with-`alert-dialog`).
- **People & invites** (owner only): the `PeopleInvites` flows — user list
  with reset-code issue, invite minting (code display gets a copy affordance
  and the register link), invite revoke behind confirm. Kit components,
  `sonner` on command failures.
- **Server info**: the build/SHA card, demoted to a footer detail.
- **Log out**: destructive-styled button at the bottom (no confirm — it's
  cheap to undo by logging back in).

## e2e impact

`history.spec.ts` gains the progress-indicator assertion (leaver shows a
partial fraction, finisher shows Finished — using the flows `session-leave`
established) and updates selectors. `auth-admin.spec.ts`'s owner-flow
selectors update here if this slice lands after it touches the account
screen; assertions unchanged.
