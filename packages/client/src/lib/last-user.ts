import * as Option from 'effect/Option'
import * as Schema from 'effect/Schema'

/**
 * Remembers who signed in with a PIN last, so the login screen can greet
 * them by name and skip the username field (`LoginScreen`'s remembered-user
 * card). Plain identity only — never the PIN or anything session-shaped; the
 * session itself lives in the cookie. localStorage because the point is to
 * survive the session ending.
 *
 * Passkey sign-in deliberately doesn't write here: it's usernameless, so a
 * remembered name buys it nothing, and overwriting the card after a passkey
 * login would clobber the identity the PIN fallback still wants.
 */
const LastUser = Schema.parseJson(
  Schema.Struct({
    username: Schema.String,
    displayName: Schema.String,
  }),
)

export type LastUser = typeof LastUser.Type

const STORAGE_KEY = 'j45.last-user'

/** The remembered user, or `None` when absent/corrupt (corrupt is dropped). */
export function load(): Option.Option<LastUser> {
  const raw = globalThis.localStorage.getItem(STORAGE_KEY)
  if (raw === null) {
    return Option.none()
  }
  const parsed = Schema.decodeUnknownOption(LastUser)(raw)
  if (Option.isNone(parsed)) {
    globalThis.localStorage.removeItem(STORAGE_KEY)
  }
  return parsed
}

export function save(user: LastUser): void {
  globalThis.localStorage.setItem(STORAGE_KEY, Schema.encodeSync(LastUser)(user))
}

/** "Not you?" — forget the remembered identity. */
export function clear(): void {
  globalThis.localStorage.removeItem(STORAGE_KEY)
}
