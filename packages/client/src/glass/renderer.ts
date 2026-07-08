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
}

/** Anything `texImage2D` accepts as the `uGradient` upload (a rasterised slice). */
export type GradientSource = TexImageSource

/** Context-loss lifecycle events broadcast to subscribers. */
export type ContextEvent = 'lost' | 'restored'

export type RefractionRenderer = {
  /** True when a GL context and a compiled program are ready to render. */
  readonly available: boolean
  /** Render one refraction pass; returns null when unavailable. */
  render(gradient: GradientSource, params: RefractionParams): ImageBitmap | null
  /** Subscribe to context loss/restore; returns an unsubscribe function. */
  subscribe(listener: (event: ContextEvent) => void): () => void
}

type Uniforms = Record<
  | 'uGradient'
  | 'uResolution'
  | 'uDpr'
  | 'uRadius'
  | 'uBevel'
  | 'uStrength'
  | 'uCurvature'
  | 'uChroma',
  WebGLUniformLocation | null
>

type GlResources = {
  program: WebGLProgram
  quad: WebGLBuffer
  gradTex: WebGLTexture
  uniforms: Uniforms
}

type Scene = {
  gl: WebGL2RenderingContext
  canvas: OffscreenCanvas
  resources: GlResources
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

function createGradientTexture(gl: WebGL2RenderingContext): WebGLTexture {
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
    uGradient: gl.getUniformLocation(program, 'uGradient'),
    uResolution: gl.getUniformLocation(program, 'uResolution'),
    uDpr: gl.getUniformLocation(program, 'uDpr'),
    uRadius: gl.getUniformLocation(program, 'uRadius'),
    uBevel: gl.getUniformLocation(program, 'uBevel'),
    uStrength: gl.getUniformLocation(program, 'uStrength'),
    uCurvature: gl.getUniformLocation(program, 'uCurvature'),
    uChroma: gl.getUniformLocation(program, 'uChroma'),
  }
}

/** Compile the program and its fullscreen quad + gradient texture, once. */
function initResources(gl: WebGL2RenderingContext): GlResources | null {
  const program = linkProgram(gl, VERT, fragmentSource)
  const quad = program ? gl.createBuffer() : null
  const gradTex = program ? createGradientTexture(gl) : null
  if (!program || !quad || !gradTex) {
    return null
  }
  gl.bindBuffer(gl.ARRAY_BUFFER, quad)
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW)
  return { program, quad, gradTex, uniforms: readUniforms(gl, program) }
}

function uploadGradient(
  gl: WebGL2RenderingContext,
  gradTex: WebGLTexture,
  gradient: GradientSource,
): void {
  gl.bindTexture(gl.TEXTURE_2D, gradTex)
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true) // 2D source is top-down
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, gradient)
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false)
}

function setUniforms(gl: WebGL2RenderingContext, u: Uniforms, params: RefractionParams): void {
  gl.uniform1i(u.uGradient, 0)
  gl.uniform2f(u.uResolution, params.widthPx, params.heightPx)
  gl.uniform1f(u.uDpr, params.dpr)
  gl.uniform1f(u.uRadius, params.radiusCss)
  gl.uniform1f(u.uBevel, params.bevel)
  gl.uniform1f(u.uStrength, params.strength)
  gl.uniform1f(u.uCurvature, params.curvature)
  gl.uniform1f(u.uChroma, params.chroma)
}

/** Size the drawing buffer, upload the gradient, draw the pass, hand back a bitmap. */
function drawRefraction(
  scene: Scene,
  gradient: GradientSource,
  params: RefractionParams,
): ImageBitmap {
  const { gl, canvas, resources } = scene
  canvas.width = params.widthPx
  canvas.height = params.heightPx
  uploadGradient(gl, resources.gradTex, gradient)
  gl.viewport(0, 0, params.widthPx, params.heightPx)
  gl.useProgram(resources.program)
  gl.bindBuffer(gl.ARRAY_BUFFER, resources.quad)
  gl.enableVertexAttribArray(0)
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)
  gl.activeTexture(gl.TEXTURE0)
  gl.bindTexture(gl.TEXTURE_2D, resources.gradTex)
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
  let resources: GlResources | null = gl ? initResources(gl) : null

  const notify = (event: ContextEvent): void => {
    for (const listener of listeners) {
      listener(event)
    }
  }

  const handleLost = (event: Event): void => {
    event.preventDefault() // opt into restoration
    resources = null
    notify('lost')
    gl?.getExtension('WEBGL_lose_context')?.restoreContext() // one attempt
  }

  const handleRestored = (): void => {
    if (!gl) {
      return
    }
    resources = initResources(gl)
    if (resources) {
      notify('restored')
    }
  }

  if (canvas && gl) {
    // OffscreenCanvas fires `contextlost`/`contextrestored`; the classic WebGL
    // `webglcontextlost`/`webglcontextrestored` names are honoured too.
    canvas.addEventListener('webglcontextlost', handleLost)
    canvas.addEventListener('contextlost', handleLost)
    canvas.addEventListener('webglcontextrestored', handleRestored)
    canvas.addEventListener('contextrestored', handleRestored)
  }

  return {
    get available(): boolean {
      return resources !== null
    },
    render(gradient, params): ImageBitmap | null {
      if (!gl || !canvas || !resources) {
        return null
      }
      return drawRefraction({ gl, canvas, resources }, gradient, params)
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
