import { defaultThemePalettes } from '@/app/theme'
import { beatLinesInRange } from '@/features/chart/tempoMap'
import type { ChartEffect } from '@/features/chart/effects/scrollSpeed'
import { createSpeedGeometry, type VisualNote } from './speedGeometry'
import type { BpmChange, ChartNote } from '@/features/chart/types'
import { getPlaytestHorizon, getPlaytestTrackHalfWidth, JUDGMENT_LINE_Y, TRACK_TOP_SCALE_RANGE } from '@/features/playtest/playtestGeometry'
import { NOTE_APPEARANCE, NOTE_GLOW_PADDING } from './noteAppearance'

const NOTE_STRIDE = 6
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
  bpmChanges: BpmChange[]
  effects: ChartEffect[]
  offset: number
  duration: number
  getTime(): number
  getRecordedNotes?(): ChartNote[]
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
uniform float uRealTime;
uniform float uHorizon;
uniform float uTilt;
uniform float uTrackWidth;
uniform vec2 uViewportSize;
out float vLaneX;
out float vScreenYTimesW;
flat out vec4 vNoteBounds;
flat out float vColor;
flat out float vActive;

float visualScreenY(float noteTime) {
  float trackTopScale = 1.0 - uTilt * ${TRACK_TOP_SCALE_RANGE};
  float curve = -log(trackTopScale);
  float curveRange = exp(curve) - 1.0;
  float startSlope = curve > 0.0001 ? curve / curveRange : 1.0;
  float endSlope = curve > 0.0001 ? curve * exp(curve) / curveRange : 1.0;
  float distance = iActive < -0.5 ? uRealTime - noteTime : noteTime - uTime;
  float progress = 1.0 - distance / uHorizon;
  float eased = progress < 0.0 ? progress * startSlope
    : progress > 1.0 ? 1.0 + (progress - 1.0) * endSlope
    : curve > 0.0001 ? (exp(curve * progress) - 1.0) / curveRange
    : progress;
  return eased * ${JUDGMENT_LINE_Y};
}

float trackScaleAt(float screenY) {
  float trackTopScale = 1.0 - uTilt * ${TRACK_TOP_SCALE_RANGE};
  // Keep extending the perspective line outside the visible track. Clamping
  // here makes notes switch to vertical motion after the judgment line and
  // shears holds whose other endpoint is still inside the track.
  return mix(trackTopScale, 1.0, screenY / ${JUDGMENT_LINE_Y});
}

vec2 projectTrack(float lanePosition, float screenY) {
  float trackScale = trackScaleAt(screenY);
  float x = (lanePosition * 2.0 - 1.0) * uTrackWidth * trackScale;
  return vec2(x, 1.0 - screenY * 2.0);
}

