import { NodePath } from '@effect/platform-node'
import * as Path from '@effect/platform/Path'
import { describe, it } from '@effect/vitest'
import * as Effect from 'effect/Effect'
import * as Option from 'effect/Option'
import { expect } from 'vitest'

import { entryDocument, resolveDistPath } from '../src/client-dist.js'

const distDir = '/srv/j45/dist'

const withPath = <A>(f: (path_: Path.Path) => A) =>
  Effect.map(Path.Path, f).pipe(Effect.provide(NodePath.layer))

const resolved = (pathname: string) =>
  withPath((path_) => resolveDistPath(path_, distDir, pathname))

describe('entryDocument', () => {
  it.effect('names the entry document both ways', () =>
    Effect.map(
      withPath((path_) => entryDocument(path_, distDir)),
      (entry) =>
        expect(entry).toStrictEqual({
          absolutePath: '/srv/j45/dist/index.html',
          buildRelativePath: 'index.html',
        }),
    ),
  )
})

describe('resolveDistPath', () => {
  it.effect('maps `/` to the entry document', () =>
    Effect.map(resolved('/'), (result) =>
      expect(result).toStrictEqual(
        Option.some({
          absolutePath: '/srv/j45/dist/index.html',
          buildRelativePath: 'index.html',
        }),
      ),
    ),
  )

  it.effect('maps a file path to its file inside the build', () =>
    Effect.map(resolved('/assets/index-DDjKQXnb.js'), (result) =>
      expect(result).toStrictEqual(
        Option.some({
          absolutePath: '/srv/j45/dist/assets/index-DDjKQXnb.js',
          buildRelativePath: 'assets/index-DDjKQXnb.js',
        }),
      ),
    ),
  )

  it.effect('normalizes redundant segments before naming the file', () =>
    // The relative name is what decides the cache policy, so it has to
    // describe the file served, not the URL that reached it.
    Effect.map(resolved('/assets/../vite.svg'), (result) =>
      expect(result).toStrictEqual(
        Option.some({ absolutePath: '/srv/j45/dist/vite.svg', buildRelativePath: 'vite.svg' }),
      ),
    ),
  )

  it.effect('refuses `..` segments that escape the build', () =>
    Effect.gen(function* () {
      expect(yield* resolved('/../release.env')).toStrictEqual(Option.none())
      expect(yield* resolved('/assets/../../release.env')).toStrictEqual(Option.none())
      // A sibling directory sharing the build's name prefix is still outside it.
      expect(yield* resolved('/../dist-old/index.html')).toStrictEqual(Option.none())
    }),
  )
})
