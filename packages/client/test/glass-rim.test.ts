// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { rimTintFromSlice } from '@/glass/rim'

/**
 * jsdom's canvas has no real 2d context (`getContext('2d')` returns null).
 * Per-canvas RGBA buffers + a minimal drawImage/getImageData mock exercise
 * the drawImage-reduction path in rim.ts.
 */
type Rgba = { r: number; g: number; b: number }
type Buf = { w: number; h: number; data: Uint8ClampedArray }

const buffers = new WeakMap<HTMLCanvasElement, Buf>()

function bufOf(canvas: HTMLCanvasElement): Buf {
  let buf = buffers.get(canvas)
  if (!buf || buf.w !== canvas.width || buf.h !== canvas.height) {
    buf = {
      w: canvas.width,
      h: canvas.height,
      data: new Uint8ClampedArray(canvas.width * canvas.height * 4),
    }
    buffers.set(canvas, buf)
  }
  return buf
}

function writePixel(buf: Buf, pos: { x: number; y: number }, c: Rgba): void {
  if (pos.x < 0 || pos.y < 0 || pos.x >= buf.w || pos.y >= buf.h) {
    return
  }
  const i = (pos.y * buf.w + pos.x) * 4
  buf.data[i] = c.r
  buf.data[i + 1] = c.g
  buf.data[i + 2] = c.b
  buf.data[i + 3] = 255
}

function fillRect(buf: Buf, rect: { x: number; y: number; w: number; h: number }, c: Rgba): void {
  for (let y = rect.y; y < rect.y + rect.h; y++) {
    for (let x = rect.x; x < rect.x + rect.w; x++) {
      writePixel(buf, { x, y }, c)
    }
  }
}

function inBounds(src: Buf, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < src.w && y < src.h
}

/** Box-filter average of a source rectangle (used when dest is 1×1). */
function averageRect(src: Buf, rect: { x: number; y: number; w: number; h: number }): Rgba {
  let r = 0
  let g = 0
  let b = 0
  let n = 0
  for (let y = rect.y; y < rect.y + rect.h; y++) {
    for (let x = rect.x; x < rect.x + rect.w; x++) {
      if (!inBounds(src, x, y)) {
        continue
      }
      const i = (y * src.w + x) * 4
      r += src.data[i] ?? 0
      g += src.data[i + 1] ?? 0
      b += src.data[i + 2] ?? 0
      n++
    }
  }
  if (n === 0) {
    return { r: 0, g: 0, b: 0 }
  }
  return { r: Math.round(r / n), g: Math.round(g / n), b: Math.round(b / n) }
}

type DrawGeo = {
  sx: number
  sy: number
  sw: number
  sh: number
  dx: number
  dy: number
  dw: number
  dh: number
}

type DrawArgs =
  | [number, number]
  | [number, number, number, number]
  | [number, number, number, number, number, number, number, number]

function parseDrawArgs(src: Buf, args: DrawArgs): DrawGeo {
  if (args.length === 2) {
    return { sx: 0, sy: 0, sw: src.w, sh: src.h, dx: args[0], dy: args[1], dw: src.w, dh: src.h }
  }
  if (args.length === 4) {
    return {
      sx: 0,
      sy: 0,
      sw: src.w,
      sh: src.h,
      dx: args[0],
      dy: args[1],
      dw: args[2],
      dh: args[3],
    }
  }
  return {
    sx: args[0],
    sy: args[1],
    sw: args[2],
    sh: args[3],
    dx: args[4],
    dy: args[5],
    dw: args[6],
    dh: args[7],
  }
}

/** Nearest-neighbour (or box-average when many src px map to one dest) scale blit. */
function scaleBlit(src: Buf, dest: Buf, g: DrawGeo): void {
  for (let py = 0; py < g.dh; py++) {
    for (let px = 0; px < g.dw; px++) {
      const rx = {
        x: g.sx + Math.floor((px * g.sw) / g.dw),
        y: g.sy + Math.floor((py * g.sh) / g.dh),
        w: Math.max(1, Math.floor(((px + 1) * g.sw) / g.dw) - Math.floor((px * g.sw) / g.dw)),
        h: Math.max(1, Math.floor(((py + 1) * g.sh) / g.dh) - Math.floor((py * g.sh) / g.dh)),
      }
      writePixel(dest, { x: g.dx + px, y: g.dy + py }, averageRect(src, rx))
    }
  }
}

