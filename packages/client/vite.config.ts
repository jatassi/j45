import path from 'path'

import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

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
        target: 'ws://localhost:3000',
        ws: true,
      },
      '/healthz': {
        target: 'http://localhost:3000',
      },
      '/auth': {
        target: 'http://localhost:3000',
      },
    },
  },
})
