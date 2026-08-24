import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { SessionNotFound, Unauthorized } from '@j45/domain'
import * as Effect from 'effect/Effect'
import * as Stream from 'effect/Stream'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  onAuthSessionExpired,
  reportAuthSessionExpired,
  withAuthSessionExpiry,
} from '@/lib/auth-session-expiry'

const unsubscribes: (() => void)[] = []

/** Subscribes for one test and unsubscribes in `afterEach` — the registry is module-scoped. */
function listen(): ReturnType<typeof vi.fn> {
  const listener = vi.fn()
  unsubscribes.push(onAuthSessionExpired(listener))
  return listener
}

afterEach(() => {
  for (const unsubscribe of unsubscribes.splice(0)) {
    unsubscribe()
  }
})

describe('auth session expiry signal', () => {
  it('fans a report out to every subscriber, and stops once unsubscribed', () => {
    const first = vi.fn()
    const second = vi.fn()
    const stopFirst = onAuthSessionExpired(first)
    unsubscribes.push(onAuthSessionExpired(second))

    reportAuthSessionExpired()
    expect(first).toHaveBeenCalledTimes(1)
    expect(second).toHaveBeenCalledTimes(1)

    stopFirst()
    reportAuthSessionExpired()
    expect(first).toHaveBeenCalledTimes(1)
    expect(second).toHaveBeenCalledTimes(2)
  })
})

describe('withAuthSessionExpiry', () => {
  it('reports when a request rpc fails Unauthorized, and leaves the failure untouched', async () => {
    const listener = listen()
    const client = withAuthSessionExpiry(() => Effect.fail(new Unauthorized()))

    const exit = await Effect.runPromiseExit(client())

    expect(exit._tag).toBe('Failure')
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('reports when a streaming rpc fails Unauthorized mid-connection', async () => {
    const listener = listen()
    const client = withAuthSessionExpiry(() =>
      Stream.make(1, 2).pipe(Stream.concat(Stream.fail(new Unauthorized()))),
    )

    const exit = await Effect.runPromiseExit(Stream.runCollect(client()))

    expect(exit._tag).toBe('Failure')
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('stays quiet for successes and for every other declared failure', async () => {
    const listener = listen()
    const ok = withAuthSessionExpiry(() => Effect.succeed('fine'))
    const other = withAuthSessionExpiry(() =>
      Effect.fail(new SessionNotFound({ id: 'nope' as SessionNotFound['id'] })),
    )

    expect(await Effect.runPromise(ok())).toBe('fine')
    const exit = await Effect.runPromiseExit(other())

    expect(exit._tag).toBe('Failure')
    expect(listener).not.toHaveBeenCalled()
  })

  it('passes the call’s own arguments straight through', async () => {
    const calls: unknown[][] = []
    const client = withAuthSessionExpiry((...args: unknown[]) => {
      calls.push(args)
      return Effect.succeed(args.length)
    })

    expect(await Effect.runPromise(client('GetWorkout', { id: 'w1' }))).toBe(2)
    expect(calls).toEqual([['GetWorkout', { id: 'w1' }]])
  })
})

describe('the rpc chokepoint', () => {
  /**
   * `withAuthSessionExpiry` and `AuthGate` are each covered above and in
   * `auth-gate.test.tsx`, but nothing exercises the join: every component
   * test provides `ServerRpcClient.runtime` directly, which bypasses
   * `makeEffect` entirely, so a wiring typo there would fail silently. This
   * asserts the wiring itself, the way `main-entry-no-theme-provider.test.ts`
   * asserts `main.tsx`'s.
   */
  it('routes the whole rpc surface through withAuthSessionExpiry', () => {
    const srcDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src')
    const source = fs.readFileSync(path.join(srcDir, 'lib/rpc-client.ts'), 'utf8')

    expect(source).toMatch(/from '@\/lib\/auth-session-expiry'/)
    // The default flat client, mapped through the wrapper, as `makeEffect`.
    expect(source).toMatch(
      /makeEffect:\s*RpcClient\.make\(J45Rpcs,\s*\{\s*flatten:\s*true\s*\}\)\.pipe\(\s*Effect\.map\(withAuthSessionExpiry\),?\s*\)/,
    )
  })
})