void main() {
  float lane = iNote.x;
  bool hold = iNote.w > 0.5;
  float noteWidth = max(1.0, 0.84 * uTrackWidth * uViewportSize.x / 4.0);
  float glowPadding = ${NOTE_GLOW_PADDING};
  vLaneX = mix(-glowPadding / noteWidth, 1.0 + glowPadding / noteWidth, aCorner.x);
  float lanePosition = (lane + 0.5 + (vLaneX - 0.5) * 0.84) / 4.0;
  float headBottom = visualScreenY(iNote.y);
  float tailY = hold ? visualScreenY(iNote.z) : headBottom;
  float headScale = max(0.0, trackScaleAt(headBottom));
  float minHeadHeight = mix(36.0, 44.0, smoothstep(480.0, 850.0, uViewportSize.x));
  float headHeight = clamp(noteWidth * 0.34, minHeadHeight, 54.0) * headScale / uViewportSize.y;
  float headTop = headBottom - headHeight;
  vNoteBounds = vec4(headTop, headBottom, tailY, noteWidth);
  // Pad the same instance quad for the local halo. The solid head still ends
  // at its timing line and the hold body begins exactly at the tail time.
  float top = min(headTop, tailY);
  float topPadding = glowPadding * max(0.0, trackScaleAt(top)) / uViewportSize.y;
  float bottomPadding = glowPadding * headScale / uViewportSize.y;
  // Long holds can extend far past the top of the viewport. Once their
  // projected scale crosses zero the left and right vertices swap, turning
  // the quad into large triangles. Trim only the off-screen portion; track
  // projection is linear in screenY, so the visible trajectory is unchanged.
  float bottomY = clamp(headBottom + bottomPadding, -0.05, 1.05);
  float topY = clamp(top - topPadding, -0.05, 1.05);
  float screenY = mix(bottomY, topY, aCorner.y);
  float perspectiveW = 1.0 / trackScaleAt(screenY);
  vec2 position = projectTrack(lanePosition, screenY);
  // Preserve the same NDC position while supplying the perspective divisor.
  // This makes UV interpolation continuous across the two triangles that form
  // the trapezoid instead of leaving a short seam at either endpoint.
  gl_Position = vec4(position * perspectiveW, 0.0, perspectiveW);
  // Undo perspective correction for screen Y only. Cap heights are measured
  // in screen space, while lane X stays perspective-correct along the hold.
  vScreenYTimesW = screenY * perspectiveW;
  vColor = iColor;
  vActive = iActive;
}`

const NOTE_FRAGMENT = `#version 300 es
precision highp float;
in float vLaneX;
in float vScreenYTimesW;
flat in vec4 vNoteBounds;
flat in float vColor;
flat in float vActive;
uniform vec4 uColors[4];
uniform vec4 uRedColor;
uniform vec2 uViewportSize;
out vec4 outColor;
${NOTE_APPEARANCE}
void main() {
  vec3 color = (vColor > 3.5 ? uRedColor : uColors[int(vColor + 0.5)]).rgb;
  float screenY = vScreenYTimesW * gl_FragCoord.w;
  // The reciprocal clip-space W is the projected track scale at this pixel.
  float scale = gl_FragCoord.w;
  float halfWidth = vNoteBounds.w * scale * 0.5;
  float x = (vLaneX - 0.5) * 2.0 * halfWidth;
  vec2 pixel = fwidth(vec2(x, screenY * uViewportSize.y));
  float antialias = max(0.35, 0.55 * max(pixel.x, pixel.y));
  float near = smoothstep(0.0, ${JUDGMENT_LINE_Y}, screenY);
  float isHeld = max(0.0, vActive);
  color *= mix(0.89, 1.0, near);
  float glowRadius = mix(6.0, 11.0, near) * scale;
  float glowStrength = mix(0.43, 0.85, near);

  float headTop = vNoteBounds.x;
  float headBottom = vNoteBounds.y;
  float tailY = vNoteBounds.z;
  float bodyBottom = mix(headTop, headBottom, 0.27);
  // Inset the body so its straight edges meet inside the rounded head.
  float bodyHalfWidth = halfWidth * 0.88;
  vec4 body = vec4(0.0);
  if (tailY < bodyBottom && screenY < bodyBottom + glowRadius / uViewportSize.y) {
    float height = (bodyBottom - tailY) * uViewportSize.y;
    float y = (screenY - tailY) * uViewportSize.y - height * 0.5;
    body = shadeHoldBody(color, vec2(x, y), vec2(bodyHalfWidth, height * 0.5),
      antialias, glowRadius, glowStrength, isHeld);
  }

  if (screenY < headTop - glowRadius / uViewportSize.y) {
    outColor = body;
    return;
  }
  float height = (headBottom - headTop) * uViewportSize.y;
  float y = (screenY - headTop) * uViewportSize.y - height * 0.5;
  vec4 head = shadeNoteHead(color, vec2(x, y), vec2(halfWidth, height * 0.5),
    antialias, glowRadius, glowStrength);
  outColor = noteOver(head, body);
}`

const TRACK_VERTEX = `#version 300 es
precision highp float;
layout(location=0) in vec2 aPosition;
uniform float uTilt;
uniform float uTrackWidth;
uniform float uTrackGeometry;

float visualScreenY(float depth) {
  float trackTopScale = 1.0 - uTilt * ${TRACK_TOP_SCALE_RANGE};
  float curve = -log(trackTopScale);
  float curveRange = exp(curve) - 1.0;
  float startSlope = curve > 0.0001 ? curve / curveRange : 1.0;
  float endSlope = curve > 0.0001 ? curve * exp(curve) / curveRange : 1.0;
  float progress = 1.0 - depth;
  float eased = progress < 0.0 ? progress * startSlope
    : progress > 1.0 ? 1.0 + (progress - 1.0) * endSlope
    : curve > 0.0001 ? (exp(curve * progress) - 1.0) / curveRange
    : progress;
  return eased * ${JUDGMENT_LINE_Y};
}

