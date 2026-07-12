# Validation procedure — session-leave

Replay of the acceptance evidence for per-participant leave. Commands run at the
repo root in the integration worktree; all exited 0.

## Bring-up

- `bun install` — dependencies resolved, no changes (lockfile already satisfied).
- The unit/integration suites and the Playwright e2e suite each manage their own
  process/state, so no long-lived `bun run dev` was needed for this replay. For a
  manual UI walkthrough: `bun run dev` (server :3000, Vite client :5173 proxying
  `/rpc` ws + `/healthz`).

## Exercise + expected observations

- **`bun run check`** — typecheck across `@j45/domain`, `@j45/server`,
  `@j45/client`, all exit 0. Confirms the shrunk `SessionCommand`
  (`pause|resume|skip|prev`, `quit` removed), the new `LeaveSession { id }` rpc,
  and the optional `SessionCompletion.progress` all compile, and the client
  compiles against the shrunk literal (criterion 1).

- **`bun run lint`** — `oxlint --type-aware` exits 0, no suppressions, `.oxlintrc.json`
  untouched.

- **`bun run test`** — 75 files / 350 tests pass. Load-bearing suites:
  - `packages/server/test/session/leave-flow.test.ts` (TestClock):
    - non-host leave mid-session writes exactly one completion for the leaver
      (personal `endedAt` = 5000ms, `progress` 1/4), removes them from published
      participants, and Alice's stream keeps emitting a `paused` state with a
      one-element participant list (criterion 2).
    - last participant leaving with the whole roster departed ends the session
      immediately (`list()` empty, `snapshot` fails, both watch fibers join), one
      completion each, no duplicates (criterion 3, first half).
    - a non-departed participant whose subscription dropped without `leaveSession`
      stays live through 59s, then gets a single row at the 60s GC with the
      session-end `endedAt` (65000ms) and final progress; the explicit leaver keeps
      exactly one leave-time row (criterion 3, second half).
    - leave during ready writes no row; leave-then-rejoin ends with two rows, one
      per stint, distinct ids (criterion 4).
  - `packages/server/test/session/migration-0006.test.ts`: migrating through 0005,
    inserting a legacy 4-column row, then running 0006 leaves the row decodable with
    `progress` absent; `insertAll` with/without progress round-trips; `listForUser`
    returns both rows side by side (criterion 5).

- **`bun run test:e2e`** — 51 passed, 3 skipped (chromium-only specs skipped on
  webkit). Load-bearing specs:
  - `e2e/live-session.spec.ts` (chromium, two logged-in contexts): A leaves
    mid-workout and lands on the library home; B's player keeps running with A gone
    from `session-participants`; B skips to Done and finishes; the ended session card
    clears from A's home within the poll interval (criterion 6, live half).
  - `e2e/history.spec.ts`: A leaves mid-workout (partial progress), B finishes; both
    `/history` rows show Apex name, date, host; the rendered progress numerator
    (`history-progress-<id>`, `N/M`) for A is strictly less than B's (criterion 6,
    history half).

- All three gates exit 0 together (criterion 7).

## Teardown

- Suites clean up their own processes and in-memory / temp SQLite. For a manual
  `bun run dev` session: Ctrl-C the dev process and `rm -f data/j45.dev.sqlite` to
  reset local state.
