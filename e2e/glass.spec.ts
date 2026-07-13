/// <reference lib="dom" />
import { expect, test } from '@playwright/test'

/**
 * Exercises the `/glass` demo route (`packages/client/src/glass-demo.tsx`)
 * against the real built client + server `global-setup.ts` boots. Runs under
 * both the chromium and webkit projects (see `playwright.config.ts`).
 *
 * The shared renderer (`packages/client/src/glass/renderer.ts`) acquires its
 * one WebGL2 context on an `OffscreenCanvas`, not an `HTMLCanvasElement`, so
 * both the "force css tier" and "count acquisitions" init scripts below patch
 * `OffscreenCanvas.prototype.getContext` (alongside `HTMLCanvasElement`'s, for
 * completeness) — patching only the latter would silently observe nothing.
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

/**
 * Init script: counts every `getContext("webgl2")` acquisition across the
 * page onto `globalThis.__webgl2Acquisitions`. Self-contained for the same
 * reason as `forceWebgl2Unavailable`.
 */
function countWebgl2Acquisitions(): void {
  const store = globalThis as unknown as { __webgl2Acquisitions: number }
  store.__webgl2Acquisitions = 0
  const targets = [
    HTMLCanvasElement.prototype as unknown as GetContextLike,
    OffscreenCanvas.prototype as unknown as GetContextLike,
  ]
  for (const target of targets) {
    const original = Object.getOwnPropertyDescriptor(target, 'getContext')
      ?.value as UnboundGetContext
    target.getContext = function patchedGetContext(
      this: GetContextLike,
      contextId: string,
      ...rest: unknown[]
    ): unknown {
      if (contextId === 'webgl2') {
        store.__webgl2Acquisitions += 1
      }
      return original.call(this, contextId, ...rest)
    }
  }
}

/** `backdrop-filter`, falling back to the `-webkit-` alias webkit reports it
 *  under in `getComputedStyle`. */
function readBackdropFilter(el: Element): string {
  const style = getComputedStyle(el)
  const webkitAlias = (style as unknown as { webkitBackdropFilter?: string }).webkitBackdropFilter
  return style.backdropFilter === '' ? (webkitAlias ?? '') : style.backdropFilter
}

test('serves the landing page at "/" and the glass demo at "/glass"', async ({ page }) => {
  const baseUrl = getBaseUrl()

  // The app content is auth-gated (auth-accounts), so an anonymous visit to
  // "/" renders the login screen. `App` installs the document backdrop for
  // every route (glass is app-wide), so exactly one backdrop element exists
  // here too — never a second one.
  await page.goto(baseUrl)
  await expect(page.locator('[data-glass-backdrop]')).toHaveCount(1)
  await expect(page.getByTestId('login-screen')).toBeVisible()

  await page.goto(`${baseUrl}/glass`)
  await expect(page.locator('[data-glass-backdrop]')).toHaveCount(1)
  await expect(page.getByTestId('glass-tier-indicator')).toBeVisible()
})

test('mounts at least three glass surfaces of different sizes/radii, each reaching refract within 5s', async ({
  page,
}) => {
  await page.goto(`${getBaseUrl()}/glass`)

  const surfaces = await page.locator('.glass-surface').all()
  expect(surfaces.length).toBeGreaterThanOrEqual(3)

  const metrics: { width: number; radius: string }[] = []
  for (const surface of surfaces) {
    await expect(surface).toHaveAttribute('data-glass-tier', 'refract', { timeout: 5000 })
    metrics.push(
      await surface.evaluate((el) => ({
        width: Math.round(el.getBoundingClientRect().width),
        radius: getComputedStyle(el).borderTopLeftRadius,
      })),
    )
  }

  expect(new Set(metrics.map((metric) => metric.width)).size).toBeGreaterThanOrEqual(3)
  expect(new Set(metrics.map((metric) => metric.radius)).size).toBeGreaterThanOrEqual(3)
})

test("a refracting surface's render count is stable under text mutation and increases after a resize", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1400, height: 900 })
  await page.goto(`${getBaseUrl()}/glass`)

  const surface = page.getByTestId('glass-surface-small')
  await expect(surface).toHaveAttribute('data-glass-tier', 'refract', { timeout: 5000 })

  const rendersBefore = await surface.getAttribute('data-glass-renders')

  // The demo's text mutates every 250ms; waiting out several ticks with the
  // layout untouched is the only way to prove mutation alone never re-renders.
  await page.waitForTimeout(2000)
  await expect(surface).toHaveAttribute('data-glass-renders', rendersBefore ?? '0')

  await page.setViewportSize({ width: 700, height: 900 })
  await expect
    .poll(async () => Number(await surface.getAttribute('data-glass-renders')))
    .toBeGreaterThan(Number(rendersBefore))
})

test('falls back to the css tier everywhere when webgl2 is unavailable, with zero console errors', async ({
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
  await page.goto(`${getBaseUrl()}/glass`)

  const surfaces = await page.locator('.glass-surface').all()
  expect(surfaces.length).toBeGreaterThanOrEqual(3)

  for (const surface of surfaces) {
    await expect(surface).toHaveAttribute('data-glass-tier', 'css')
    await expect(surface.locator('canvas.glass-layer')).toHaveCount(0)
    expect(await surface.evaluate(readBackdropFilter)).toContain('blur')
  }

  expect(consoleErrors).toEqual([])
})

test('acquires exactly one webgl2 context for the whole page', async ({ page }) => {
  await page.addInitScript(countWebgl2Acquisitions)
  await page.goto(`${getBaseUrl()}/glass`)

  const surfaces = await page.locator('.glass-surface').all()
  expect(surfaces.length).toBeGreaterThanOrEqual(3)
  for (const surface of surfaces) {
    await expect(surface).toHaveAttribute('data-glass-tier', 'refract', { timeout: 5000 })
  }

  const acquisitions = await page.evaluate(
    () => (globalThis as unknown as { __webgl2Acquisitions: number }).__webgl2Acquisitions,
  )
  expect(acquisitions).toBe(1)
})
