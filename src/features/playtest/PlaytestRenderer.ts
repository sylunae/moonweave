import type { ChartNote } from '@/features/chart/types'

const NOTE_STRIDE = 6
const PARTICLE_STRIDE = 8
const MAX_PARTICLES = 2048
const HORIZON_MS = 1_400
const MAX_BEAT_BUFFER_FLOATS = 1024
const LANE_COLORS = [
  [0.192, 0.843, 1, 1],
  [0.718, 0.533, 1, 1],
  [0.718, 0.533, 1, 1],
  [0.192, 0.843, 1, 1],
] as const

export interface PlaytestStats {
  fps: number
  backend: 'WebGL2'
  renderScale: number
  notes: number
  particles: number
  drawCalls: number
  frameTimeP95: number
  frameTimeMax: number
  longFramePercent: number
  clockStalls: number
}

interface PlaytestRendererOptions {
  canvas: HTMLCanvasElement
  notes: ChartNote[]
  laneTilt: number
  scrollSpeed: number
  bpm: number
  offset: number
  getTime(): number
  getPlaying(): boolean
  autoplay: boolean
  transparentBackground?: boolean
  initialRenderScale?: number
  onStats(stats: PlaytestStats): void
  onAutoplayHit?(lane: number): void
}

type GLProgram = {
  program: WebGLProgram
  uniforms: Record<string, WebGLUniformLocation | null>
}

const NOTE_VERTEX = `#version 300 es
precision highp float;
layout(location=0) in vec2 aCorner;
layout(location=1) in vec4 iNote;
layout(location=2) in float iColor;
layout(location=3) in float iActive;
uniform float uTime;
uniform float uHorizon;
uniform float uTilt;
uniform float uViewportHeight;
out vec2 vUv;
flat out float vKind;
flat out float vColor;
flat out float vActive;

float visualScreenY(float noteTime) {
  float trackTopScale = 1.0 - uTilt * 0.82;
  float curve = -log(trackTopScale);
  float curveRange = exp(curve) - 1.0;
  float startSlope = curve > 0.0001 ? curve / curveRange : 1.0;
  float endSlope = curve > 0.0001 ? curve * exp(curve) / curveRange : 1.0;
  float progress = 1.0 - (noteTime - uTime) / uHorizon;
  float eased = progress < 0.0 ? progress * startSlope
    : progress > 1.0 ? 1.0 + (progress - 1.0) * endSlope
    : curve > 0.0001 ? (exp(curve * progress) - 1.0) / curveRange
    : progress;
  return eased * 0.86;
}

float trackScaleAt(float screenY) {
  float trackTopScale = 1.0 - uTilt * 0.82;
  // Keep extending the perspective line outside the visible track. Clamping
  // here makes notes switch to vertical motion after the judgment line and
  // shears holds whose other endpoint is still inside the track.
  return mix(trackTopScale, 1.0, screenY / 0.86);
}

vec2 projectTrack(float lanePosition, float screenY) {
  float trackScale = trackScaleAt(screenY);
  float x = (lanePosition * 2.0 - 1.0) * 0.80 * trackScale;
  return vec2(x, 1.0 - screenY * 2.0);
}

void main() {
  float lane = iNote.x;
  float startTime = iNote.y;
  float endTime = iNote.z;
  float kind = iNote.w;
  float widthInset = kind > 0.5 ? 0.09 : 0.08;
  float lanePosition = (lane + mix(widthInset, 1.0 - widthInset, aCorner.x)) / 4.0;
  float bottomY = visualScreenY(startTime);
  float topY = kind > 0.5
    ? visualScreenY(endTime)
    : bottomY - (18.0 / uViewportHeight) * trackScaleAt(bottomY);
  // Long holds can extend far past the top of the viewport. Once their
  // projected scale crosses zero the left and right vertices swap, turning
  // the quad into large triangles. Trim only the off-screen portion; track
  // projection is linear in screenY, so the visible trajectory is unchanged.
  bottomY = clamp(bottomY, -0.05, 1.05);
  topY = clamp(topY, -0.05, 1.05);
  float screenY = mix(bottomY, topY, aCorner.y);
  float perspectiveW = 1.0 / trackScaleAt(screenY);
  vec2 position = projectTrack(lanePosition, screenY);
  // Preserve the same NDC position while supplying the perspective divisor.
  // This makes UV interpolation continuous across the two triangles that form
  // the trapezoid instead of leaving a short seam at either endpoint.
  gl_Position = vec4(position * perspectiveW, 0.0, perspectiveW);
  vUv = aCorner;
  vKind = kind;
  vColor = iColor;
  vActive = iActive;
}`

