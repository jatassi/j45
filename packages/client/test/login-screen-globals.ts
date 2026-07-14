import { vi } from 'vitest'

/**
 * Globals `LoginScreen` (and `RegisterScreen`) need that this jsdom runner
 * doesn't provide:
 *
 * - `ResizeObserver` — `input-otp` (the PIN field) constructs one on mount.
 *   Same no-op stand-in glass-demo.test.tsx uses.
 * - `localStorage` — under this runner it resolves to Node's experimental
 *   web-storage global (undefined without `--localstorage-file`), not a
 *   jsdom implementation, and `lib/last-user.ts` needs a working one. A
 *   fresh Map-backed stub per test also keeps the remembered user from
 *   leaking between tests.
 *
 * Call inside `beforeEach`; the usual `vi.unstubAllGlobals()` in
 * `afterEach` undoes both stubs.
 */
export function stubLoginScreenGlobals(): void {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe(): void {
        /* no-op */
      }
      unobserve(): void {
        /* no-op */
      }
      disconnect(): void {
        /* no-op */
      }
    },
  )

  const store = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
    clear: () => {
      store.clear()
    },
  })
}
