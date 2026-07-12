# Calibration memory

## Digest

_15 run(s), 21 feature(s) recorded._

### Workflow paths
| path | runs | median agents | median duration |
| --- | --- | --- | --- |
| small | 3 | 3 | 0 |
| standard | 18 | 5 | 43 |

### Re-slices
0 of 21 feature(s) re-sliced (0%).

### Footprint accuracy by size class
| size | features | median planned files | median actual files |
| --- | --- | --- | --- |
| m | 9 | 15 | 20 |

### Top block reasons
- 1× Blocker: `bun run test:e2e` (playwright fullyParallel, chromium+webkit, no worker cap, no retries — the exact criterion-6 command) does not exit 0 in this execution environment. Three default-parallel runs each failed with 3-4 non-deterministic failures, and the failing set differed every run (webkit timer.spec:152 and :219, nav-shell.spec:183 push-routes, flow-control.spec:152). Every one of those tests passes when run in isolation on webkit and in a full serial run. Root cause is CPU contention: load average 12.70 on a 10-core box (partly self-inflicted by repeated e2e builds), which starves the real-time countdown-timer specs so timer-phase never advances from 'Get ready' to 'Work' within the 8s sub-timeout, and starves push-route navigation under load. Evidence the suite content is sound: `bun run test:e2e -- --workers=1` gave 59 passed / 3 skipped / 0 failed, exit 0; nav-shell.spec.ts alone on webkit gave 4/4 passed; timer.spec and flow-control.spec alone on webkit passed (1.4s-24s each). No integrity violations found: no eslint/oxlint suppressions, no lint-config or test-config edits, no weakened tests. The removed history-screen 'LibraryScreen history nav' test and the trimmed library-screen tests covered the deleted LibraryNav navigation, now covered by the tab bar. The 3 skipped e2e tests are pre-existing conditional skips (live-session x2, auth-passkey WebAuthn), not added by this feature.
- 1× Criterion 2 (e2e empty-state + failure/retry) unmet at the specified level: the /history empty state (Start-a-workout CTA into /library) and the query-failure inline alert with a retry control distinct from the loading skeleton are implemented and verified only in packages/client/test/history-screen.test.ts (unit). No e2e anywhere exercises either path — e2e/history.spec.ts contains one populated-history test, and grep across e2e/ finds no reference to the empty CTA, query-boundary-empty, or query-boundary-error. The criterion explicitly says 'e2e'; real-transport (not mocked) failure rendering is unproven end-to-end.; Criterion 1 (participant pills) minor e2e gap: the populated e2e in e2e/history.spec.ts asserts name/date/host/progress/snapshot on chromium+webkit but deliberately does not assert participant pills (documented per-stint-roster reason at assertHistoryRow). Participant-pill rendering is covered only by the unit test (history-screen.test.ts:174/208-223). The criterion lists participant pills as one of the card's four required elements.
- 1× Criterion 6 (bun run test:e2e exits 0): UNMET. The binding-contract suite exited code 1 on two consecutive full runs (4 failed, then 3 failed). Failing tests shift run-to-run (chromium timer.spec.ts:152/219, webkit nav-shell.spec.ts:183, webkit flow-control.spec.ts:152) but every failure has one signature: <div class="fixed inset-x-3 bottom-0 z-20 ..."> (the TabBar) intercepts pointer events on the click target after 'scrolling into view'.; Layout defect (root cause): no tab-layout screen reserves bottom clearance for the floating glass tab bar. The only bottom padding in the codebase is the TabBar's own pb-[env(safe-area-inset-bottom)] in packages/client/src/components/shell/tab-bar.tsx:82. home-screen.tsx, library-screen.tsx, history/generate and workout-detail (which keeps the tab bar) all render content flush to bottom-0, so any interactive element that scrolls to the viewport bottom is covered by the tab bar and becomes unclickable.; Confirmed real, not flake: the two timer.spec.ts tests pass when run in isolation (bunx playwright test timer.spec.ts --project=chromium => 2 passed) but fail under the full fullyParallel suite. ListActiveSessions is server-wide, so live sessions started by sibling specs (live-session, nav-shell startApexSession, flow-control) populate the interim home's ActiveSessionsStrip for unrelated fresh accounts, inflating the page so home-timer-link / tab-library fall behind the tab bar. This deterministically breaks the home quick-action reachability that criteria 3 and 4 depend on.; Criteria 1, 2, 3 (partial), 4 (partial), 5 pass on the runs where the tab-bar overlap doesn't bite (67-68 passing e2e tests) and on code review, but the suite as a whole is red so I fail closed.
- 1× Criterion 7 (bun run test:e2e exits 0): UNMET — the authoritative full-suite run exited 1. e2e/live-session.spec.ts:266 failed at line 328 (assertBothPhase expecting data-phase 'work', received 'rest' solidly for the full 5s timeout). Re-runs showed it is flaky, not a hard fail: ~2 failures in ~9 total runs, more frequent under the suite's fullyParallel workers.; Root cause (racy delivered test, from loop/player-screens--live-session-e2e): lines 324-328 read data-phase one-shot from page A's local DOM and skip only when it reads 'ready', but session-skip acts on the server's authoritative phase. The 'ready' phase is only 5s; B's registration+join takes variable wall-clock time, so the server can auto-advance ready→work before line 324's read while A's DOM momentarily still reads 'ready'. The skip then overshoots work→rest and assertBothPhase('work') fails with 'rest'.; Criterion 1 (data-phase matches segment as it advances, two logged-in contexts): evidence is unreliable — the only test exercising it is the flaky one above; cannot confirm met via a green, deterministic run.; Criterion 2 (leave-confirm / done-Finish / both /history): its assertions live after line 328 in the same test, so they are gated behind the flaky earlier step and never observed on a failing run; they pass on passing runs but inherit the same flake.
- 1× Integrity gate — lint-rule suppression added in the diff: packages/client/src/components/generate-screen.tsx line 1 adds `/* eslint-disable max-lines -- kit redesign ... exceeds the prior native-select 350-line budget */`. This is a lint-rule suppression introduced by the feature branch, which is a defect on its own regardless of a green lint run.; The suppression is load-bearing, not cosmetic: I removed it and re-ran `bun run lint`, which then errors `packages/client/src/components/generate-screen.tsx:479:2 error eslint(max-lines): File has too many lines (457). Maximum allowed is 350`. The .oxlintrc.json rule `max-lines` is set to error at max 350 (skipBlankLines/skipComments). oxlint honors the eslint-disable directive, so lint only passes because the real violation is silenced.; Context (not itself a pass/fail): `bun run check` exits 0 across all packages; the file contains no native <select>/<input>/<textarea> (criterion 4 holds at the surface); `bun run lint` is otherwise clean apart from a pre-existing unrelated warning in packages/client/src/glass/scene.ts (no-console). I did not run test:e2e because the integrity-gate fail is decisive, so e2e criteria 1-3 remain unverified by me.

