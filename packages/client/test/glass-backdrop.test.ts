// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'

import type { SliceGeometry } from '@/glass/backdrop'
import {
  BACKDROP_BASE,
  BACKDROP_RADIUS_FACTOR,
  BACKDROP_STOPS,
  installBackdrop,
  mapSliceToGradient,
  rasteriseCardSlice,
} from '@/glass/backdrop'
import { computeRenderParams } from '@/glass/geometry'

afterEach(() => {
  document.body.innerHTML = ''
})

// jsdom's CSSOM normalises hex colours to rgb(); build the same
// representation so assertions match what `el.style.*` actually reports.
function rgb(hex: string): string {
  const n = Number.parseInt(hex.slice(1), 16)
  const r = Math.floor(n / 0x1_00_00) % 0x1_00
  const g = Math.floor(n / 0x1_00) % 0x1_00
  const b = n % 0x1_00
  return `rgb(${r}, ${g}, ${b})`
}

describe('backdrop gradient constants', () => {
  it('is the single source of truth: base + stops from the design doc', () => {
    expect(BACKDROP_BASE).toBe('#08090b')
    expect(BACKDROP_STOPS).toEqual([
      { offset: 0, color: '#15171c' },
      { offset: 0.38, color: '#0b0c10' },
      { offset: 1, color: '#08090b' },
    ])
    expect(BACKDROP_RADIUS_FACTOR).toBe(1.25)
  })
})

describe('installBackdrop', () => {
  it('is idempotent: repeated calls paint the same single full-document element', () => {
    Object.defineProperty(document.documentElement, 'scrollWidth', {
      value: 1200,
      configurable: true,
    })
    Object.defineProperty(document.documentElement, 'scrollHeight', {
      value: 3000,
      configurable: true,
    })
    Object.defineProperty(globalThis, 'innerWidth', { value: 800, configurable: true })
    Object.defineProperty(globalThis, 'innerHeight', { value: 600, configurable: true })

    const first = installBackdrop(document)
    const second = installBackdrop(document)

    expect(second).toBe(first)
    expect(document.querySelectorAll('[data-glass-backdrop]')).toHaveLength(1)
    expect(first.style.width).toBe('1200px')
    expect(first.style.height).toBe('3000px')
    expect(first.style.backgroundColor).toBe(rgb(BACKDROP_BASE))
    expect(first.style.backgroundImage).toContain(`${rgb('#15171c')} 0%`)
    expect(first.style.backgroundImage).toContain(`${rgb('#0b0c10')} 38%`)
    expect(first.style.backgroundImage).toContain(`${rgb('#08090b')} 100%`)
    // radius = 1.25 × max(viewport dims) = 1.25 × 800 = 1000
    expect(first.style.backgroundImage).toContain('circle 1000px at 50% 0px')
  })

  it('repaints (rather than duplicating) when the document/viewport size changes between calls', () => {
    Object.defineProperty(document.documentElement, 'scrollWidth', {
      value: 800,
      configurable: true,
    })
    Object.defineProperty(document.documentElement, 'scrollHeight', {
      value: 600,
      configurable: true,
    })
    Object.defineProperty(globalThis, 'innerWidth', { value: 800, configurable: true })
    Object.defineProperty(globalThis, 'innerHeight', { value: 600, configurable: true })
    installBackdrop(document)

    Object.defineProperty(document.documentElement, 'scrollHeight', {
      value: 4000,
      configurable: true,
    })
    Object.defineProperty(globalThis, 'innerHeight', { value: 1200, configurable: true })
    const repainted = installBackdrop(document)

    expect(document.querySelectorAll('[data-glass-backdrop]')).toHaveLength(1)
    expect(repainted.style.height).toBe('4000px')
    expect(repainted.style.backgroundImage).toContain('circle 1500px at 50% 0px')
  })
})

function sliceGeometry(overrides: Partial<SliceGeometry> = {}): SliceGeometry {
  return { sliceLeft: 0, sliceTop: 0, bufferWidth: 300, bufferHeight: 200, dpr: 1, ...overrides }
}

describe('mapSliceToGradient (backdrop slice mapping)', () => {
  // slice (sliceLeft/Top, dpr) × viewport × documentWidth → expected centre/radius, device px
  it.each([
    {
      slice: sliceGeometry(),
      viewport: { width: 1000, height: 800 },
      documentWidth: 1000,
      expected: { centerX: 500, centerY: 0, radius: 1.25 * 1000 },
    },
    {
      slice: sliceGeometry({ sliceLeft: 120, sliceTop: 80, dpr: 2 }),
      viewport: { width: 1000, height: 800 },
      documentWidth: 1000,
      expected: { centerX: (500 - 120) * 2, centerY: -80 * 2, radius: 1.25 * 1000 * 2 },
    },
    {
      slice: sliceGeometry({ sliceLeft: -200, sliceTop: 900, dpr: 3 }),
      viewport: { width: 600, height: 1400 },
      documentWidth: 1400,
      expected: { centerX: (700 - -200) * 3, centerY: -900 * 3, radius: 1.25 * 1400 * 3 },
    },
  ])(
    'slice=$slice viewport=$viewport documentWidth=$documentWidth → $expected',
    ({ slice, viewport, documentWidth, expected }) => {
      const mapping = mapSliceToGradient({ slice, viewport, documentWidth })
      expect(mapping.centerX).toBeCloseTo(expected.centerX)
      expect(mapping.centerY).toBeCloseTo(expected.centerY)
      expect(mapping.radius).toBeCloseTo(expected.radius)
      expect(mapping.canvasWidth).toBe(slice.bufferWidth)
      expect(mapping.canvasHeight).toBe(slice.bufferHeight)
    },
  )

  it('composes directly with geometry.ts render params (rect × scroll × dpr → slice offset feeding the gradient mapping)', () => {
    const params = computeRenderParams({
      rect: { left: 100, top: 50, width: 300, height: 200 },
      scroll: { x: 20, y: 30 },
      dpr: 2,
      radius: 16,
    })
    const mapping = mapSliceToGradient({
      slice: params,
      viewport: { width: 1000, height: 800 },
      documentWidth: 1000,
    })
    // sliceLeft = 120, sliceTop = 80 → centerX = (500-120)*2, centerY = -80*2
    expect(mapping.centerX).toBeCloseTo(760)
    expect(mapping.centerY).toBeCloseTo(-160)
    expect(mapping.canvasWidth).toBe(600)
    expect(mapping.canvasHeight).toBe(400)
  })
})

describe('rasteriseCardSlice', () => {
  it('sizes the small canvas from the slice buffer and never throws, even without a 2D context', () => {
    const canvas = rasteriseCardSlice({
      slice: sliceGeometry({ bufferWidth: 240, bufferHeight: 160 }),
      viewport: { width: 1000, height: 800 },
      documentWidth: 1000,
      document,
    })
    expect(canvas.width).toBe(240)
    expect(canvas.height).toBe(160)
  })
})
