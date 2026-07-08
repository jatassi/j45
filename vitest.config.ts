import path from "node:path"
import { defineConfig } from "vitest/config"

// `resolve.alias` mirrors packages/client/vite.config.ts's "@" alias so
// client source files (which use "@/..." imports) resolve correctly when
// their tests are collected by the root vitest runner.
export default defineConfig({
  esbuild: {
    jsx: "automatic"
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "packages/client/src")
    }
  },
  test: {
    include: ["packages/*/{src,test}/**/*.test.{ts,tsx}"],
    passWithNoTests: false,
    // Both vite-proxy.test.ts (stub backend) and dev-script.test.ts (real
    // server via `bun run dev`) bind the fixed port :3000, so test files
    // must not run concurrently.
    fileParallelism: false
  }
})