### Token split (overhead vs build)
Lifetime: 82% overhead / 18% build.
Last-10 median: 100% overhead / 0% build.
Attribution: 10 of 15 run(s) overlapped — the overhead/build split is approximate.

## Runs

- 2026-07-10T01:51:49.162Z · target main · [live-session] · 1 validated · 490008 tokens · serial
- 2026-07-10T05:54:46.840Z · target main · [flow-control] · 1 validated · 187228 tokens · overlapped
- 2026-07-10T06:52:55.615Z · target main · [session-history] · 1 stalled · 519963 tokens · overlapped
- 2026-07-10T08:20:48.589Z · target main · [workout-generation] · 1 validated · 663553 tokens · overlapped
- 2026-07-12T04:12:09.513Z · target redesign · [glass-live-refraction, nav-shell, auth-screens] · 1 validated, 2 blocked · 790218 tokens · overlapped
- 2026-07-12T05:18:42.801Z · target redesign · [glass-live-refraction, nav-shell] · 2 stalled · 1024501 tokens · overlapped
- 2026-07-12T07:09:21.204Z · target redesign · [nav-shell] · 1 blocked · 1110400 tokens · serial
- 2026-07-12T07:27:36.281Z · target redesign · [nav-shell] · 1 blocked · 1165197 tokens · serial
- 2026-07-12T07:46:49.143Z · target redesign · [nav-shell] · 1 validated · 1215858 tokens · serial
- 2026-07-12T08:10:55.187Z · target redesign · [home-dashboard, library-screens] · 2 validated · 1488293 tokens · overlapped
- 2026-07-12T09:39:22.529Z · target redesign · [player-screens, generate-screen] · 2 blocked · 1768429 tokens · overlapped
- 2026-07-12T10:53:53.065Z · target redesign · [player-screens, generate-screen] · 2 validated · 1855739 tokens · overlapped
- 2026-07-12T11:08:31.656Z · target redesign · [secondary-screens] · 1 blocked · 1969584 tokens · overlapped
- 2026-07-12T12:01:16.943Z · target redesign · [secondary-screens] · 1 validated · 2047738 tokens · serial
- 2026-07-12T12:30:54.119Z · target redesign · [editor-screens] · 1 validated · 2292219 tokens · overlapped