const NOTE_FRAGMENT = `#version 300 es
precision highp float;
in vec2 vUv;
flat in float vKind;
flat in float vColor;
flat in float vActive;
uniform vec4 uColors[4];
out vec4 outColor;
void main() {
  vec4 color = uColors[int(vColor + 0.5)];
  vec2 edge = min(vUv, 1.0-vUv);
  // Derive each axis independently. Taking fwidth after min() makes the
  // derivative jump across the quad's internal triangle edge, drawing a
  // dotted diagonal through long holds.
  vec2 borderWidth = max(fwidth(vUv) * (vKind > 0.5 ? 5.5 : 1.45), vec2(0.006));
  float borderX = 1.0 - smoothstep(0.0, borderWidth.x, edge.x);
  float borderY = 1.0 - smoothstep(0.0, borderWidth.y, edge.y);
  float border = max(borderX, borderY);
  vec3 fill = vKind > 0.5
    ? mix(color.rgb * 0.42, color.rgb * 1.18, vActive)
    : color.rgb;
  vec3 stroke = vKind > 0.5 && vActive < 0.5 ? color.rgb : vec3(1.0);
  outColor = vec4(mix(fill, stroke, border), color.a * (vKind > 0.5 ? 0.9 : 1.0));
}`

const TRACK_VERTEX = `#version 300 es
precision highp float;
layout(location=0) in vec2 aPosition;
uniform float uTilt;
uniform float uTrackGeometry;

float visualScreenY(float depth) {
  float trackTopScale = 1.0 - uTilt * 0.82;
  float curve = -log(trackTopScale);
  float curveRange = exp(curve) - 1.0;
  float startSlope = curve > 0.0001 ? curve / curveRange : 1.0;
  float endSlope = curve > 0.0001 ? curve * exp(curve) / curveRange : 1.0;
  float progress = 1.0 - depth;
  float eased = progress < 0.0 ? progress * startSlope
    : progress > 1.0 ? 1.0 + (progress - 1.0) * endSlope
    : curve > 0.0001 ? (exp(curve * progress) - 1.0) / curveRange
    : progress;
  return eased * 0.86;
}

void main() {
  float screenY = uTrackGeometry > 0.5 ? aPosition.y : visualScreenY(aPosition.y);
  float trackTopScale = 1.0 - uTilt * 0.82;
  float trackScale = mix(trackTopScale, 1.0, screenY / 0.86);
  gl_Position = vec4(aPosition.x * 0.80 * trackScale, 1.0 - screenY * 2.0, 0.2, 1.0);
}`

const TRACK_FRAGMENT = `#version 300 es
precision highp float;
uniform vec4 uColor;
out vec4 outColor;
void main() {
  outColor = uColor;
}`

const GLOW_VERTEX = `#version 300 es
precision highp float;
layout(location=0) in vec2 aPosition;
layout(location=1) in float aCoverage;
out float vY;
out float vCoverage;
void main() {
  gl_Position = vec4((aPosition.x * 2.0 - 1.0) * 0.80, 1.0 - aPosition.y * 2.0, 0.1, 1.0);
  vY = aPosition.y;
  vCoverage = aCoverage;
}`

const GLOW_FRAGMENT = `#version 300 es
precision highp float;
in float vY;
in float vCoverage;
uniform vec3 uColor;
out vec4 outColor;
void main() {
  float t = clamp((vY - 0.13) / 0.87, 0.0, 1.0);
  float opacity = t < 0.42 ? mix(0.0, 0.05, t / 0.42)
    : t < 0.74 ? mix(0.05, 0.34, (t - 0.42) / 0.32)
    : mix(0.34, 0.90, (t - 0.74) / 0.26);
  outColor = vec4(uColor, opacity * vCoverage);
}`

const PARTICLE_VERTEX = `#version 300 es
precision highp float;
layout(location=0) in vec2 aCorner;
layout(location=1) in vec4 iParticleA;
layout(location=2) in vec4 iParticleB;
uniform float uTime;
uniform float uAspect;
out vec2 vUv;
out float vAlpha;
out float vColor;
void main() {
  float age = uTime - iParticleA.z;
  float life = iParticleA.w;
  float progress = clamp(age / life, 0.0, 1.0);
  vec2 origin = iParticleA.xy;
  vec2 velocity = iParticleB.xy;
  float size = iParticleB.z * mix(0.65, 1.35, progress);
  vec2 position = origin + velocity * age + vec2(0.0, -0.00000012 * age * age);
  vec2 corner = (aCorner - 0.5) * size;
  corner.x /= uAspect;
  bool alive = age >= 0.0 && age <= life;
  gl_Position = vec4(alive ? position + corner : vec2(2.0), 0.0, 1.0);
  vUv = aCorner;
  vAlpha = alive ? pow(1.0-progress, 1.65) : 0.0;
  vColor = iParticleB.w;
}`

