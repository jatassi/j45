import { describe, expect, it } from 'vitest'

import type { GeometryInput } from '@/glass/geometry'
import { computeRenderParams, geometryKey } from '@/glass/geometry'

function input(overrides: Partial<GeometryInput> = {}): GeometryInput {
  return {
    rect: { left: 100, top: 50, width: 300, height: 200 },
    scroll: { x: 0, y: 0 },
    dpr: 1,
    radius: 16,
    ...overrides,
  }
}

describe('computeRenderParams', () => {
  // rect × scroll × dpr → expected buffer size + document-space offset/scale
  it.each([
    {
      rect: { left: 0, top: 0, width: 300, height: 200 },
      scroll: { x: 0, y: 0 },
      dpr: 1,
      expected: { bufferWidth: 300, bufferHeight: 200, sliceLeft: 0, sliceTop: 0 },
    },
    {
      rect: { left: 100, top: 50, width: 300, height: 200 },
      scroll: { x: 20, y: 30 },
      dpr: 2,
      expected: { bufferWidth: 600, bufferHeight: 400, sliceLeft: 120, sliceTop: 80 },
    },
    {
      rect: { left: -40, top: 500, width: 150, height: 75 },
      scroll: { x: 400, y: 0 },
      dpr: 3,
      expected: { bufferWidth: 450, bufferHeight: 225, sliceLeft: 360, sliceTop: 500 },
    },
  ])('rect=$rect scroll=$scroll dpr=$dpr → $expected', ({ rect, scroll, dpr, expected }) => {
    const params = computeRenderParams(input({ rect, scroll, dpr }))
    expect(params.bufferWidth).toBe(expected.bufferWidth)
    expect(params.bufferHeight).toBe(expected.bufferHeight)
    expect(params.sliceLeft).toBe(expected.sliceLeft)
    expect(params.sliceTop).toBe(expected.sliceTop)
    expect(params.sliceScale).toBe(dpr)
    expect(params.dpr).toBe(dpr)
  })

  it('carries the card corner radius straight through as radiusCss', () => {
    expect(computeRenderParams(input({ radius: 28 })).radiusCss).toBe(28)
  })

  it('rounds a fractional CSS size × dpr buffer to whole device pixels, never below 1×1', () => {
    const params = computeRenderParams(
      input({ rect: { left: 0, top: 0, width: 0.2, height: 0.4 }, dpr: 1 }),
    )
    expect(params.bufferWidth).toBe(1)
    expect(params.bufferHeight).toBe(1)
  })
})

describe('geometryKey stability', () => {
  it('is invariant under scroll: a card fixed in the document has a constant key across scroll positions', () => {
    const atRest = input({
      rect: { left: 100, top: 400, width: 300, height: 200 },
      scroll: { x: 0, y: 0 },
    })
    const scrolled = input({
      rect: { left: 100, top: 400 - 150, width: 300, height: 200 },
      scroll: { x: 0, y: 150 },
    })
    expect(geometryKey(scrolled)).toBe(geometryKey(atRest))
  })

  it('is stable across repeated calls with the same geometry (content mutation carries no input here)', () => {
    const same = input()
    expect(geometryKey(same)).toBe(geometryKey(same))
  })

  it('changes when the card moves in the document (not just scroll)', () => {
    const before = input({ rect: { left: 100, top: 400, width: 300, height: 200 } })
    const movedInDocument = input({ rect: { left: 100, top: 460, width: 300, height: 200 } })
    expect(geometryKey(movedInDocument)).not.toBe(geometryKey(before))
  })

  it('changes on CSS resize', () => {
    const before = input({ rect: { left: 100, top: 400, width: 300, height: 200 } })
    const resized = input({ rect: { left: 100, top: 400, width: 340, height: 200 } })
    expect(geometryKey(resized)).not.toBe(geometryKey(before))
  })

  it('changes on dpr change', () => {
    const before = input({ dpr: 1 })
    const rescaled = input({ dpr: 2 })
    expect(geometryKey(rescaled)).not.toBe(geometryKey(before))
  })

  it('changes on radius change', () => {
    const before = input({ radius: 16 })
    const rounder = input({ radius: 28 })
    expect(geometryKey(rounder)).not.toBe(geometryKey(before))
  })
})
