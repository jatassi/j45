import * as Duration from 'effect/Duration'

import { SESSION_LIFETIME } from './auth-sessions.js'

/**
 * The one session cookie this app sets — name pinned by
 * `docs/designs/auth-accounts/design.md`'s "Session cookie contract".
 */
export const SESSION_COOKIE_NAME = 'j45_session'

const isHttpsOrigin = (appOrigin: string): boolean => new URL(appOrigin).protocol === 'https:'

const renderCookie = (value: string, maxAgeSeconds: number, appOrigin: string): string =>
  [
    `${SESSION_COOKIE_NAME}=${value}`,
    'HttpOnly',
    'SameSite=Lax',
    'Path=/',
    `Max-Age=${maxAgeSeconds}`,
    ...(isHttpsOrigin(appOrigin) ? ['Secure'] : []),
  ].join('; ')

/**
 * The `Set-Cookie` header value for a freshly created (or renewed) session
 * token. `Max-Age` is `AuthSessions.SESSION_LIFETIME` in seconds (365
 * days), matching the row's `expires_at`; `Secure` is present iff
 * `appOrigin` is `https` (dev's `http://localhost` origin omits it, since
 * a non-TLS browser would otherwise silently refuse the cookie).
 */
export const sessionSetCookie = (token: string, appOrigin: string): string =>
  renderCookie(token, Duration.toSeconds(SESSION_LIFETIME), appOrigin)

/**
 * The `Set-Cookie` header value that clears the session cookie
 * (`POST /auth/logout`): an empty value with `Max-Age=0`, so the browser
 * deletes it immediately rather than waiting out the original lifetime.
 */
export const sessionClearCookie = (appOrigin: string): string => renderCookie('', 0, appOrigin)
