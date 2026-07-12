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
// The fake GL records the draws and texture calls we assert on and returns
// success for compile and link so the "available" path can be exercised without
// a GPU. Each createTexture returns a fresh identity so per-surface persistence
// is observable.

function createFakeGl(options: { compileOk?: boolean; linkOk?: boolean } = {}) {
  const { compileOk = true, linkOk = true } = options
  const texImage2D = vi.fn<(...args: unknown[]) => void>()
  const texSubImage2D = vi.fn<(...args: unknown[]) => void>()
  const drawArrays = vi.fn<(...args: unknown[]) => void>()
  const restoreContext = vi.fn()
  const createTexture = vi.fn<() => WebGLTexture>(() => ({}))
  const deleteTexture = vi.fn<(texture: unknown) => void>()
  const pixelStorei = vi.fn()
  const explicit: Record<string, unknown> = {
    createShader: () => ({}),
    getShaderParameter: () => compileOk,
    getShaderInfoLog: () => '',
    createProgram: () => ({}),
    getProgramParameter: () => linkOk,
    getProgramInfoLog: () => '',
    createBuffer: () => ({}),
    createTexture,
    deleteTexture,
    getUniformLocation: () => ({}),
    getExtension: (name: string) =>
      name === 'WEBGL_lose_context' ? { restoreContext, loseContext: vi.fn() } : null,
    texImage2D,
    texSubImage2D,
    pixelStorei,
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
  return {
    gl,
    texImage2D,
    texSubImage2D,
    drawArrays,
    restoreContext,
    createTexture,
    deleteTexture,
    pixelStorei,
  }
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
  reflect: 0.5,
}

// A stand-in TexImageSource with the pixel dimensions the renderer reads.
function fakeSource(width: number, height: number): TexImageSource {
  return { width, height } as unknown as TexImageSource
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('glass.frag.glsl', () => {
  it('declares the design-doc uniform set with uScene/uReflect and no uGradient', () => {
    const declared = [...fragmentSource.matchAll(/uniform\s+\w+\s+(u\w+)\s*;/g)].map((m) => m[1])
    expect(new Set(declared)).toEqual(
      new Set([
        'uScene',
        'uResolution',
        'uDpr',
        'uRadius',
        'uBevel',
        'uStrength',
        'uCurvature',
        'uChroma',
        'uReflect',
      ]),
    )
    // uGradient is fully renamed away and the contour-field uniforms stay gone.
    expect(fragmentSource).not.toContain('uGradient')
    expect(fragmentSource).not.toContain('uField')
    // backdrop() reduces to a straight uScene sample.
    expect(fragmentSource).toMatch(/vec3 backdrop\([^)]*\)\s*\{\s*return texture2D\(uScene/)
  })

  it('mixes an outward rim scene sample weighted by uReflect so 0 keeps the refracted output', () => {
    // The reflection is a scene sample offset along the rim normal, then mixed
    // into the refracted colour with `uReflect * rimWeight` as the mix factor —
    // so uReflect = 0.0 reproduces the refracted (previous) rim output exactly.
    expect(fragmentSource).toMatch(/reflection\s*=\s*backdrop\(vUv\s*\+\s*rimNormal/)
    expect(fragmentSource).toMatch(/mix\(refracted,\s*reflection,\s*uReflect\s*\*\s*rimWeight\)/)
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
    // The surface provider is inert but never throws when unavailable.
    const surface = renderer.surface('s')
    expect(() => {
      surface.upload(fakeSource(4, 4))
      surface.uploadRegion(fakeSource(2, 2), 0, 0)
      surface.dispose()
    }).not.toThrow()
    expect(surface.render(PARAMS)).toBeNull()
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

describe('refractionRenderer.surface — per-surface textures', () => {
  it('pins one persistent texture per id: the same id shares it, a new id gets its own', () => {
    const { gl, createTexture } = createFakeGl()
    installFakeOffscreen(gl)
    const renderer = createRefractionRenderer()
    // The shared scene texture is created once at init; count only surface textures.
    const baseTextures = createTexture.mock.results.length

    const a1 = renderer.surface('a')
    const a2 = renderer.surface('a')
    a1.upload(fakeSource(64, 40))
    // A second full upload through the other handle for the same id must not
    // allocate a new texture — it addresses the same one.
    a2.upload(fakeSource(64, 40))
    expect(createTexture.mock.results.length - baseTextures).toBe(1)

    renderer.surface('b').upload(fakeSource(10, 10))
    expect(createTexture.mock.results.length - baseTextures).toBe(2)
  })

  it('frees the surface texture on dispose', () => {
    const { gl, createTexture, deleteTexture } = createFakeGl()
    installFakeOffscreen(gl)
    const renderer = createRefractionRenderer()

    const surface = renderer.surface('a')
    surface.upload(fakeSource(64, 40))
    const created: unknown = createTexture.mock.results.at(-1)?.value
    surface.dispose()

    expect(deleteTexture).toHaveBeenCalledTimes(1)
    expect(deleteTexture.mock.calls[0][0]).toBe(created)
  })

  it('renders from the surface texture only after a full upload', () => {
    const { gl, drawArrays } = createFakeGl()
    const { bitmap } = installFakeOffscreen(gl)
    const renderer = createRefractionRenderer()

    const surface = renderer.surface('a')
    // No upload yet: nothing to sample, so no draw and a null result.
    expect(surface.render(PARAMS)).toBeNull()
    expect(drawArrays).not.toHaveBeenCalled()

    surface.upload(fakeSource(64, 40))
    expect(surface.render(PARAMS)).toBe(bitmap)
    expect(drawArrays).toHaveBeenCalledTimes(1)
  })

  it('invalidates surface textures on context loss and re-uploads after restore', () => {
    const { gl, createTexture, texImage2D } = createFakeGl()
    const { instances } = installFakeOffscreen(gl)
    const renderer = createRefractionRenderer()
    const baseTextures = createTexture.mock.results.length

    const surface = renderer.surface('a')
    surface.upload(fakeSource(64, 40))
    expect(createTexture.mock.results.length - baseTextures).toBe(1)
    const uploadsBeforeLoss = texImage2D.mock.calls.length

    const canvas = instances[0]
    canvas.dispatchEvent(new Event('webglcontextlost', { cancelable: true }))
    canvas.dispatchEvent(new Event('webglcontextrestored'))

    // A re-upload after restore allocates a fresh surface texture and issues a
    // new full texImage2D — the invalidated one does not silently linger.
    // (Restore also re-creates the shared scene texture, so count from just
    // before the re-upload to isolate the surface's allocation.)
    const beforeReupload = createTexture.mock.results.length
    surface.upload(fakeSource(64, 40))
    expect(createTexture.mock.results.length - beforeReupload).toBe(1)
    expect(texImage2D.mock.calls.length).toBe(uploadsBeforeLoss + 1)
  })
})

describe('refractionRenderer.surface — upload discipline', () => {
  it('does a full texImage2D on upload and a flipped-y texSubImage2D only on uploadRegion', () => {
    const { gl, texImage2D, texSubImage2D } = createFakeGl()
    installFakeOffscreen(gl)
    const renderer = createRefractionRenderer()

    const surface = renderer.surface('a')
    const textureHeight = 40
    surface.upload(fakeSource(64, textureHeight))
    expect(texImage2D).toHaveBeenCalledTimes(1)
    expect(texSubImage2D).not.toHaveBeenCalled()

    // Patch a 12-wide × 10-tall region whose top-left is (x=5, y=8) in the
    // top-down source. Full uploads flip Y, so its destination y must flip
    // against the texture height: 40 - 8 - 10 = 22.
    const regionHeight = 10
    surface.uploadRegion(fakeSource(12, regionHeight), 5, 8)

    // texSubImage2D only — never a second full texImage2D during a region patch.
    expect(texImage2D).toHaveBeenCalledTimes(1)
    expect(texSubImage2D).toHaveBeenCalledTimes(1)
    const [, level, xoffset, yoffset] = texSubImage2D.mock.calls[0]
    expect(level).toBe(0)
    expect(xoffset).toBe(5)
    expect(yoffset).toBe(textureHeight - 8 - regionHeight)
    // The region source is forwarded as the pixel payload (last argument).
    expect(texSubImage2D.mock.calls[0].at(-1)).toMatchObject({ width: 12, height: regionHeight })
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