const PARTICLE_FRAGMENT = `#version 300 es
precision highp float;
in vec2 vUv;
in float vAlpha;
in float vColor;
uniform sampler2D uTexture;
uniform vec4 uColors[4];
out vec4 outColor;
void main() {
  vec4 mask = texture(uTexture, vUv);
  vec3 color = uColors[int(vColor + 0.5)].rgb;
  outColor = vec4(color * (1.2 + mask.rgb), mask.a * vAlpha);
}`

function compileProgram(gl: WebGL2RenderingContext, vertex: string, fragment: string, uniforms: string[]): GLProgram {
  const compile = (type: number, source: string) => {
    const shader = gl.createShader(type)
    if (!shader) throw new Error('无法创建 WebGL shader')
    gl.shaderSource(shader, source)
    gl.compileShader(shader)
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) || 'Shader 编译失败')
    return shader
  }
  const program = gl.createProgram()
  if (!program) throw new Error('无法创建 WebGL program')
  const vertexShader = compile(gl.VERTEX_SHADER, vertex)
  const fragmentShader = compile(gl.FRAGMENT_SHADER, fragment)
  gl.attachShader(program, vertexShader)
  gl.attachShader(program, fragmentShader)
  gl.linkProgram(program)
  gl.deleteShader(vertexShader)
  gl.deleteShader(fragmentShader)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) || 'Shader 链接失败')
  return { program, uniforms: Object.fromEntries(uniforms.map((name) => [name, gl.getUniformLocation(program, name)])) }
}

function lowerBound(notes: ChartNote[], time: number, useEnd = false) {
  let low = 0
  let high = notes.length
  while (low < high) {
    const middle = (low + high) >>> 1
    const noteTime = useEnd ? (notes[middle].endTime ?? notes[middle].time) : notes[middle].time
    if (noteTime < time) low = middle + 1
    else high = middle
  }
  return low
}

export class PlaytestRenderer {
  private readonly gl: WebGL2RenderingContext
  private readonly notes: ChartNote[]
  private readonly noteProgram: GLProgram
  private readonly trackProgram: GLProgram
  private readonly glowProgram: GLProgram
  private readonly particleProgram: GLProgram
  private readonly noteVao: WebGLVertexArrayObject
  private readonly trackVao: WebGLVertexArrayObject
  private readonly glowVao: WebGLVertexArrayObject
  private readonly glowVerticesPerLane: number
  private readonly beatVao: WebGLVertexArrayObject
  private readonly beatBuffer: WebGLBuffer
  private readonly trackBoundaryVertices = new Float32Array([
    -1, 0, -1, 0.86, -1, 0.86, -1, 1,
    1, 0, 1, 0.86, 1, 0.86, 1, 1,
  ])
  private readonly particleVao: WebGLVertexArrayObject
  private readonly noteInstances: WebGLBuffer
  private readonly particleInstances: WebGLBuffer
  private readonly particleData = new Float32Array(MAX_PARTICLES * PARTICLE_STRIDE)
  private readonly beatVertices = new Float32Array(MAX_BEAT_BUFFER_FLOATS)
  private readonly palette = new Float32Array(LANE_COLORS.flat())
  private readonly frameTimes = new Float32Array(512)
  private readonly hiddenNotes = new Set<string>()
  private readonly startedHolds = new Set<string>()
  private readonly activeHolds = new Set<string>()
  private readonly pressedLanes = new Set<number>()
  private readonly autoPlayedNotes = new Set<string>()
  private readonly resizeObserver: ResizeObserver
  private frame = 0
  private particleCursor = 0
  private activeParticles = 0
  private renderScale = 1
  private lastResizeScale = 0
  private lastStatsAt = performance.now()
  private statsFrames = 0
  private slowWindows = 0
  private fastWindows = 0
  private lastVisibleKey = ''
  private visibleCount = 0
  private drawCalls = 0
  private lastTime = 0
  private lastFrameAt = 0
  private lastRenderTime = 0
  private frameTimeCount = 0
  private clockStalls = 0

