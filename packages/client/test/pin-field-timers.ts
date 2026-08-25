/**
 * The longest timer `input-otp` leaves pending, plus a margin. Node keeps
 * one expiry-ordered timer list, so a wait started after the library's
 * timers and longer than any of them always expires last — the drain is
 * ordered, not a race against the clock.
 */
const DRAIN_MS = 100

/**
 * Waits for the timers `input-otp` (the PIN field) leaves behind.
 *
 * Every value or focus change schedules three selection-mirroring timers
 * (0 ms, 10 ms and 50 ms) and the effect that schedules them clears none of
 * them on unmount. Each one writes React state, and after unmount the input
 * ref is null, so the library's `!== null` guard passes `undefined` through
 * and the state setters run anyway. React reads `window` to pick an update
 * priority for that write. While the suite's jsdom environment is open the
 * write is a harmless no-op on a detached fiber, but a timer still pending
 * when vitest closes the environment throws
 * `ReferenceError: window is not defined`, which fails the whole run as an
 * uncaught exception even though every test passed.
 *
 * Await in `afterAll` of every suite that mounts `PinField` — directly, or
 * through `LoginScreen`, `RegisterScreen` or `AuthGate`. Those are the same
 * suites that need `stubLoginScreenGlobals` from `./login-screen-globals.js`,
 * because the PIN field cannot mount without it. Once per file is enough:
 * only the environment teardown at the end of the file is destructive.
 */
export function flushPinFieldTimers(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, DRAIN_MS)
  })
}
