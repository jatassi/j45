/// <reference lib="dom" />
import { expect, test, type Locator, type Page } from '@playwright/test'

/**
 * Live-refraction e2e for `/glass` (`packages/client/src/glass-demo.tsx`):
 * dirty-driven re-render, upload discipline, scroll-following chrome, rim
 * tint/uniform, and tier cap. Mirrors the conventions of `e2e/glass.spec.ts`
 * (self-contained init scripts, `getBaseUrl()`, chromium + webkit projects).
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
 * might be asked for it. Self-contained — Playwright serialises via
 * `toString()` so outer closures would raise `ReferenceError`.
 */
function forceWebgl2Unavailable(): void {
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
        return null
      }
      return original.call(this, contextId, ...rest)
    }
  }
}

/**
 * Init script: counts `texImage2D` / `texSubImage2D` on WebGL2 contexts into
 * `globalThis.__glassTexImage2DCalls` / `__glassTexSubImage2DCalls`.
 *
 * Counting is gated by `__glassTexCounting` (armed after initial uploads
 * settle). Full-upload counts are further restricted to the interior of
 * `measureDirtyUpdate` (between the `glass-dirty-update-start` mark and the
 * `glass-dirty-update` measure) so post-scenario geometry reflows do not
 * pollute the assertion — the criterion is "dirt path never full-uploads",
 * not "no geometry ever". Self-contained.
 */
function countTexUploads(): void {
  const store = globalThis as unknown as {
    __glassTexCounting: boolean
    __glassInDirtyUpdate: boolean
    __glassTexImage2DCalls: number
    __glassTexSubImage2DCalls: number
  }
  store.__glassTexCounting = false
  store.__glassInDirtyUpdate = false
  store.__glassTexImage2DCalls = 0
  store.__glassTexSubImage2DCalls = 0

  const perf = globalThis.performance
  if (typeof perf.mark === 'function' && typeof perf.measure === 'function') {
    const originalMark = perf.mark.bind(perf)
    perf.mark = function patchedMark(
      markName: string,
      markOptions?: PerformanceMarkOptions,
    ): PerformanceMark {
      if (markName === 'glass-dirty-update-start') {
        store.__glassInDirtyUpdate = true
      }
      return originalMark(markName, markOptions)
    }

    const originalMeasure = perf.measure.bind(perf)
    perf.measure = function patchedMeasure(
      measureName: string,
      startOrOptions?: string | PerformanceMeasureOptions,
      endMark?: string,
    ): PerformanceMeasure {
      const result = originalMeasure(measureName, startOrOptions, endMark)
      if (measureName === 'glass-dirty-update') {
        store.__glassInDirtyUpdate = false
      }
      return result
    }
  }

  const proto = WebGL2RenderingContext.prototype as unknown as {
    texImage2D: (...args: unknown[]) => void
    texSubImage2D: (...args: unknown[]) => void
  }

  const originalTexImage2D = Object.getOwnPropertyDescriptor(proto, 'texImage2D')?.value as (
    this: unknown,
    ...args: unknown[]
  ) => void
  proto.texImage2D = function patchedTexImage2D(this: unknown, ...args: unknown[]): void {
    // Only full-uploads that happen inside a dirt-driven composite count —
    // those are the ones the upload-discipline criterion forbids.
    if (store.__glassTexCounting && store.__glassInDirtyUpdate) {
      store.__glassTexImage2DCalls += 1
    }
    originalTexImage2D.apply(this, args)
  }

  const originalTexSubImage2D = Object.getOwnPropertyDescriptor(proto, 'texSubImage2D')?.value as (
    this: unknown,
    ...args: unknown[]
  ) => void
  proto.texSubImage2D = function patchedTexSubImage2D(this: unknown, ...args: unknown[]): void {
    if (store.__glassTexCounting) {
      store.__glassTexSubImage2DCalls += 1
    }
    originalTexSubImage2D.apply(this, args)
  }
}

/**
 * Init script: records whether `getUniformLocation(..., 'uReflect')` was
 * requested and the most recent `uniform1f` value written for that location.
 */