  constructor(private readonly options: PlaytestRendererOptions) {
    const gl = options.canvas.getContext('webgl2', {
      alpha: options.transparentBackground === true,
      antialias: true,
      depth: false,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: false,
    })
    if (!gl) throw new Error('当前设备不支持 WebGL2')
    this.gl = gl
    this.renderScale = Math.max(0.72, Math.min(1, options.initialRenderScale ?? 1))
    this.notes = [...options.notes].sort((a, b) => a.time - b.time)
    this.noteProgram = compileProgram(gl, NOTE_VERTEX, NOTE_FRAGMENT, ['uTime', 'uHorizon', 'uTilt', 'uViewportHeight', 'uColors'])
    this.trackProgram = compileProgram(gl, TRACK_VERTEX, TRACK_FRAGMENT, ['uTilt', 'uTrackGeometry', 'uColor'])
    this.glowProgram = compileProgram(gl, GLOW_VERTEX, GLOW_FRAGMENT, ['uColor'])
    this.particleProgram = compileProgram(gl, PARTICLE_VERTEX, PARTICLE_FRAGMENT, ['uTime', 'uAspect', 'uTexture', 'uColors'])
    this.noteVao = this.createNoteVao()
    this.noteInstances = this.getInstanceBuffer(this.noteVao, 1)
    this.trackVao = this.createTrackVao()
    const glowGeometry = this.createGlowVao()
    this.glowVao = glowGeometry.vao
    this.glowVerticesPerLane = glowGeometry.verticesPerLane
    const beatGeometry = this.createBeatVao()
    this.beatVao = beatGeometry.vao
    this.beatBuffer = beatGeometry.buffer
    this.particleVao = this.createParticleVao()
    this.particleInstances = this.getInstanceBuffer(this.particleVao, 1)
    this.createParticleTexture()
    this.resizeObserver = new ResizeObserver(() => this.resize())
    this.resizeObserver.observe(options.canvas)
    this.resize()
    this.frame = requestAnimationFrame(this.render)
  }

