// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'

import fragmentSource from '@/glass/glass.frag.glsl?raw'
import {
  createRefractionRenderer,
  type ContextEvent,
  type GradientSource,
  type RefractionParams,
} from '@/glass/renderer'

// ── Fakes ──────────────────────────────────────────────────────────────────
// jsdom has no OffscreenCanvas and no WebGL, so the renderer's context is faked.
// The fake GL records the draws we assert on and returns success for compile
// and link so the "available" path can be exercised without a GPU.

function createFakeGl(options: { compileOk?: boolean; linkOk?: boolean } = {}) {
  const { compileOk = true, linkOk = true } = options
  const texImage2D = vi.fn()
  const drawArrays = vi.fn()
  const restoreContext = vi.fn()
  const explicit: Record<string, unknown> = {
    createShader: () => ({}),
    getShaderParameter: () => compileOk,
    getShaderInfoLog: () => '',
    createProgram: () => ({}),
    getProgramParameter: () => linkOk,
    getProgramInfoLog: () => '',
    createBuffer: () => ({}),
    createTexture: () => ({}),
    getUniformLocation: () => ({}),
    getExtension: (name: string) =>
      name === 'WEBGL_lose_context' ? { restoreContext, loseContext: vi.fn() } : null,
    texImage2D,
    drawArrays,
  }
  const cache = new Map<string, () => undefined>()
  const gl = new Proxy(explicit, {
    get(target, prop) {
      if (typeof prop !== 'string') {
        return undefined
      }
      if (prop in target) {
        return target[prop]
      }
      let fallback = cache.get(prop)
      if (!fallback) {
        fallback = (): undefined => undefined
        cache.set(prop, fallback)
      }
      return fallback
    },
  }) as unknown as WebGL2RenderingContext
  return { gl, texImage2D, drawArrays, restoreContext }
}

type FakeCanvas = EventTarget & { width: number; height: number }

function installFakeOffscreen(context: WebGL2RenderingContext | null) {
  const bitmap = {} as unknown as ImageBitmap
  const instances: FakeCanvas[] = []
  class FakeOffscreenCanvas extends EventTarget {
    width = 0
    height = 0
    constructor(_width: number, _height: number) {
      super()
      instances.push(this)
    }
    getContext(): WebGL2RenderingContext | null {
      return context
    }
    transferToImageBitmap(): ImageBitmap {
      return bitmap
    }
  }
  vi.stubGlobal('OffscreenCanvas', FakeOffscreenCanvas)
  return { instances, bitmap }
}

function spyConsole() {
  return {
    error: vi.spyOn(console, 'error').mockImplementation(() => undefined),
    warn: vi.spyOn(console, 'warn').mockImplementation(() => undefined),
  }
}

const PARAMS: RefractionParams = {
  widthPx: 200,
  heightPx: 120,
  dpr: 2,
  radiusCss: 28,
  bevel: 34,
  strength: 11,
  curvature: 3,
  chroma: 0.24,
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('glass.frag.glsl', () => {
  it('declares exactly the design-doc uniform set with the uField path removed', () => {
    const declared = [...fragmentSource.matchAll(/uniform\s+\w+\s+(u\w+)\s*;/g)].map((m) => m[1])
    expect(new Set(declared)).toEqual(
      new Set([
        'uGradient',
        'uResolution',
        'uDpr',
        'uRadius',
        'uBevel',
        'uStrength',
        'uCurvature',
        'uChroma',
      ]),
    )
    // The contour-field texture and its mapping uniforms are gone entirely...
    expect(fragmentSource).not.toContain('uField')
    // ...and backdrop() reduces to a straight uGradient sample.
    expect(fragmentSource).toMatch(/vec3 backdrop\([^)]*\)\s*\{\s*return texture2D\(uGradient/)
  })
})

describe('createRefractionRenderer — unavailable paths', () => {
  it('reports unavailable, renders null, and never throws or logs when getContext returns null', () => {
    installFakeOffscreen(null)
    const console_ = spyConsole()

    const renderer = createRefractionRenderer()
    const gradient = {} as unknown as GradientSource

    expect(renderer.available).toBe(false)
    expect(renderer.render(gradient, PARAMS)).toBeNull()
    expect(console_.error).not.toHaveBeenCalled()
    expect(console_.warn).not.toHaveBeenCalled()
  })

  it('reports unavailable and stays silent when the shader fails to compile', () => {
    const { gl } = createFakeGl({ compileOk: false })
    installFakeOffscreen(gl)
    const console_ = spyConsole()

    const renderer = createRefractionRenderer()

    expect(renderer.available).toBe(false)
    expect(console_.error).not.toHaveBeenCalled()
    expect(console_.warn).not.toHaveBeenCalled()
  })
})

describe('createRefractionRenderer — render path', () => {
  it('sizes the drawing buffer, uploads the gradient, draws, and returns the bitmap', () => {
    const { gl, texImage2D, drawArrays } = createFakeGl()
    const { instances, bitmap } = installFakeOffscreen(gl)

    const renderer = createRefractionRenderer()
    expect(renderer.available).toBe(true)

    const gradient = { id: 'slice' } as unknown as GradientSource
    const result = renderer.render(gradient, PARAMS)

    const canvas = instances[0]
    expect(canvas.width).toBe(PARAMS.widthPx)
    expect(canvas.height).toBe(PARAMS.heightPx)
    expect(texImage2D).toHaveBeenCalledTimes(1)
    expect(texImage2D.mock.calls[0]).toContain(gradient)
    expect(drawArrays).toHaveBeenCalledTimes(1)
    expect(result).toBe(bitmap)
  })
})

describe('createRefractionRenderer — context loss/restore', () => {
  it('notifies subscribers on loss, attempts one restore, and notifies again on success', () => {
    const { gl, restoreContext } = createFakeGl()
    const { instances } = installFakeOffscreen(gl)

    const renderer = createRefractionRenderer()
    const events: ContextEvent[] = []
    renderer.subscribe((event) => events.push(event))

    const canvas = instances[0]
    const lost = new Event('webglcontextlost', { cancelable: true })
    canvas.dispatchEvent(lost)

    expect(events).toEqual(['lost'])
    expect(lost.defaultPrevented).toBe(true)
    expect(renderer.available).toBe(false)
    expect(restoreContext).toHaveBeenCalledTimes(1)

    canvas.dispatchEvent(new Event('webglcontextrestored'))

    expect(events).toEqual(['lost', 'restored'])
    expect(renderer.available).toBe(true)
  })
})