function trackUReflectUniform(): void {
  const store = globalThis as unknown as {
    __uReflectRequested: boolean
    __uReflectLastValue: number | null
  }
  store.__uReflectRequested = false
  store.__uReflectLastValue = null

  const locToName = new WeakMap<object, string>()
  const proto = WebGL2RenderingContext.prototype as unknown as {
    getUniformLocation: (this: unknown, program: unknown, name: string) => object | null
    uniform1f: (this: unknown, location: object | null, value: number) => void
  }

  const originalGetUniformLocation = Object.getOwnPropertyDescriptor(proto, 'getUniformLocation')
    ?.value as (this: unknown, program: unknown, name: string) => object | null
  proto.getUniformLocation = function patchedGetUniformLocation(
    this: unknown,
    program: unknown,
    name: string,
  ): object | null {
    const location = originalGetUniformLocation.call(this, program, name)
    if (name === 'uReflect') {
      store.__uReflectRequested = true
    }
    if (location !== null) {
      locToName.set(location, name)
    }
    return location
  }

  const originalUniform1f = Object.getOwnPropertyDescriptor(proto, 'uniform1f')?.value as (
    this: unknown,
    location: object | null,
    value: number,
  ) => void
  proto.uniform1f = function patchedUniform1f(
    this: unknown,
    location: object | null,
    value: number,
  ): void {
    if (location !== null && locToName.get(location) === 'uReflect') {
      store.__uReflectLastValue = value
    }
    originalUniform1f.call(this, location, value)
  }
}

async function readRenders(locator: Locator): Promise<number> {
  return Number((await locator.getAttribute('data-glass-renders')) ?? '0')
}

/** Wait until every listed surface reports the refract tier. */
async function waitForRefract(page: Page, testIds: readonly string[]): Promise<void> {
  for (const testId of testIds) {
    await expect(page.getByTestId(testId)).toHaveAttribute('data-glass-tier', 'refract', {
      timeout: 5000,
    })
  }
}

// ---------------------------------------------------------------------------
// 1. Live refraction
// ---------------------------------------------------------------------------

test('proxy move re-renders a refracting surface; text mutation alone does not', async ({
  page,
}) => {
  await page.goto(`${getBaseUrl()}/glass`)

  const surface = page.getByTestId('glass-surface-small')
  await expect(surface).toHaveAttribute('data-glass-tier', 'refract', { timeout: 5000 })

  const rendersBeforeClick = await readRenders(surface)
  await page.getByTestId('glass-move-proxy').click()

  await expect
    .poll(async () => readRenders(surface), { timeout: 1000 })
    .toBeGreaterThan(rendersBeforeClick)

  // Fresh stability window: in-page mutating text must not re-render alone.
  const rendersAfterClick = await readRenders(surface)
  await page.waitForTimeout(2000)
  expect(await readRenders(surface)).toBe(rendersAfterClick)
})

// ---------------------------------------------------------------------------
// 2. Upload discipline
// ---------------------------------------------------------------------------

test('dirty updates use texSubImage2D only (no full texImage2D) and emit 10 samples', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.addInitScript(countTexUploads)
  await page.goto(`${getBaseUrl()}/glass`)

  // All refracting surfaces must finish their initial full-canvas uploads
  // before we arm the counters — otherwise late geometry renders pollute the
  // measured window.
  await waitForRefract(page, [
    'glass-surface-small',
    'glass-surface-medium',
    'glass-surface-large',
    'glass-fixed-bar',
  ])
  // Click to arm the scenario, let the button reflow settle, then start
  // counting so the measured window covers the ten 1 Hz dirt ticks only.
  await page.getByTestId('glass-perf-start').click()
  await page.waitForTimeout(200)
  await page.evaluate(() => {
    const store = globalThis as unknown as {
      __glassTexCounting: boolean
      __glassTexImage2DCalls: number
      __glassTexSubImage2DCalls: number
    }
    store.__glassTexImage2DCalls = 0
    store.__glassTexSubImage2DCalls = 0
    store.__glassTexCounting = true
  })

  const scenario = page.getByTestId('glass-perf-scenario')
  await expect
    .poll(
      async () => {
        const samples = (await scenario.getAttribute('data-glass-perf-samples')) ?? ''
        return samples === '' ? 0 : samples.split(',').filter((s) => s.length > 0).length
      },
      { timeout: 15_000 },
    )
    .toBe(10)

  const samplesAttr = (await scenario.getAttribute('data-glass-perf-samples')) ?? ''
  const entries = samplesAttr.split(',').filter((s) => s.length > 0)
  expect(entries).toHaveLength(10)
  for (const entry of entries) {
    expect(Number(entry)).not.toBeNaN()
  }

  const counts = await page.evaluate(() => {
    const store = globalThis as unknown as {
      __glassTexImage2DCalls: number
      __glassTexSubImage2DCalls: number
    }
    return {
      texImage2D: store.__glassTexImage2DCalls,
      texSubImage2D: store.__glassTexSubImage2DCalls,
    }
  })
  expect(counts.texSubImage2D).toBeGreaterThan(0)
  expect(counts.texImage2D).toBe(0)
})

// ---------------------------------------------------------------------------
// 3. Scroll-following chrome
// ---------------------------------------------------------------------------

