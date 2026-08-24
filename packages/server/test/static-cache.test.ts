import * as Headers from '@effect/platform/Headers'
import { describe, it } from '@effect/vitest'
import { expect } from 'vitest'

import {
  cacheControlFor,
  IMMUTABLE_CACHE_CONTROL,
  isNotModified,
  REVALIDATE_CACHE_CONTROL,
} from '../src/static-cache.js'

describe('cacheControlFor', () => {
  it('revalidates the entry document on every reuse', () => {
    expect(cacheControlFor('index.html')).toBe(REVALIDATE_CACHE_CONTROL)
    expect(REVALIDATE_CACHE_CONTROL).toBe('no-cache')
  })

  it('pins content-hashed build assets for a year', () => {
    expect(cacheControlFor('assets/index-DDjKQXnb.js')).toBe(IMMUTABLE_CACHE_CONTROL)
    expect(cacheControlFor('assets/geist-latin-wght-normal-BgDaEnEv.woff2')).toBe(
      IMMUTABLE_CACHE_CONTROL,
    )
    expect(IMMUTABLE_CACHE_CONTROL).toBe('public, max-age=31536000, immutable')
  })

  it('reads the assets directory as a whole leading segment, not a prefix', () => {
    // A file *named* `assets` at the build root is not the assets directory.
    expect(cacheControlFor('assets')).toBe(REVALIDATE_CACHE_CONTROL)
    // Nor is a nested directory that merely shares its name.
    expect(cacheControlFor('vendor/assets/app.js')).toBe(REVALIDATE_CACHE_CONTROL)
  })

  it('revalidates `public/` passthroughs, whose names are stable across builds', () => {
    expect(cacheControlFor('vite.svg')).toBe(REVALIDATE_CACHE_CONTROL)
  })
})

const conditional = (request: Record<string, string>, response: Record<string, string>) =>
  isNotModified(Headers.fromInput(request), Headers.fromInput(response))

const etag = '"1d6-1a02fc889e2"'
const lastModified = 'Sun, 23 Aug 2026 18:01:06 GMT'

describe('isNotModified', () => {
  it('is false for an unconditional request', () => {
    expect(conditional({}, { etag, 'last-modified': lastModified })).toBe(false)
  })

  it('matches a fresh `If-None-Match`', () => {
    expect(conditional({ 'if-none-match': etag }, { etag })).toBe(true)
  })

  it('rejects a stale `If-None-Match`', () => {
    expect(conditional({ 'if-none-match': '"stale"' }, { etag })).toBe(false)
  })

  it('compares etags weakly, ignoring a `W/` prefix on either side', () => {
    expect(conditional({ 'if-none-match': `W/${etag}` }, { etag })).toBe(true)
    expect(conditional({ 'if-none-match': etag }, { etag: `W/${etag}` })).toBe(true)
  })

  it('matches any member of an `If-None-Match` list, and `*`', () => {
    expect(conditional({ 'if-none-match': `"stale", ${etag}` }, { etag })).toBe(true)
    expect(conditional({ 'if-none-match': '*' }, { etag })).toBe(true)
  })

  it('takes `If-None-Match` as decisive, ignoring `If-Modified-Since`', () => {
    // RFC 9110 §13.2.2: when both are present, `If-Modified-Since` is not
    // evaluated at all — a stale etag alone must still produce a full body.
    expect(
      conditional(
        { 'if-none-match': '"stale"', 'if-modified-since': lastModified },
        { etag, 'last-modified': lastModified },
      ),
    ).toBe(false)
  })

  it('matches an `If-Modified-Since` at or after the resource date', () => {
    expect(
      conditional({ 'if-modified-since': lastModified }, { 'last-modified': lastModified }),
    ).toBe(true)
    expect(
      conditional(
        { 'if-modified-since': 'Mon, 24 Aug 2026 18:01:06 GMT' },
        { 'last-modified': lastModified },
      ),
    ).toBe(true)
  })

  it('rejects an `If-Modified-Since` older than the resource date', () => {
    expect(
      conditional(
        { 'if-modified-since': 'Sat, 22 Aug 2026 18:01:06 GMT' },
        { 'last-modified': lastModified },
      ),
    ).toBe(false)
  })

  it('rejects validators the response cannot answer, or that will not parse', () => {
    expect(conditional({ 'if-none-match': etag }, {})).toBe(false)
    expect(conditional({ 'if-modified-since': lastModified }, {})).toBe(false)
    expect(
      conditional({ 'if-modified-since': 'not a date' }, { 'last-modified': lastModified }),
    ).toBe(false)
  })
})
