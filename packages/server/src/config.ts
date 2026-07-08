import * as Config from 'effect/Config'

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
