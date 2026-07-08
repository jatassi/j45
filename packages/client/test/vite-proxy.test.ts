import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { ViteDevServer } from 'vite'
import { createServer } from 'vite'
import { afterEach, describe, expect, it } from 'vitest'
import type { RawData } from 'ws'
import { WebSocket, WebSocketServer } from 'ws'

const clientRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)))

const rawDataToString = (data: RawData): string => {
  if (Array.isArray(data)) {
    return Buffer.concat(data).toString()
  }
  if (data instanceof ArrayBuffer) {
    return Buffer.from(data).toString()
  }

  return data.toString()
}

/**
 * Stands in for `packages/server` (not yet built when this task lands): a
 * plain HTTP server on :3000 answering `/healthz`, plus a WebSocket server
 * echoing whatever it receives on `/rpc` — enough to prove the Vite dev
 * server's proxy config (packages/client/vite.config.ts) actually forwards
 * both routes to the backend, not just that the config object looks right.
 */
function startFakeBackend(): Promise<{
  http: http.Server
  wss: WebSocketServer
  close: () => Promise<void>
}> {
  const server = http.createServer((req, res) => {
    if (req.url === '/healthz') {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ sha: 'fake-backend-sha', version: '0.0.1' }))
      return
    }
    res.writeHead(404)
    res.end()
  })
  const wss = new WebSocketServer({ server, path: '/rpc' })
  wss.on('connection', (socket) => {
    socket.on('message', (data) => socket.send(`echo:${rawDataToString(data)}`))
  })

  return new Promise((resolve) => {
    server.listen(3000, () => {
      resolve({
        http: server,
        wss,
        close: () =>
          new Promise((closeResolve) => {
            wss.close(() => server.close(() => closeResolve()))
          }),
      })
    })
  })
}

describe('vite dev server proxy (packages/client/vite.config.ts)', () => {
  let backend: Awaited<ReturnType<typeof startFakeBackend>> | undefined
  let vite: ViteDevServer | undefined

  afterEach(async () => {
    await vite?.close()
    await backend?.close()
    vite = undefined
    backend = undefined
  })

  it('proxies /healthz (http) and /rpc (ws) to the backend on :3000', async () => {
    backend = await startFakeBackend()

    // Same proxy rules as the real dev server (loaded from vite.config.ts);
    // only the listening port is overridden so this test doesn't collide
    // with a real `vite`/`bun run dev` bound to 5173.
    vite = await createServer({
      root: clientRoot,
      configFile: path.join(clientRoot, 'vite.config.ts'),
      server: { port: 5199, strictPort: true },
    })
    await vite.listen()

    const healthzResponse = await fetch('http://localhost:5199/healthz')
    expect(healthzResponse.status).toBe(200)
    await expect(healthzResponse.json()).resolves.toEqual({
      sha: 'fake-backend-sha',
      version: '0.0.1',
    })

    const echoed = await new Promise<string>((resolve, reject) => {
      const socket = new WebSocket('ws://localhost:5199/rpc')
      socket.on('open', () => socket.send('ping'))
      socket.on('message', (data) => {
        resolve(rawDataToString(data))
        socket.close()
      })
      socket.on('error', reject)
    })
    expect(echoed).toBe('echo:ping')
  })
})
