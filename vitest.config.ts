import path from 'node:path'

import { defineConfig } from 'vitest/config'

// `resolve.alias` mirrors packages/client/vite.config.ts's "@" alias so
// client source files (which use "@/..." imports) resolve correctly when
// their tests are collected by the root vitest runner.
export default defineConfig({
  esbuild: {
    jsx: 'automatic',
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'packages/client/src'),
    },
  },
  test: {
    include: ['packages/*/{src,test}/**/*.test.{ts,tsx}'],
    passWithNoTests: false,
    // `@effect/sql`'s Migrator loads each `packages/server/migrations/*.ts`
    // file via a runtime `import()` of a computed path — Vitest's default
    // SSR "externalize" treats `@effect/sql` as a plain Node dependency, so
    // that inner `import()` skips Vite's resolver entirely and can no
    // longer follow this project's `.js`-specifier-resolves-to-sibling-`.ts`
    // convention for any migration file with its own relative imports
    // (`0003_library.ts`, once it started importing `workouts-repo.ts`,
    // being the first). Inlining `@effect/sql` routes it through Vite's
    // transform/resolution like ordinary app source, matching the real,
    // unaffected production path (`bun run src/main.ts`, no Vite involved).
    server: {
      deps: {
        inline: ['@effect/sql'],
      },
    },
    // Both vite-proxy.test.ts (stub backend) and dev-script.test.ts (real
    // server via `bun run dev`) bind the fixed port :3000, so test files
    // must not run concurrently.
    fileParallelism: false,
  },
})
