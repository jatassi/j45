import * as Headers from '@effect/platform/Headers'
import * as DateTime from 'effect/DateTime'
import * as Option from 'effect/Option'

/**
 * Vite's `build.assetsDir` — the one directory inside the client build whose
 * filenames carry a content hash. Kept in step with
 * `packages/client/vite.config.ts`, which leaves the default in place. If the
 * two ever drift, hashed assets fall back to the revalidate-always policy: a
 * forfeited optimisation, never a stale bundle.
 */
const HASHED_ASSETS_DIR = 'assets'

/**
 * `Cache-Control` for the HTML entry document, and for every other build file
 * whose name is stable across deploys (the `public/` passthroughs — the
 * favicon and friends).
 *
 * `no-cache` means "store it, but revalidate before every reuse", which is
 * what makes a deploy land on the next launch. Without it a response carrying
 * `Last-Modified` and no freshness directive licenses a cache to invent a
 * heuristic lifetime (RFC 9111 §4.2.2), and since the entry document names
 * the content-hashed bundle, a stale copy pins the whole app to the previous
 * build. `no-store` would also avoid that, but it forfeits the cheap `304`
 * that `isNotModified` below makes possible.
 */
export const REVALIDATE_CACHE_CONTROL = 'no-cache'

/**
 * `Cache-Control` for content-hashed build assets — a year, without
 * revalidation. Safe because the filename changes whenever the bytes do,
 * which is the entire point of content hashing.
 */
export const IMMUTABLE_CACHE_CONTROL = 'public, max-age=31536000, immutable'

/**
 * The cache policy for one file of the client build, named by `BuildFile`'s
 * `/`-separated path relative to the build root (`index.html`,
 * `assets/index-DDjKQXnb.js`, `vite.svg`).
 *
 * Deliberately keyed on the file actually served rather than the request URL:
 * the client-side-routing fallback serves the entry document under arbitrary
 * paths, and `/assets/../vite.svg` names a file that is not an asset at all —
 * a URL-keyed rule would hand both the wrong policy.
 */
export const cacheControlFor = (buildRelativePath: string): string => {
  const segments = buildRelativePath.split('/')
  return segments.length > 1 && segments[0] === HASHED_ASSETS_DIR
    ? IMMUTABLE_CACHE_CONTROL
    : REVALIDATE_CACHE_CONTROL
}

/** Weak comparison (RFC 9110 §8.8.3.2): a `W/` prefix is ignored on both sides. */
const opaqueTag = (etag: string) => (etag.startsWith('W/') ? etag.slice(2) : etag)

const etagMatches = (ifNoneMatch: string, etag: Option.Option<string>): boolean => {
  if (Option.isNone(etag)) {
    return false
  }
  if (ifNoneMatch.trim() === '*') {
    return true
  }
  const current = opaqueTag(etag.value)
  // Splitting the list on `,` is the universal reading. An opaque tag may in
  // principle contain one, but ours are `<size>-<mtime>` in hex and never do.
  return ifNoneMatch.split(',').some((candidate) => opaqueTag(candidate.trim()) === current)
}

/**
 * An HTTP-date header value as a `DateTime`, `Option.none()` if it will not
 * parse. `new Date(string)` is the parser because `DateTime.make` is built for
 * ISO 8601 — it appends a `Z` to anything un-zoned, so it reads every
 * `IMF-fixdate` (`Sun, 23 Aug 2026 18:01:06 GMT`) as invalid. This is a wire
 * format being decoded, never the clock being read: the project's
 * no-`new Date()` rule is about the latter.
 */
const parseHttpDate = (value: string): Option.Option<DateTime.Utc> => DateTime.make(new Date(value))

const notModifiedSince = (
  ifModifiedSince: string,
  lastModified: Option.Option<string>,
): boolean => {
  // Compared against the `Last-Modified` we would send, not the raw mtime:
  // that header is second-granularity, so a client echoing it back must not
  // lose to the sub-second remainder of the file's real timestamp.
  const since = parseHttpDate(ifModifiedSince)
  const modified = Option.flatMap(lastModified, parseHttpDate)
  return Option.isSome(since) && Option.isSome(modified)
    ? DateTime.lessThanOrEqualTo(modified.value, since.value)
    : false
}

/**
 * Whether a request's validators already describe the response we are about
 * to send — the caller answers `304 Not Modified` instead of a full body.
 *
 * Follows RFC 9110 §13.2.2's precedence: when `If-None-Match` is present it
 * decides outright and `If-Modified-Since` is not evaluated at all.
 */
export const isNotModified = (
  requestHeaders: Headers.Headers,
  responseHeaders: Headers.Headers,
): boolean => {
  const ifNoneMatch = Headers.get(requestHeaders, 'if-none-match')
  if (Option.isSome(ifNoneMatch)) {
    return etagMatches(ifNoneMatch.value, Headers.get(responseHeaders, 'etag'))
  }
  const ifModifiedSince = Headers.get(requestHeaders, 'if-modified-since')
  return Option.isSome(ifModifiedSince)
    ? notModifiedSince(ifModifiedSince.value, Headers.get(responseHeaders, 'last-modified'))
    : false
}
