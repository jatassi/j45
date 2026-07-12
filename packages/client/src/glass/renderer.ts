import fragmentSource from './glass.frag.glsl?raw'

// Fullscreen-quad vertex shader (ported from personal-site). WebGL2 accepts this
// GLSL ES 1.00 program because no `#version 300 es` directive is present; the
// fragment shader stays 1.00 too, matching the faithful port.
const VERT = `
attribute vec2 aPos;
varying vec2 vUv;
void main() {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}
`

const CONTEXT_OPTIONS: WebGLContextAttributes = {
  alpha: true,
  antialias: false,
  premultipliedAlpha: true,
  preserveDrawingBuffer: false,
  powerPreference: 'high-performance',
}

/** Per-render request: drawing-buffer size in device px plus the shader knobs. */
export type RefractionParams = {
  widthPx: number
  heightPx: number
  dpr: number
  radiusCss: number
  bevel: number
  strength: number
  curvature: number
  chroma: number
  reflect: number
}

/** Anything `texImage2D` accepts as a scene upload (a rasterised slice). */
export type GradientSource = TexImageSource

/**
 * A pinned per-surface texture on the shared WebGL2 context. `upload` replaces
 * the whole texture (`texImage2D`); `uploadRegion` patches a sub-rect in place
 * (`texSubImage2D`), never re-uploading the whole slice. `render` draws the
 * refraction pass sampling this surface's texture; `dispose` frees it.
 */
export type SurfaceTexture = {
  /** Replace the whole texture from `source` (full `texImage2D`). */
  upload(source: TexImageSource): void
  /**
   * Patch a sub-rect from `source` (`texSubImage2D` only). `x`/`y` are the
   * top-left, in device px within the surface's texture (whose size the last
   * full `upload` set), in the same top-down orientation as a full upload.
   */
  uploadRegion(source: TexImageSource, x: number, y: number): void
  /** Draw the refraction pass sampling this texture; null when unavailable. */
  render(params: RefractionParams): ImageBitmap | null
  /** Free the underlying GL texture and drop this surface. */
  dispose(): void
}

/** Context-loss lifecycle events broadcast to subscribers. */
export type ContextEvent = 'lost' | 'restored'

export type RefractionRenderer = {
  /** True when a GL context and a compiled program are ready to render. */
  readonly available: boolean
  /** Render one refraction pass; returns null when unavailable. */
  render(gradient: GradientSource, params: RefractionParams): ImageBitmap | null
  /** The pinned per-surface texture for `id`; the same `id` shares one texture. */
  surface(id: string): SurfaceTexture
  /** Subscribe to context loss/restore; returns an unsubscribe function. */
  subscribe(listener: (event: ContextEvent) => void): () => void
}

type Uniforms = Record<
  | 'uScene'
  | 'uResolution'
  | 'uDpr'
  | 'uRadius'
  | 'uBevel'
  | 'uStrength'
  | 'uCurvature'
  | 'uChroma'
  | 'uReflect',
  WebGLUniformLocation | null
>

type GlResources = {
  program: WebGLProgram
  quad: WebGLBuffer
  sceneTex: WebGLTexture
  uniforms: Uniforms
}

type Scene = {
  gl: WebGL2RenderingContext
  canvas: OffscreenCanvas
  resources: GlResources
}

/** One surface's persistent texture plus the dimensions its last full upload set. */
type SurfaceEntry = {
  texture: WebGLTexture | null
  width: number
  height: number
}

function compileShader(
  gl: WebGL2RenderingContext,
  type: number,
  source: string,
): WebGLShader | null {
  const shader = gl.createShader(type)
  if (!shader) {
    return null
  }
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    gl.deleteShader(shader)
    return null
  }
  return shader
}

function linkProgram(
  gl: WebGL2RenderingContext,
  vertexSource: string,
  fragSource: string,
): WebGLProgram | null {
  const vertex = compileShader(gl, gl.VERTEX_SHADER, vertexSource)
  const fragment = compileShader(gl, gl.FRAGMENT_SHADER, fragSource)
  const program = vertex && fragment ? gl.createProgram() : null
  if (!vertex || !fragment || !program) {
    return null
  }
  gl.attachShader(program, vertex)
  gl.attachShader(program, fragment)
  gl.bindAttribLocation(program, 0, 'aPos')
  gl.linkProgram(program)
  gl.deleteShader(vertex)
  gl.deleteShader(fragment)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    gl.deleteProgram(program)
    return null
  }
  return program
}

/** A clamped, linearly-filtered RGBA texture — the shape every scene slice uses. */
function createSceneTexture(gl: WebGL2RenderingContext): WebGLTexture {
  const texture = gl.createTexture()
  gl.bindTexture(gl.TEXTURE_2D, texture)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  return texture
}

