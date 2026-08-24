import { Unauthorized } from '@j45/domain'
import * as Effect from 'effect/Effect'
import * as Stream from 'effect/Stream'

/**
 * The one place the client learns that the server has stopped recognising it.
 *
 * "Auth session" throughout, never a bare "session" — a `Session` in this
 * project is a live run of a workout (`docs/glossary.md`, and `lib/session.ts`
 * next door), and login state is the `AuthSession` the server keys on.
 *
 * `AuthMiddleware` re-validates the cookie on every rpc call, so a revoked or
 * expired auth session starts failing `Unauthorized` mid-connection — by
 * design (`docs/designs/auth-accounts/design.md`). `AuthGate`'s
 * `GET /auth/me` probe, by contrast, runs once on mount. Without something
 * joining the two, a revoked auth session leaves an authenticated-looking
 * shell where every screen degrades to "Failed to load".
 *
 * This module is that join, and it is deliberately a signal rather than a
 * handler: `withAuthSessionExpiry` wraps the single rpc chokepoint and
 * reports; `AuthGate` subscribes and re-probes `/auth/me`, which flips the
 * gate back to `LoginScreen` on its own. No screen handles `Unauthorized`
 * itself.
 */
type Listener = () => void

const listeners = new Set<Listener>()

/** Subscribes to auth-session-expiry reports; the returned function unsubscribes. */
export const onAuthSessionExpired = (listener: Listener): (() => void) => {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** Reports that the server considers this client anonymous. */
export const reportAuthSessionExpired = (): void => {
  for (const listener of listeners) {
    listener()
  }
}

const reportIfUnauthorized = (error: unknown): Effect.Effect<void> =>
  Effect.sync(() => {
    if (error instanceof Unauthorized) {
      reportAuthSessionExpired()
    }
  })

/**
 * Any rpc call — the flat client is `(tag, payload, options?) => Effect |
 * Stream`, and this wrapper is agnostic about which, so it is typed by what
 * it actually needs: a function it can call and whose result it can inspect.
 */
type RpcCall = (...args: never[]) => unknown

/**
 * `Stream.isStream` isn't part of `effect`'s public surface (and answers true
 * for effects anyway), so streams are recognised the way the module tags
 * them: by their own `StreamTypeId`.
 */
const isStream = (value: unknown): value is Stream.Stream<unknown, unknown, unknown> =>
  typeof value === 'object' && value !== null && Stream.StreamTypeId in value

/**
 * Wraps a flat rpc client so that *any* `Unauthorized` it produces reports
 * session expiry, leaving the failure itself untouched for the caller.
 *
 * Both result shapes are handled: request rpcs fail through `Effect`,
 * streaming ones (`WatchSession`) through `Stream`. `Effect.isEffect` is
 * tested first because `Stream.isStream` is true for effects too.
 */
export const withAuthSessionExpiry = <T extends RpcCall>(client: T): T => {
  // `T`'s parameters are `never`-bottomed by `RpcCall`, so calling and
  // re-typing the wrapper both need the two-step cast; the shape is unchanged.
  const call = client as unknown as (...args: unknown[]) => unknown
  const wrapped = (...args: unknown[]): unknown => {
    const result = call(...args)
    if (Effect.isEffect(result)) {
      return Effect.tapError(result, reportIfUnauthorized)
    }
    if (isStream(result)) {
      return Stream.tapError(result, reportIfUnauthorized)
    }
    return result
  }
  return wrapped as unknown as T
}