  private createQuadBuffer() {
    const gl = this.gl
    const buffer = gl.createBuffer()
    if (!buffer) throw new Error('无法创建 WebGL buffer')
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW)
    gl.enableVertexAttribArray(0)
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)
    return buffer
  }

  private createNoteVao() {
    const gl = this.gl
    const vao = gl.createVertexArray()
    const instances = gl.createBuffer()
    if (!vao || !instances) throw new Error('无法创建音符实例缓冲区')
    gl.bindVertexArray(vao)
    this.createQuadBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, instances)
    gl.bufferData(gl.ARRAY_BUFFER, Math.max(1, this.notes.length) * NOTE_STRIDE * 4, gl.DYNAMIC_DRAW)
    gl.enableVertexAttribArray(1)
    gl.vertexAttribPointer(1, 4, gl.FLOAT, false, NOTE_STRIDE * 4, 0)
    gl.vertexAttribDivisor(1, 1)
    gl.enableVertexAttribArray(2)
    gl.vertexAttribPointer(2, 1, gl.FLOAT, false, NOTE_STRIDE * 4, 4 * 4)
    gl.vertexAttribDivisor(2, 1)
    gl.enableVertexAttribArray(3)
    gl.vertexAttribPointer(3, 1, gl.FLOAT, false, NOTE_STRIDE * 4, 5 * 4)
    gl.vertexAttribDivisor(3, 1)
    gl.bindVertexArray(null)
    ;(vao as WebGLVertexArrayObject & { instanceBuffer?: WebGLBuffer }).instanceBuffer = instances
    return vao
  }

  private createTrackVao() {
    const gl = this.gl
    const vertices: number[] = []
    for (let lane = 0; lane < 4; lane++) {
      const left = lane / 2 - 1
      const right = (lane + 1) / 2 - 1
      vertices.push(left, 0, right, 0, left, 1, left, 1, right, 0, right, 1)
    }
    const vao = gl.createVertexArray()
    const buffer = gl.createBuffer()
    if (!vao || !buffer) throw new Error('无法创建轨道缓冲区')
    gl.bindVertexArray(vao)
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertices), gl.STATIC_DRAW)
    gl.enableVertexAttribArray(0)
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)
    gl.bindVertexArray(null)
    return vao
  }

  private createGlowVao() {
    const gl = this.gl
    const vertices: number[] = []
    const curveSteps = 28
    const blurSigma = 0.0115
    const blurRadius = blurSigma * 3
    const columns = 6
    const topScale = 1 - (this.options.laneTilt / 45) * 0.82
    const scaleAt = (y: number) => topScale + (1 - topScale) * Math.min(1, Math.max(0, y / 0.86))
    const projectX = (x: number, y: number) => 0.5 + (x - 0.5) * scaleAt(y)
    const cubic = (a: number, b: number, c: number, d: number, t: number) => {
      const inverse = 1 - t
      return inverse ** 3 * a + 3 * inverse ** 2 * t * b + 3 * inverse * t ** 2 * c + t ** 3 * d
    }
    const coverage = [0.00135, 0.5, 0.99865, 0.99865, 0.5, 0.00135]

    for (let lane = 0; lane < 4; lane++) {
      const left = lane * 0.25
      const right = left + 0.25
      const middle = left + 0.125
      const rows: Array<Array<[number, number, number]>> = []
      const addRow = (y: number, innerLeft: number, innerRight: number) => {
        const center = (innerLeft + innerRight) / 2
        const leftInside = Math.min(center, innerLeft + blurRadius)
        const rightInside = Math.max(center, innerRight - blurRadius)
        const xs = [innerLeft - blurRadius, innerLeft, leftInside, rightInside, innerRight, innerRight + blurRadius]
        rows.push(xs.map((x, index) => [x, y, coverage[index]]))
      }

      addRow(1, left, right)
      for (let step = 0; step <= curveSteps; step++) {
        const t = step / curveSteps
        const y = cubic(0.86, 0.62, 0.27, 0.13, t)
        const innerLeft = cubic(left, projectX(left, 0.62), projectX(middle - 0.045, 0.27), projectX(middle, 0.13), t)
        const innerRight = cubic(right, projectX(right, 0.62), projectX(middle + 0.045, 0.27), projectX(middle, 0.13), t)
        addRow(y, innerLeft, innerRight)
      }

      for (let row = 0; row < rows.length - 1; row++) {
        for (let column = 0; column < columns - 1; column++) {
          const topLeft = rows[row][column]
          const topRight = rows[row][column + 1]
          const bottomLeft = rows[row + 1][column]
          const bottomRight = rows[row + 1][column + 1]
          vertices.push(...topLeft, ...topRight, ...bottomLeft, ...bottomLeft, ...topRight, ...bottomRight)
        }
      }
    }

    const vao = gl.createVertexArray()
    const buffer = gl.createBuffer()
    if (!vao || !buffer) throw new Error('无法创建轨道高亮缓冲区')
    gl.bindVertexArray(vao)
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertices), gl.STATIC_DRAW)
    gl.enableVertexAttribArray(0)
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 3 * 4, 0)
    gl.enableVertexAttribArray(1)
    gl.vertexAttribPointer(1, 1, gl.FLOAT, false, 3 * 4, 2 * 4)
    gl.bindVertexArray(null)
    return { vao, verticesPerLane: vertices.length / 3 / 4 }
  }

  private createBeatVao() {
    const gl = this.gl
    const vao = gl.createVertexArray()
    const buffer = gl.createBuffer()
    if (!vao || !buffer) throw new Error('无法创建节拍线缓冲区')
    gl.bindVertexArray(vao)
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
    gl.bufferData(gl.ARRAY_BUFFER, MAX_BEAT_BUFFER_FLOATS * 4, gl.DYNAMIC_DRAW)
    gl.enableVertexAttribArray(0)
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)
    gl.bindVertexArray(null)
    return { vao, buffer }
  }

  private createParticleVao() {
    const gl = this.gl
    const vao = gl.createVertexArray()
    const instances = gl.createBuffer()
    if (!vao || !instances) throw new Error('无法创建粒子实例缓冲区')
    gl.bindVertexArray(vao)
    this.createQuadBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, instances)
    gl.bufferData(gl.ARRAY_BUFFER, this.particleData.byteLength, gl.DYNAMIC_DRAW)
    for (let index = 0; index < 2; index++) {
      const location = index + 1
      gl.enableVertexAttribArray(location)
      gl.vertexAttribPointer(location, 4, gl.FLOAT, false, PARTICLE_STRIDE * 4, index * 4 * 4)
      gl.vertexAttribDivisor(location, 1)
    }
    gl.bindVertexArray(null)
    ;(vao as WebGLVertexArrayObject & { instanceBuffer?: WebGLBuffer }).instanceBuffer = instances
    return vao
  }

  private getInstanceBuffer(vao: WebGLVertexArrayObject, _location: number) {
    const buffer = (vao as WebGLVertexArrayObject & { instanceBuffer?: WebGLBuffer }).instanceBuffer
    if (!buffer) throw new Error('实例缓冲区丢失')
    return buffer
  }

  private createParticleTexture() {
    const gl = this.gl
    const texture = gl.createTexture()
    if (!texture) return
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, texture)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([255, 255, 255, 255]))
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    const image = new Image()
    image.onload = () => {
      gl.bindTexture(gl.TEXTURE_2D, texture)
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true)
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image)
    }
    image.src = `${import.meta.env.BASE_URL}assets/particle/particle_arc.png`
  }

  private resize() {
    const { canvas } = this.options
    const nativeDpr = window.devicePixelRatio || 1
    const dpr = Math.min(nativeDpr * (window.innerWidth < 760 ? 1 : 1.5), window.innerWidth < 760 ? 1.5 : 2)
    const scale = dpr * this.renderScale
    const width = Math.max(1, Math.round(canvas.clientWidth * scale))
    const height = Math.max(1, Math.round(canvas.clientHeight * scale))
    if (canvas.width !== width || canvas.height !== height || this.lastResizeScale !== scale) {
      canvas.width = width
      canvas.height = height
      this.lastResizeScale = scale
      this.gl.viewport(0, 0, width, height)
    }
  }

  private uploadVisibleNotes(time: number) {
    const horizon = HORIZON_MS * (7 / Math.max(4, this.options.scrollSpeed))
    const first = Math.max(0, lowerBound(this.notes, time - horizon * (100 / 86 - 1)) - 8)
    const last = Math.min(this.notes.length, lowerBound(this.notes, time + horizon) + 2)
    const key = `${first}:${last}:${this.hiddenNotes.size}:${[...this.startedHolds].join(',')}:${[...this.activeHolds].join(',')}`
    if (key === this.lastVisibleKey) return
    this.lastVisibleKey = key
    const candidates = this.notes.slice(first, last)
    for (const id of this.startedHolds) {
      const note = this.notes.find((candidate) => candidate.id === id)
      if (note && !candidates.includes(note)) candidates.push(note)
    }
    const visible = candidates.filter((note) => !this.hiddenNotes.has(note.id) && (note.endTime ?? note.time) >= time - 260)
    const data = new Float32Array(visible.length * NOTE_STRIDE)
    visible.forEach((note, index) => {
      const offset = index * NOTE_STRIDE
      data[offset] = note.lane
      data[offset + 1] = note.time
      data[offset + 2] = note.endTime ?? note.time
      data[offset + 3] = note.kind === 'hold' ? 1 : 0
      data[offset + 4] = note.lane
      data[offset + 5] = this.activeHolds.has(note.id) ? 1 : 0
    })
    this.visibleCount = visible.length
    const gl = this.gl
    gl.bindBuffer(gl.ARRAY_BUFFER, this.noteInstances)
    if (data.byteLength) gl.bufferSubData(gl.ARRAY_BUFFER, 0, data)
  }

  private drawTrack() {
    const gl = this.gl
    const { program, uniforms } = this.trackProgram
    gl.useProgram(program)
    gl.bindVertexArray(this.trackVao)
    gl.uniform1f(uniforms.uTilt, this.options.laneTilt / 45)
    gl.uniform1f(uniforms.uTrackGeometry, 1)
    for (let lane = 0; lane < 4; lane++) {
      const inner = lane === 1 || lane === 2
      gl.uniform4f(uniforms.uColor, inner ? 0.071 : 0.027, inner ? 0.059 : 0.035, inner ? 0.125 : 0.067, inner ? 0.9 : 0.86)
      gl.drawArrays(gl.TRIANGLES, lane * 6, 6)
      this.drawCalls++
    }
  }

  private drawLaneGlows() {
    if (!this.pressedLanes.size) return
    const gl = this.gl
    const { program, uniforms } = this.glowProgram
    gl.useProgram(program)
    gl.bindVertexArray(this.glowVao)
    for (const lane of this.pressedLanes) {
      const color = LANE_COLORS[lane]
      gl.uniform3f(uniforms.uColor, color[0], color[1], color[2])
      gl.drawArrays(gl.TRIANGLES, lane * this.glowVerticesPerLane, this.glowVerticesPerLane)
      this.drawCalls++
    }
  }

  private drawTrackBoundaries() {
    const gl = this.gl
    const { program, uniforms } = this.trackProgram
    gl.useProgram(program)
    gl.bindVertexArray(this.beatVao)
    gl.bindBuffer(gl.ARRAY_BUFFER, this.beatBuffer)
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.trackBoundaryVertices)
    gl.uniform1f(uniforms.uTilt, this.options.laneTilt / 45)
    gl.uniform1f(uniforms.uTrackGeometry, 1)
    gl.uniform4f(uniforms.uColor, 0.78, 0.855, 1, 0.42)
    gl.drawArrays(gl.LINES, 0, this.trackBoundaryVertices.length / 2)
    this.drawCalls++
  }

  private drawBeats(time: number) {
    const horizon = HORIZON_MS * (7 / Math.max(4, this.options.scrollSpeed))
    const beatMs = 60_000 / this.options.bpm
    const first = Math.ceil((time - 120 - this.options.offset) / beatMs)
    const last = Math.floor((time + horizon - this.options.offset) / beatMs)
    let floatCount = 0
    for (let beat = first; beat <= last; beat++) {
      const beatTime = this.options.offset + beat * beatMs
      if (beatTime < 0) continue
      const depth = (beatTime - time) / horizon
      if (floatCount + 4 > this.beatVertices.length) break
      this.beatVertices[floatCount++] = -1
      this.beatVertices[floatCount++] = depth
      this.beatVertices[floatCount++] = 1
      this.beatVertices[floatCount++] = depth
    }
    if (!floatCount) return
    const gl = this.gl
    const { program, uniforms } = this.trackProgram
    gl.useProgram(program)
    gl.bindVertexArray(this.beatVao)
    gl.bindBuffer(gl.ARRAY_BUFFER, this.beatBuffer)
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.beatVertices, 0, floatCount)
    gl.uniform1f(uniforms.uTilt, this.options.laneTilt / 45)
    gl.uniform1f(uniforms.uTrackGeometry, 0)
    gl.uniform4f(uniforms.uColor, 0.843, 0.898, 1, 0.16)
    gl.drawArrays(gl.LINES, 0, floatCount / 2)
    this.drawCalls++
  }

  private setPalette(uniform: WebGLUniformLocation | null) {
    this.gl.uniform4fv(uniform, this.palette)
  }

  private drawNotes(time: number) {
    if (!this.visibleCount) return
    const gl = this.gl
    const { program, uniforms } = this.noteProgram
    gl.useProgram(program)
    gl.bindVertexArray(this.noteVao)
    gl.uniform1f(uniforms.uTime, time)
    gl.uniform1f(uniforms.uHorizon, HORIZON_MS * (7 / Math.max(4, this.options.scrollSpeed)))
    gl.uniform1f(uniforms.uTilt, this.options.laneTilt / 45)
    gl.uniform1f(uniforms.uViewportHeight, Math.max(1, this.options.canvas.clientHeight))
    this.setPalette(uniforms.uColors)
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, this.visibleCount)
    this.drawCalls++
  }

  private drawParticles(time: number) {
    if (!this.activeParticles) return
    const gl = this.gl
    const { program, uniforms } = this.particleProgram
    gl.useProgram(program)
    gl.bindVertexArray(this.particleVao)
    gl.uniform1f(uniforms.uTime, time)
    gl.uniform1f(uniforms.uAspect, this.options.canvas.width / this.options.canvas.height)
    gl.uniform1i(uniforms.uTexture, 0)
    this.setPalette(uniforms.uColors)
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE)
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, MAX_PARTICLES)
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)
    this.drawCalls++
  }

  private autoplay(time: number) {
    if (!this.options.autoplay || !this.options.getPlaying()) return
    const first = Math.max(0, lowerBound(this.notes, time - 34) - 2)
    for (let index = first; index < this.notes.length && this.notes[index].time <= time + 20; index++) {
      const note = this.notes[index]
      if (this.autoPlayedNotes.has(note.id)) continue
      this.autoPlayedNotes.add(note.id)
      this.hideNote(note.id)
      this.triggerHit(note.lane, time, 1)
      this.options.onAutoplayHit?.(note.lane)
    }
  }

  private render = (now: number) => {
    const gl = this.gl
    const time = this.options.getTime()
    if (this.lastFrameAt > 0) {
      const frameTime = now - this.lastFrameAt
      if (this.frameTimeCount < this.frameTimes.length) this.frameTimes[this.frameTimeCount++] = frameTime
      if (time - this.lastRenderTime <= 0.05 && this.options.getPlaying()) this.clockStalls++
    }
    this.lastFrameAt = now
    this.lastRenderTime = time
    if (time < this.lastTime - 250) this.reset(time)
    this.lastTime = time
    this.autoplay(time)
    this.uploadVisibleNotes(time)
    this.resize()
    this.drawCalls = 0
    gl.disable(gl.DEPTH_TEST)
    gl.enable(gl.BLEND)
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)
    if (this.options.transparentBackground) gl.clearColor(0, 0, 0, 0)
    else gl.clearColor(0.012, 0.018, 0.045, 1)
    gl.clear(gl.COLOR_BUFFER_BIT)
    this.drawTrack()
    this.drawLaneGlows()
    this.drawTrackBoundaries()
    this.drawBeats(time)
    this.drawNotes(time)
    this.drawParticles(time)
    gl.bindVertexArray(null)

    this.statsFrames++
    const elapsed = now - this.lastStatsAt
    if (elapsed >= 1000) {
      const fps = Math.round(this.statsFrames * 1000 / elapsed)
      const sortedFrameTimes = Array.from(this.frameTimes.subarray(0, this.frameTimeCount)).sort((a, b) => a - b)
      const medianFrameTime = sortedFrameTimes[Math.floor(sortedFrameTimes.length * 0.5)] ?? 0
      const frameTimeP95 = sortedFrameTimes[Math.floor(sortedFrameTimes.length * 0.95)] ?? 0
      const frameTimeMax = sortedFrameTimes.at(-1) ?? 0
      const longFrameThreshold = Math.max(medianFrameTime * 1.5, medianFrameTime + 3)
      const longFrames = sortedFrameTimes.filter((frameTime) => frameTime > longFrameThreshold).length
      const longFramePercent = sortedFrameTimes.length ? longFrames / sortedFrameTimes.length * 100 : 0
      let liveParticles = 0
      for (let index = 0; index < MAX_PARTICLES; index++) {
        const bornAt = this.particleData[index * PARTICLE_STRIDE + 2]
        const lifetime = this.particleData[index * PARTICLE_STRIDE + 3]
        if (lifetime > 0 && time >= bornAt && time <= bornAt + lifetime) liveParticles++
      }
      this.activeParticles = liveParticles
      if (longFramePercent >= 12 || frameTimeMax >= 50) { this.slowWindows++; this.fastWindows = 0 }
      else if (longFramePercent <= 3) { this.fastWindows++; this.slowWindows = 0 }
      else { this.slowWindows = 0; this.fastWindows = 0 }
      if (this.slowWindows >= 2 && this.renderScale > 0.72) { this.renderScale = Math.max(0.72, this.renderScale - 0.1); this.slowWindows = 0; this.resize() }
      if (this.fastWindows >= 5 && this.renderScale < 1) { this.renderScale = Math.min(1, this.renderScale + 0.05); this.fastWindows = 0; this.resize() }
      this.options.onStats({ fps, backend: 'WebGL2', renderScale: this.renderScale, notes: this.visibleCount, particles: this.activeParticles, drawCalls: this.drawCalls, frameTimeP95, frameTimeMax, longFramePercent, clockStalls: this.clockStalls })
      this.statsFrames = 0
      this.frameTimeCount = 0
      this.clockStalls = 0
      this.lastStatsAt = now
    }
    this.frame = requestAnimationFrame(this.render)
  }

  hideNote(id: string) {
    this.hiddenNotes.add(id)
    this.startedHolds.delete(id)
    this.activeHolds.delete(id)
    this.lastVisibleKey = ''
  }

  setLanePressed(lane: number, pressed: boolean) {
    if (pressed) this.pressedLanes.add(lane)
    else this.pressedLanes.delete(lane)
  }

  setHoldActive(id: string, active: boolean) {
    if (active) { this.startedHolds.add(id); this.activeHolds.add(id) }
    else this.activeHolds.delete(id)
    this.lastVisibleKey = ''
  }

  setHoldStarted(id: string) {
    this.startedHolds.add(id)
    this.lastVisibleKey = ''
  }

  reset(time = 0) {
    this.hiddenNotes.clear()
    this.startedHolds.clear()
    this.activeHolds.clear()
    this.pressedLanes.clear()
    this.autoPlayedNotes.clear()
    this.lastVisibleKey = ''
    this.activeParticles = 0
    this.particleData.fill(0)
    const gl = this.gl
    gl.bindBuffer(gl.ARRAY_BUFFER, this.particleInstances)
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.particleData)
    this.uploadVisibleNotes(time)
  }

  triggerHit(lane: number, time: number, intensity = 1) {
    const qualityCount = this.renderScale < 0.82 ? 12 : 24
    const count = Math.round(qualityCount * intensity)
    const lanePosition = (lane + 0.5) / 4
    const x = (lanePosition * 2 - 1) * 0.80
    const y = -0.72
    for (let index = 0; index < count; index++) {
      const slot = this.particleCursor++ % MAX_PARTICLES
      const offset = slot * PARTICLE_STRIDE
      const angle = (index / count) * Math.PI * 2 + Math.random() * 0.35
      const speed = 0.00018 + Math.random() * 0.0004
      this.particleData[offset] = x
      this.particleData[offset + 1] = y
      this.particleData[offset + 2] = time
      this.particleData[offset + 3] = 360 + Math.random() * 260
      this.particleData[offset + 4] = Math.cos(angle) * speed
      this.particleData[offset + 5] = Math.abs(Math.sin(angle)) * speed + 0.00008
      this.particleData[offset + 6] = 0.045 + Math.random() * 0.055
      this.particleData[offset + 7] = lane
    }
    this.activeParticles = Math.min(MAX_PARTICLES, this.activeParticles + count)
    const gl = this.gl
    gl.bindBuffer(gl.ARRAY_BUFFER, this.particleInstances)
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.particleData)
  }

  destroy() {
    cancelAnimationFrame(this.frame)
    this.resizeObserver.disconnect()
  }
}