test('scroll re-renders the fixed bar only; both counts stay flat after scroll stops', async ({
  page,
}) => {
  await page.goto(`${getBaseUrl()}/glass`)

  const fixedBar = page.getByTestId('glass-fixed-bar')
  const medium = page.getByTestId('glass-surface-medium')
  await expect(fixedBar).toBeVisible()
  await expect(medium).toBeVisible()

  // Prefer refract when available so render counts actually move.
  await page
    .waitForFunction(
      () => {
        const bar = document.querySelector('[data-testid="glass-fixed-bar"]')
        return bar instanceof HTMLElement && bar.dataset.glassTier === 'refract'
      },
      { timeout: 5000 },
    )
    .catch(() => undefined)

  const barBefore = await readRenders(fixedBar)
  const mediumBefore = await readRenders(medium)

  // Scroll several times so both chromium and webkit reliably fire scroll.
  for (let i = 0; i < 4; i += 1) {
    await page.evaluate(() => {
      window.scrollBy(0, 300)
    })
    await page.waitForTimeout(50)
  }

  await expect.poll(async () => readRenders(fixedBar), { timeout: 3000 }).toBeGreaterThan(barBefore)

  expect(await readRenders(medium)).toBe(mediumBefore)

  const barAfterScroll = await readRenders(fixedBar)
  const mediumAfterScroll = await readRenders(medium)
  await page.waitForTimeout(2000)
  expect(await readRenders(fixedBar)).toBe(barAfterScroll)
  expect(await readRenders(medium)).toBe(mediumAfterScroll)
})

// ---------------------------------------------------------------------------
// 4a. Rim tint on CSS tier
// ---------------------------------------------------------------------------

test('css-tier surfaces carry a live --rim-tint that updates when the proxy recolors', async ({
  page,
}) => {
  await page.addInitScript(forceWebgl2Unavailable)
  await page.goto(`${getBaseUrl()}/glass`)

  const surfaces = page.locator('.glass-surface')
  await expect(surfaces.first()).toBeVisible()
  const count = await surfaces.count()
  expect(count).toBeGreaterThanOrEqual(3)

  for (let i = 0; i < count; i += 1) {
    const tint = await surfaces
      .nth(i)
      .evaluate((el) => getComputedStyle(el).getPropertyValue('--rim-tint').trim())
    expect(tint.length).toBeGreaterThan(0)
  }

  const small = page.getByTestId('glass-surface-small')
  const tintBefore = await small.evaluate((el) =>
    getComputedStyle(el).getPropertyValue('--rim-tint').trim(),
  )
  expect(tintBefore.length).toBeGreaterThan(0)

  await page.getByTestId('glass-proxy-color').click()

  await expect
    .poll(
      async () =>
        small.evaluate((el) => getComputedStyle(el).getPropertyValue('--rim-tint').trim()),
      { timeout: 3000 },
    )
    .not.toBe(tintBefore)
})

// ---------------------------------------------------------------------------
// 4b. Rim reflection uniform on refract tier
// ---------------------------------------------------------------------------

test('refract path requests uReflect and uploads a nonzero uniform value', async ({ page }) => {
  await page.addInitScript(trackUReflectUniform)
  await page.goto(`${getBaseUrl()}/glass`)

  await expect(page.getByTestId('glass-surface-small')).toHaveAttribute(
    'data-glass-tier',
    'refract',
    { timeout: 5000 },
  )

  const tracked = await page.evaluate(() => {
    const store = globalThis as unknown as {
      __uReflectRequested: boolean
      __uReflectLastValue: number | null
    }
    return {
      requested: store.__uReflectRequested,
      lastValue: store.__uReflectLastValue,
    }
  })
  expect(tracked.requested).toBe(true)
  expect(tracked.lastValue).not.toBeNull()
  expect(tracked.lastValue).not.toBe(0)
})

// ---------------------------------------------------------------------------
// 5. Tier cap
// ---------------------------------------------------------------------------

test('capped surface stays on the css tier with no glass-layer canvas', async ({ page }) => {
  await page.goto(`${getBaseUrl()}/glass`)

  await waitForRefract(page, ['glass-surface-small', 'glass-surface-medium', 'glass-surface-large'])

  const capped = page.getByTestId('glass-capped-surface')
  const deadline = Date.now() + 5000
  while (Date.now() < deadline) {
    await expect(capped).toHaveAttribute('data-glass-tier', 'css')
    await expect(capped.locator('canvas.glass-layer')).toHaveCount(0)
    await page.waitForTimeout(500)
  }

  await expect(capped).toHaveAttribute('data-glass-tier', 'css')
  await expect(capped.locator('canvas.glass-layer')).toHaveCount(0)
})
