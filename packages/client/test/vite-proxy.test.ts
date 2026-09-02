import http from 'node:http'
import net from 'node:net'
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
 * Stands in for `packages/server`: a plain HTTP server answering `/healthz`
 * and `/auth/*`, plus a WebSocket server echoing whatever it receives on
 * `/rpc` — enough to prove the Vite dev server's proxy config
 * (packages/client/vite.config.ts) actually forwards every route to the
 * backend, not just that the config object looks right.
 *
 * It binds port 0 and reports what the OS gave it. A fixed 3000 is the port
 * the app's own dev server uses, so this test could not run while the app was
 * up: it failed by timing out on a listen that never succeeded, which reads
 * as a broken proxy rather than an occupied port. `SERVER_PORT` then points
 * the real proxy rules at whatever this got.
 */
function startFakeBackend(): Promise<{
  http: http.Server
  wss: WebSocketServer
  port: number
  close: () => Promise<void>
}> {
  const server = http.createServer((req, res) => {
    if (req.url === '/healthz') {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ sha: 'fake-backend-sha', version: '0.0.1' }))
      return
    }
    if (req.url?.startsWith('/auth/')) {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ route: req.url }))
      return
    }
    res.writeHead(404)
    res.end()
  })
  const wss = new WebSocketServer({ server, path: '/rpc' })
  wss.on('connection', (socket) => {
    socket.on('message', (data) => socket.send(`echo:${rawDataToString(data)}`))
  })

  return new Promise((resolve, reject) => {
    server.listen(0, () => {
      const address = server.address()
      if (address === null || typeof address === 'string') {
        reject(new Error('fake backend did not bind a TCP port'))
        return
      }
      resolve({
        http: server,
        wss,
        port: address.port,
        close: () =>
          new Promise((closeResolve) => {
            wss.close(() => server.close(() => closeResolve()))
          }),
      })
    })
  })
}

/**
 * A port the OS is willing to hand out, released again before it is returned.
 *
 * Vite is asked for a definite port rather than 0: it drops a falsy
 * `server.port` and falls back to the 5173 in `vite.config.ts`, which is the
 * port the app's own dev server holds.
 */
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = net.createServer()
    probe.listen(0, () => {
      const address = probe.address()
      if (address === null || typeof address === 'string') {
        probe.close(() => reject(new Error('could not reserve a TCP port')))
        return
      }
      const { port } = address
      probe.close(() => resolve(port))
    })
  })
}

describe('vite dev server proxy (packages/client/vite.config.ts)', () => {
  let backend: Awaited<ReturnType<typeof startFakeBackend>> | undefined
  let vite: ViteDevServer | undefined
  let previousServerPort: string | undefined

  afterEach(async () => {
    await vite?.close()
    await backend?.close()
    vite = undefined
    backend = undefined
    if (previousServerPort === undefined) {
      delete process.env.SERVER_PORT
    } else {
      process.env.SERVER_PORT = previousServerPort
    }
    previousServerPort = undefined
  })

  it('proxies /healthz (http), /auth (http), and /rpc (ws) to the backend', async () => {
    backend = await startFakeBackend()

    // Point the config's proxy at the port the fake backend was given. Every
    // port here is one the OS handed out, so the test is hermetic: it runs
    // with the app's own dev server up, and two copies of it can run at once.
    previousServerPort = process.env.SERVER_PORT
    process.env.SERVER_PORT = String(backend.port)

    // Same proxy rules as the real dev server, loaded from vite.config.ts —
    // the rules under test are the shipped ones, not a copy made here.
    const vitePort = await freePort()
    vite = await createServer({
      root: clientRoot,
      configFile: path.join(clientRoot, 'vite.config.ts'),
      server: { port: vitePort, strictPort: true },
    })
    await vite.listen()
    const origin = `localhost:${vitePort}`

    const healthzResponse = await fetch(`http://${origin}/healthz`)
    expect(healthzResponse.status).toBe(200)
    await expect(healthzResponse.json()).resolves.toEqual({
      sha: 'fake-backend-sha',
      version: '0.0.1',
    })

    const authResponse = await fetch(`http://${origin}/auth/me`)
    expect(authResponse.status).toBe(200)
    await expect(authResponse.json()).resolves.toEqual({ route: '/auth/me' })

    const echoed = await new Promise<string>((resolve, reject) => {
      const socket = new WebSocket(`ws://${origin}/rpc`)
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