function mockDrawImage(canvas: HTMLCanvasElement, image: CanvasImageSource, args: DrawArgs): void {
  if (!(image instanceof HTMLCanvasElement)) {
    throw new Error('test mock only supports canvas sources')
  }
  scaleBlit(bufOf(image), bufOf(canvas), parseDrawArgs(bufOf(image), args))
}

function mockGetImageData(
  canvas: HTMLCanvasElement,
  origin: { x: number; y: number; w: number; h: number },
) {
  const buf = bufOf(canvas)
  const data = new Uint8ClampedArray(origin.w * origin.h * 4)
  for (let y = 0; y < origin.h; y++) {
    for (let x = 0; x < origin.w; x++) {
      const si = ((origin.y + y) * buf.w + (origin.x + x)) * 4
      const di = (y * origin.w + x) * 4
      data[di] = buf.data[si] ?? 0
      data[di + 1] = buf.data[si + 1] ?? 0
      data[di + 2] = buf.data[si + 2] ?? 0
      data[di + 3] = buf.data[si + 3] ?? 0
    }
  }
  return { data, width: origin.w, height: origin.h, colorSpace: 'srgb' } as ImageData
}

function mock2d(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  return {
    drawImage(image: CanvasImageSource, ...args: DrawArgs) {
      mockDrawImage(canvas, image, args)
    },
    getImageData(...rect: [number, number, number, number]) {
      return mockGetImageData(canvas, { x: rect[0], y: rect[1], w: rect[2], h: rect[3] })
    },
  } as unknown as CanvasRenderingContext2D
}

function makeSlice(size: { w: number; h: number }, paint: (buf: Buf) => void): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = size.w
  canvas.height = size.h
  paint(bufOf(canvas))
  return canvas
}

const RED = { r: 200, g: 10, b: 10 }
const BLUE = { r: 0, g: 0, b: 255 }
const GREEN = { r: 0, g: 255, b: 0 }
const STEEL = { r: 40, g: 80, b: 120 }

beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (
    this: HTMLCanvasElement,
    type: string,
  ) {
    if (type === '2d') {
      return mock2d(this)
    }
    return null
  })
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('rimTintFromSlice', () => {
  it('returns the average border-band color as a CSS rgb(...) string', () => {
    const slice = makeSlice({ w: 8, h: 6 }, (buf) => {
      fillRect(buf, { x: 0, y: 0, w: buf.w, h: buf.h }, STEEL)
    })
    expect(rimTintFromSlice(slice)).toBe('rgb(40, 80, 120)')
  })

  it('returns null when no 2d context is available', () => {
    vi.restoreAllMocks()
    // jsdom default: getContext('2d') → null
    const slice = document.createElement('canvas')
    slice.width = 4
    slice.height = 4
    expect(slice.getContext('2d')).toBeNull()
    expect(rimTintFromSlice(slice)).toBeNull()
  })

  it('ignores interior-only pixels — only the border band contributes', () => {
    const withInterior = (interior: Rgba) =>
      makeSlice({ w: 10, h: 10 }, (buf) => {
        fillRect(buf, { x: 0, y: 0, w: buf.w, h: buf.h }, RED)
        fillRect(buf, { x: 1, y: 1, w: buf.w - 2, h: buf.h - 2 }, interior)
      })

    const a = rimTintFromSlice(withInterior(BLUE))
    const b = rimTintFromSlice(withInterior(GREEN))
    expect(a).not.toBeNull()
    expect(b).toBe(a)
    // Border is pure red; interior must not pull the average toward blue/green.
    expect(a).toBe('rgb(200, 10, 10)')
  })
})
