/// <reference lib="dom" />
import { expect, test } from '@playwright/test'

/**
 * Exercises the `/design` gallery route
 * (`packages/client/src/components/design/design-page.tsx`) against the real
 * built client + server `global-setup.ts` boots. Runs under both the chromium
 * and webkit projects (see `playwright.config.ts`).
 *
 * The shared renderer (`packages/client/src/glass/renderer.ts`) acquires its
 * one WebGL2 context on an `OffscreenCanvas`, not an `HTMLCanvasElement`, so
 * the "force css tier" init script below patches
 * `OffscreenCanvas.prototype.getContext` (alongside `HTMLCanvasElement`'s, for
 * completeness) — patching only the latter would silently observe nothing.
 *
 * Fully self-contained: Playwright serialises init scripts via `toString()`,
 * so no outer-closure references.
 */

function getBaseUrl(): string {
  const baseUrl = process.env.E2E_BASE_URL
  if (baseUrl === undefined) {
    throw new Error('E2E_BASE_URL is unset — did global-setup.ts run?')
  }
  return baseUrl
}

type GetContextLike = { getContext(...args: unknown[]): unknown }
type UnboundGetContext = (this: GetContextLike, contextId: string, ...rest: unknown[]) => unknown

/**
 * Init script: `getContext("webgl2")` returns `null` everywhere a canvas
 * might be asked for it, simulating a browser with no WebGL2. Fully
 * self-contained (no reference to module-scope helpers) because Playwright
 * serialises this function via `toString()` and re-evaluates it in the
 * page — outer closures would be lost, raising a `ReferenceError`.
 */
function forceWebgl2Unavailable(): void {
  const targets = [
    HTMLCanvasElement.prototype as unknown as GetContextLike,
    OffscreenCanvas.prototype as unknown as GetContextLike,
  ]
  for (const target of targets) {
    // Read via the property descriptor, not a bare `target.getContext`
    // member access, so nothing here is "an unbound method" — the plain
    // `function` below always forwards the real caller's `this` explicitly.
    const original = Object.getOwnPropertyDescriptor(target, 'getContext')
      ?.value as UnboundGetContext
    target.getContext = function patchedGetContext(
      this: GetContextLike,
      contextId: string,
      ...rest: unknown[]
    ): unknown {
      if (contextId === 'webgl2') {
        return null
      }
      return original.call(this, contextId, ...rest)
    }
  }
}

test('loads /design unauthenticated with zero console errors and glass at refract', async ({
  page,
}) => {
  const consoleErrors: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error') {
      consoleErrors.push(message.text())
    }
  })
  page.on('pageerror', (error) => {
    consoleErrors.push(error.message)
  })

  await page.goto(`${getBaseUrl()}/design`)

  // Pre-gate: the login screen must not mount.
  await expect(page.getByTestId('login-screen')).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'Gallery' })).toBeVisible()

  const surface = page.getByTestId('design-glass-surface')
  await expect(surface).toHaveAttribute('data-glass-tier', 'refract', { timeout: 5000 })

  expect(consoleErrors).toEqual([])
})

test('falls back to the css glass tier when webgl2 is unavailable, with zero console errors', async ({
  page,
}) => {
  const consoleErrors: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error') {
      consoleErrors.push(message.text())
    }
  })
  page.on('pageerror', (error) => {
    consoleErrors.push(error.message)
  })

  await page.addInitScript(forceWebgl2Unavailable)
  await page.goto(`${getBaseUrl()}/design`)

  const surface = page.getByTestId('design-glass-surface')
  await expect(surface).toHaveAttribute('data-glass-tier', 'css')
  await expect(surface.locator('canvas.glass-layer')).toHaveCount(0)

  expect(consoleErrors).toEqual([])
})