function readUniforms(gl: WebGL2RenderingContext, program: WebGLProgram): Uniforms {
  return {
    uScene: gl.getUniformLocation(program, 'uScene'),
    uResolution: gl.getUniformLocation(program, 'uResolution'),
    uDpr: gl.getUniformLocation(program, 'uDpr'),
    uRadius: gl.getUniformLocation(program, 'uRadius'),
    uBevel: gl.getUniformLocation(program, 'uBevel'),
    uStrength: gl.getUniformLocation(program, 'uStrength'),
    uCurvature: gl.getUniformLocation(program, 'uCurvature'),
    uChroma: gl.getUniformLocation(program, 'uChroma'),
    uReflect: gl.getUniformLocation(program, 'uReflect'),
  }
}

/** Compile the program and its fullscreen quad + scene texture, once. */
function initResources(gl: WebGL2RenderingContext): GlResources | null {
  const program = linkProgram(gl, VERT, fragmentSource)
  const quad = program ? gl.createBuffer() : null
  const sceneTex = program ? createSceneTexture(gl) : null
  if (!program || !quad || !sceneTex) {
    return null
  }
  gl.bindBuffer(gl.ARRAY_BUFFER, quad)
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW)
  return { program, quad, sceneTex, uniforms: readUniforms(gl, program) }
}

/** Pixel dimensions of any `TexImageSource`, however it names its size. */
function sourceDimensions(source: TexImageSource): { width: number; height: number } {
  const s = source as {
    width?: number
    height?: number
    videoWidth?: number
    videoHeight?: number
    displayWidth?: number
    displayHeight?: number
    codedWidth?: number
    codedHeight?: number
  }
  const width = s.width ?? s.videoWidth ?? s.displayWidth ?? s.codedWidth ?? 0
  const height = s.height ?? s.videoHeight ?? s.displayHeight ?? s.codedHeight ?? 0
  return { width, height }
}

/** Full `texImage2D` upload, flipping the top-down source to GL's bottom-up rows. */
function uploadFull(
  gl: WebGL2RenderingContext,
  texture: WebGLTexture,
  source: TexImageSource,
): void {
  gl.bindTexture(gl.TEXTURE_2D, texture)
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true) // 2D source is top-down
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source)
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false)
}

function setUniforms(gl: WebGL2RenderingContext, u: Uniforms, params: RefractionParams): void {
  gl.uniform1i(u.uScene, 0)
  gl.uniform2f(u.uResolution, params.widthPx, params.heightPx)
  gl.uniform1f(u.uDpr, params.dpr)
  gl.uniform1f(u.uRadius, params.radiusCss)
  gl.uniform1f(u.uBevel, params.bevel)
  gl.uniform1f(u.uStrength, params.strength)
  gl.uniform1f(u.uCurvature, params.curvature)
  gl.uniform1f(u.uChroma, params.chroma)
  gl.uniform1f(u.uReflect, params.reflect)
}

/** Size the drawing buffer, draw the pass from `texture`, hand back a bitmap. */
function draw(scene: Scene, texture: WebGLTexture, params: RefractionParams): ImageBitmap {
  const { gl, canvas, resources } = scene
  canvas.width = params.widthPx
  canvas.height = params.heightPx
  gl.viewport(0, 0, params.widthPx, params.heightPx)
  gl.useProgram(resources.program)
  gl.bindBuffer(gl.ARRAY_BUFFER, resources.quad)
  gl.enableVertexAttribArray(0)
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)
  gl.activeTexture(gl.TEXTURE0)
  gl.bindTexture(gl.TEXTURE_2D, texture)
  setUniforms(gl, resources.uniforms, params)
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
  return canvas.transferToImageBitmap()
}

/** A detached canvas — an OffscreenCanvas, so it is never inserted into the DOM. */
function createOffscreen(): OffscreenCanvas | null {
  if (typeof OffscreenCanvas === 'undefined') {
    return null
  }
  return new OffscreenCanvas(1, 1)
}

/** The compiled program, swapped out on context loss and back in on restore. */
type RendererState = { resources: GlResources | null }

/** The shared context plus its live program and per-surface texture registry. */
type RendererCore = {
  gl: WebGL2RenderingContext
  canvas: OffscreenCanvas
  state: RendererState
  surfaces: Map<string, SurfaceEntry>
}

/** The surface returned when there is no GL context: every call is a safe no-op. */
const INERT_SURFACE: SurfaceTexture = {
  upload(): void {
    // no GL context — nothing to upload
  },
  uploadRegion(): void {
    // no GL context — nothing to patch
  },
  render(): ImageBitmap | null {
    return null
  },
  dispose(): void {
    // no GL context — nothing to free
  },
}

