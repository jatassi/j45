import path from 'path'

import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

/**
 * Where the dev server proxies `/rpc`, `/healthz` and `/auth`. The default is
 * the port `packages/server`'s own dev script binds (`PORT=3000`), so nothing
 * has to be set to run the app.
 *
 * It is an override rather than a constant because a test needs it:
 * `test/vite-proxy.test.ts` stands a fake backend up and drives the real proxy
 * rules against it. Bound to a fixed 3000 that test cannot run while the app's
 * dev server is up — it would fail by timing out on a port it never manages to
 * bind, which reads as a broken proxy rather than an occupied port.
 */
const backendPort = process.env.SERVER_PORT ?? '3000'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    // Listen on all interfaces so the dev client is reachable from phones on
    // the LAN. Passkeys won't work there (WebAuthn needs a secure context and
    // an rpID matching APP_ORIGIN's localhost) — sign in with username/PIN.
    host: true,
    port: 5173,
    proxy: {
      '/rpc': {
        target: `ws://localhost:${backendPort}`,
        ws: true,
      },
      '/healthz': {
        target: `http://localhost:${backendPort}`,
      },
      '/auth': {
        target: `http://localhost:${backendPort}`,
      },
    },
  },
})
