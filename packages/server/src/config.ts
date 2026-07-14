import * as Config from 'effect/Config'
import type * as Option from 'effect/Option'

/**
 * The port the Bun http server listens on. Defaults to 3000 for local
 * development; the deploy hook overrides it via systemd `EnvironmentFile`.
 */
export const PortConfig: Config.Config<number> = Config.integer('PORT').pipe(
  Config.withDefault(3000),
)

/**
 * The git SHA this server was deployed from, reported by `/healthz` and the
 * `ServerInfo` rpc. Defaults to `"dev"` outside of a real deploy; the
 * post-receive hook writes the real value into `release.env`.
 */
export const ReleaseShaConfig: Config.Config<string> = Config.string('RELEASE_SHA').pipe(
  Config.withDefault('dev'),
)

/**
 * Whether the wildcard route serves the built client from `ClientDistDir`.
 * True in production, where the single Bun process is the one origin for the
 * client, `/rpc`, and `/healthz`. The server's `dev` script sets it false:
 * in dev the live client is Vite on :5173 (see `AppOriginConfig`), and
 * serving a stale `packages/client/dist` from :3000 would only mislead.
 */
export const ServeClientConfig: Config.Config<boolean> = Config.boolean('SERVE_CLIENT').pipe(
  Config.withDefault(true),
)

/**
 * The origin the client is served from (scheme + host[:port], no path).
 * Determines whether the session cookie's `Set-Cookie` sets `Secure`
 * (`auth/cookie.ts`, iff this is `https`) and is WebAuthn's rpID/expected-
 * origin source (a later auth-accounts task). Defaults to the Vite dev
 * server; the deploy hook overrides it to `https://j45.atassi.org`.
 */
export const AppOriginConfig: Config.Config<string> = Config.string('APP_ORIGIN').pipe(
  Config.withDefault('http://localhost:5173'),
)

/**
 * Pins the value of the first-run invite code minted at startup when
 * `users` is empty (a later auth-accounts task) — deterministic for dev
 * and the Playwright e2e harness. Left unset (and so random) on the VPS.
 */
export const FirstRunInviteConfig: Config.Config<Option.Option<string>> = Config.option(
  Config.string('FIRST_RUN_INVITE'),
)