/** The pinned SurfaceTexture for one `id`, backed by `entry`'s persistent texture. */
function makeSurfaceTexture(core: RendererCore, id: string, entry: SurfaceEntry): SurfaceTexture {
  const { gl, canvas, state, surfaces } = core
  return {
    upload(source): void {
      if (!state.resources) {
        return
      }
      entry.texture ??= createSceneTexture(gl)
      const { width, height } = sourceDimensions(source)
      uploadFull(gl, entry.texture, source)
      entry.width = width
      entry.height = height
    },
    uploadRegion(source, x, y): void {
      if (!entry.texture) {
        return
      }
      const { height } = sourceDimensions(source)
      // Full uploads flip the top-down source to GL's bottom-up rows, so a
      // sub-rect whose top-left is (x, y) in the source lands with its bottom
      // edge at texture row `textureHeight - y - regionHeight`; texSubImage2D
      // then flips the region's own rows to match.
      const yoffset = entry.height - y - height
      gl.bindTexture(gl.TEXTURE_2D, entry.texture)
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true)
      gl.texSubImage2D(gl.TEXTURE_2D, 0, x, yoffset, gl.RGBA, gl.UNSIGNED_BYTE, source)
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false)
    },
    render(params): ImageBitmap | null {
      if (!state.resources || !entry.texture) {
        return null
      }
      return draw({ gl, canvas, resources: state.resources }, entry.texture, params)
    },
    dispose(): void {
      if (entry.texture) {
        gl.deleteTexture(entry.texture)
      }
      entry.texture = null
      surfaces.delete(id)
    },
  }
}

/** Wire context loss/restore: swap resources, invalidate surface textures, notify. */
function installContextLifecycle(core: RendererCore, notify: (event: ContextEvent) => void): void {
  const { gl, canvas, state, surfaces } = core
  const handleLost = (event: Event): void => {
    event.preventDefault() // opt into restoration
    state.resources = null
    // The lost context invalidates every surface texture; a later re-upload
    // recreates it on the restored context.
    for (const entry of surfaces.values()) {
      entry.texture = null
    }
    notify('lost')
    gl.getExtension('WEBGL_lose_context')?.restoreContext() // one attempt
  }
  const handleRestored = (): void => {
    state.resources = initResources(gl)
    if (state.resources) {
      notify('restored')
    }
  }
  // OffscreenCanvas fires `contextlost`/`contextrestored`; the classic WebGL
  // `webglcontextlost`/`webglcontextrestored` names are honoured too.
  canvas.addEventListener('webglcontextlost', handleLost)
  canvas.addEventListener('contextlost', handleLost)
  canvas.addEventListener('webglcontextrestored', handleRestored)
  canvas.addEventListener('contextrestored', handleRestored)
}

/**
 * Build the shared refraction renderer: one WebGL2 context on a detached canvas,
 * the program compiled once. Missing WebGL2 or a compile/link failure yields a
 * permanently-unavailable renderer that never throws and never logs. On context
 * loss subscribers are notified, one restore is attempted, and — if the program
 * recompiles — subscribers are notified again.
 */
export function createRefractionRenderer(): RefractionRenderer {
  const canvas = createOffscreen()
  const gl = canvas?.getContext('webgl2', CONTEXT_OPTIONS) ?? null
  const listeners = new Set<(event: ContextEvent) => void>()
  const surfaces = new Map<string, SurfaceEntry>()
  const state: RendererState = { resources: gl ? initResources(gl) : null }

  const notify = (event: ContextEvent): void => {
    for (const listener of listeners) {
      listener(event)
    }
  }

  if (canvas && gl) {
    installContextLifecycle({ gl, canvas, state, surfaces }, notify)
  }

  return {
    get available(): boolean {
      return state.resources !== null
    },
    render(gradient, params): ImageBitmap | null {
      if (!gl || !canvas || !state.resources) {
        return null
      }
      uploadFull(gl, state.resources.sceneTex, gradient)
      return draw({ gl, canvas, resources: state.resources }, state.resources.sceneTex, params)
    },
    surface(id): SurfaceTexture {
      if (!gl || !canvas) {
        return INERT_SURFACE
      }
      let entry = surfaces.get(id)
      if (!entry) {
        entry = { texture: null, width: 0, height: 0 }
        surfaces.set(id, entry)
      }
      return makeSurfaceTexture({ gl, canvas, state, surfaces }, id, entry)
    },
    subscribe(listener): () => void {
      listeners.add(listener)
      return (): void => {
        listeners.delete(listener)
      }
    },
  }
}

/** The module's single shared renderer — the only WebGL2 context downstream uses. */
export const refractionRenderer: RefractionRenderer = createRefractionRenderer()