void main() {
  float screenY = uTrackGeometry > 0.5 ? aPosition.y : visualScreenY(aPosition.y);
  float trackTopScale = 1.0 - uTilt * ${TRACK_TOP_SCALE_RANGE};
  float trackScale = mix(trackTopScale, 1.0, screenY / ${JUDGMENT_LINE_Y});
  gl_Position = vec4(aPosition.x * uTrackWidth * trackScale, 1.0 - screenY * 2.0, 0.2, 1.0);
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
uniform float uTrackWidth;
out float vY;
out float vCoverage;
void main() {
  gl_Position = vec4((aPosition.x * 2.0 - 1.0) * uTrackWidth, 1.0 - aPosition.y * 2.0, 0.1, 1.0);
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
  private readonly geometry: ReturnType<typeof createSpeedGeometry>
  private readonly visualBeats: { time: number; position: number }[]
  private readonly noteProgram: GLProgram
  private readonly trackProgram: GLProgram
  private readonly glowProgram: GLProgram
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
  private readonly noteInstances: WebGLBuffer
  private readonly beatVertices = new Float32Array(MAX_BEAT_BUFFER_FLOATS)
  private readonly palette = new Float32Array(LANE_COLORS.flat())
  private readonly frameTimes = new Float32Array(512)
  private readonly hiddenNotes = new Set<string>()
  private readonly startedHolds = new Set<string>()
  private readonly activeHolds = new Set<string>()
  private readonly pressedLanes = new Set<number>()
  private readonly redColor: number[]
  private readonly autoPlayedNotes = new Set<string>()
  private readonly resizeObserver: ResizeObserver
  private frame = 0
  private renderScale = 1
  private resizePending = true
  private lastStatsAt = performance.now()
  private statsFrames = 0
  private slowWindows = 0
  private fastWindows = 0
  private readonly visibleCandidates: VisualNote[] = []
  private noteData = new Float32Array(0)
  private viewportWidth = 1
  private viewportHeight = 1
  private lastDevicePixelRatio = 0
  private lastWindowWidth = 0
  private noteCapacity = 0
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
    const token = getComputedStyle(options.canvas).getPropertyValue('--red-zone').trim()
    const color = Number.parseInt((/^#[0-9a-f]{6}$/i.test(token) ? token : defaultThemePalettes.dark.redZone).slice(1), 16)
    this.redColor = [(color >> 16 & 255) / 255, (color >> 8 & 255) / 255, (color & 255) / 255, 1]
    this.renderScale = Math.max(0.72, Math.min(1, options.initialRenderScale ?? 1))
    this.notes = [...options.notes].sort((a, b) => a.time - b.time)
    this.geometry = createSpeedGeometry(this.notes, options.effects)
    this.visualBeats = beatLinesInRange(options, 0, options.duration, 1).map((line) => ({ time: line.time, position: this.geometry.map.positionAt(line.time) }))
    this.noteProgram = compileProgram(gl, NOTE_VERTEX, NOTE_FRAGMENT, ['uTime', 'uRealTime', 'uHorizon', 'uTilt', 'uTrackWidth', 'uViewportSize', 'uColors', 'uRedColor'])
    this.trackProgram = compileProgram(gl, TRACK_VERTEX, TRACK_FRAGMENT, ['uTilt', 'uTrackWidth', 'uTrackGeometry', 'uColor'])
    this.glowProgram = compileProgram(gl, GLOW_VERTEX, GLOW_FRAGMENT, ['uTrackWidth', 'uColor'])
    this.noteVao = this.createNoteVao()
    this.noteInstances = this.getInstanceBuffer(this.noteVao, 1)
    this.trackVao = this.createTrackVao()
    const glowGeometry = this.createGlowVao()
    this.glowVao = glowGeometry.vao
    this.glowVerticesPerLane = glowGeometry.verticesPerLane
    const beatGeometry = this.createBeatVao()
    this.beatVao = beatGeometry.vao
    this.beatBuffer = beatGeometry.buffer
    // Resizing clears the drawing buffer. Defer it to the next render so the
    // compositor can never receive a resized, not-yet-redrawn canvas.
    this.resizeObserver = new ResizeObserver(() => { this.resizePending = true })
    this.resizeObserver.observe(options.canvas)
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
    gl.bufferData(gl.ARRAY_BUFFER, Math.max(1, this.geometry.pieces.length) * NOTE_STRIDE * 4, gl.DYNAMIC_DRAW)
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

  private getInstanceBuffer(vao: WebGLVertexArrayObject, _location: number) {
    const buffer = (vao as WebGLVertexArrayObject & { instanceBuffer?: WebGLBuffer }).instanceBuffer
    if (!buffer) throw new Error('实例缓冲区丢失')
    return buffer
  }

  private resize() {
    const { canvas } = this.options
    const nativeDpr = window.devicePixelRatio || 1
    this.lastDevicePixelRatio = nativeDpr
    this.lastWindowWidth = window.innerWidth
    this.viewportWidth = Math.max(1, canvas.clientWidth)
    this.viewportHeight = Math.max(1, canvas.clientHeight)
    const dpr = Math.min(nativeDpr * (window.innerWidth < 760 ? 1 : 1.5), window.innerWidth < 760 ? 1.5 : 2)
    const scale = dpr * this.renderScale
    const width = Math.max(1, Math.round(this.viewportWidth * scale))
    const height = Math.max(1, Math.round(this.viewportHeight * scale))
    this.resizePending = false
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width
      canvas.height = height
      this.gl.viewport(0, 0, width, height)
    }
  }

  private uploadVisibleNotes(time: number) {
    const horizon = getPlaytestHorizon(HORIZON_MS, this.options.scrollSpeed, this.options.laneTilt)
    const position = this.geometry.map.positionAt(time)
    const candidates = this.geometry.visible(position - horizon * (100 / 86 - 1) - 260, position + horizon, this.visibleCandidates)
    const recorded = this.options.getRecordedNotes?.()
    const firstRecorded = recorded ? lowerBound(recorded, time - horizon * 1.1) : 0
    let recordedEnd = firstRecorded
    while (recorded && recordedEnd < recorded.length && recorded[recordedEnd].time <= time) recordedEnd++
    const required = (candidates.length + recordedEnd - firstRecorded) * NOTE_STRIDE
    let changed = false
    if (required > this.noteData.length) {
      this.noteData = new Float32Array(Math.max(required, this.noteData.length * 2))
      changed = true
    }
    let cursor = 0
    const write = (value: number) => {
      const rounded = Math.fround(value)
      if (this.noteData[cursor] !== rounded) { this.noteData[cursor] = rounded; changed = true }
      cursor++
    }
    // Draw ordinary notes first and red zones last, independent of kind, time,
    // selection or source order. Two linear passes reuse the same GPU batch.
    for (let layer = 0; layer < 2; layer++) {
      for (const note of candidates) {
        if (Boolean(note.red) !== (layer === 1)) continue
        if (this.hiddenNotes.has(note.sourceId) || (note.sourceEndTime < time - 260 && !this.startedHolds.has(note.sourceId))) continue
        write(note.lane); write(note.time); write(note.endTime ?? note.time)
        write(note.kind === 'hold' ? 1 : 0); write(note.red ? 4 : note.lane); write(this.activeHolds.has(note.sourceId) ? 1 : 0)
      }
      if (layer === 0) for (let index = firstRecorded; recorded && index < recordedEnd; index++) {
        const note = recorded[index]
        write(note.lane); write(note.time); write(note.time); write(0); write(note.lane); write(-1)
      }
    }
    const count = cursor / NOTE_STRIDE
    changed ||= count !== this.visibleCount
    this.visibleCount = count
    if (!changed || !cursor) return
    const gl = this.gl
    gl.bindBuffer(gl.ARRAY_BUFFER, this.noteInstances)
    if (this.noteData.byteLength > this.noteCapacity) {
      this.noteCapacity = Math.max(this.noteData.byteLength, this.noteCapacity * 2, 1024)
      gl.bufferData(gl.ARRAY_BUFFER, this.noteCapacity, gl.DYNAMIC_DRAW)
    }
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.noteData, 0, cursor)
  }

  private drawTrack() {
    const gl = this.gl
    const { program, uniforms } = this.trackProgram
    gl.useProgram(program)
    gl.bindVertexArray(this.trackVao)
    gl.uniform1f(uniforms.uTilt, this.options.laneTilt / 45)
    gl.uniform1f(uniforms.uTrackWidth, getPlaytestTrackHalfWidth(this.options.laneTilt))
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
    gl.uniform1f(uniforms.uTrackWidth, getPlaytestTrackHalfWidth(this.options.laneTilt))
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
    gl.uniform1f(uniforms.uTrackWidth, getPlaytestTrackHalfWidth(this.options.laneTilt))
    gl.uniform1f(uniforms.uTrackGeometry, 1)
    gl.uniform4f(uniforms.uColor, 0.78, 0.855, 1, 0.42)
    gl.drawArrays(gl.LINES, 0, this.trackBoundaryVertices.length / 2)
    this.drawCalls++
  }

  private drawBeats(time: number) {
    const horizon = getPlaytestHorizon(HORIZON_MS, this.options.scrollSpeed, this.options.laneTilt)
    const position = this.geometry.map.positionAt(time)
    let lo = 0, hi = this.visualBeats.length
    while (lo < hi) {
      const mid = (lo + hi) >>> 1
      if (this.visualBeats[mid].position < position - 120) lo = mid + 1
      else hi = mid
    }
    let floatCount = 0
    let previousPosition = -Infinity
    for (let i = lo; i < this.visualBeats.length; i++) {
      const line = this.visualBeats[i]
      if (line.position > position + horizon) break
      // A stop can put many beat lines at exactly the same position.
      if (line.position === previousPosition) continue
      previousPosition = line.position
      const depth = (line.position - position) / horizon
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
    gl.uniform1f(uniforms.uTrackWidth, getPlaytestTrackHalfWidth(this.options.laneTilt))
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
    gl.uniform1f(uniforms.uTime, this.geometry.map.positionAt(time))
    gl.uniform1f(uniforms.uRealTime, time)
    gl.uniform1f(uniforms.uHorizon, getPlaytestHorizon(HORIZON_MS, this.options.scrollSpeed, this.options.laneTilt))
    gl.uniform1f(uniforms.uTilt, this.options.laneTilt / 45)
    gl.uniform1f(uniforms.uTrackWidth, getPlaytestTrackHalfWidth(this.options.laneTilt))
    gl.uniform4fv(uniforms.uRedColor, this.redColor)
    gl.uniform2f(uniforms.uViewportSize, this.viewportWidth, this.viewportHeight)
    this.setPalette(uniforms.uColors)
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, this.visibleCount)
    this.drawCalls++
  }

  private autoplay(time: number) {
    if (!this.options.autoplay || !this.options.getPlaying()) return
    const first = Math.max(0, lowerBound(this.notes, time - 34) - 2)
    for (let index = first; index < this.notes.length && this.notes[index].time <= time + 20; index++) {
      const note = this.notes[index]
      if (note.red || this.autoPlayedNotes.has(note.id)) continue
      this.autoPlayedNotes.add(note.id)
      this.hideNote(note.id)
      this.options.onAutoplayHit?.(note.lane)
    }
  }

  private render = (now: number) => {
    const gl = this.gl
    if (this.resizePending || this.lastDevicePixelRatio !== (window.devicePixelRatio || 1) || this.lastWindowWidth !== window.innerWidth) this.resize()
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
      if (longFramePercent >= 12 || frameTimeMax >= 50) { this.slowWindows++; this.fastWindows = 0 }
      else if (longFramePercent <= 3) { this.fastWindows++; this.slowWindows = 0 }
      else { this.slowWindows = 0; this.fastWindows = 0 }
      const previousRenderScale = this.renderScale
      if (this.slowWindows >= 2 && this.renderScale > 0.72) { this.renderScale = Math.max(0.72, this.renderScale - 0.1); this.slowWindows = 0 }
      if (this.fastWindows >= 5 && this.renderScale < 1) { this.renderScale = Math.min(1, this.renderScale + 0.05); this.fastWindows = 0 }
      this.options.onStats({ fps, backend: 'WebGL2', renderScale: this.renderScale, notes: this.visibleCount, drawCalls: this.drawCalls, frameTimeP95, frameTimeMax, longFramePercent, clockStalls: this.clockStalls })
      if (this.renderScale !== previousRenderScale) this.resizePending = true
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
  }

  setLanePressed(lane: number, pressed: boolean) {
    if (pressed) this.pressedLanes.add(lane)
    else this.pressedLanes.delete(lane)
  }

  setHoldActive(id: string, active: boolean) {
    if (active) { this.startedHolds.add(id); this.activeHolds.add(id) }
    else this.activeHolds.delete(id)
  }

  setHoldStarted(id: string) {
    this.startedHolds.add(id)
  }

  reset(time = 0) {
    this.lastTime = time
    this.lastRenderTime = time
    this.hiddenNotes.clear()
    this.startedHolds.clear()
    this.activeHolds.clear()
    this.pressedLanes.clear()
    this.autoPlayedNotes.clear()
    this.uploadVisibleNotes(time)
  }

  destroy() {
    cancelAnimationFrame(this.frame)
    this.resizeObserver.disconnect()
  }
}
