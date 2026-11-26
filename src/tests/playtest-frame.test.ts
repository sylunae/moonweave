// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { PlaytestRenderer, type PlaytestStats } from '@/features/playtest/PlaytestRenderer'

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

it.each([500, 1200])('presents a complete frame when adapting resolution or resizing at viewport width %s', (windowWidth) => {
  vi.spyOn(performance, 'now').mockReturnValue(0)
  vi.stubGlobal('innerWidth', windowWidth)
  vi.stubGlobal('devicePixelRatio', windowWidth <= 760 ? 2 : 1.25)
  let frame: FrameRequestCallback = () => {}
  let notifyResize = () => {}
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frame = callback; return 1 })
  vi.stubGlobal('cancelAnimationFrame', vi.fn())
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: () => void) { notifyResize = callback }
    observe() {} disconnect() {}
  })

  // Canvas dimension writes discard the frame, just like a real WebGL canvas.
  let hasFrame = false
  let width = 300, height = 150, clientWidth = windowWidth
  const canvas = document.createElement('canvas')
  Object.defineProperties(canvas, {
    width: { get: () => width, set: (value: number) => { width = value; hasFrame = false } },
    height: { get: () => height, set: (value: number) => { height = value; hasFrame = false } },
    clientWidth: { get: () => clientWidth }, clientHeight: { get: () => 800 },
  })
  const methods = new Map<PropertyKey, ReturnType<typeof vi.fn>>()
  methods.set('clear', vi.fn(() => { hasFrame = false }))
  methods.set('drawArrays', vi.fn(() => { hasFrame = true }))
  const gl = new Proxy({}, { get: (_target, key) => {
    if (typeof key === 'string' && /^[A-Z_0-9]+$/.test(key)) return 1
    if (!methods.has(key)) methods.set(key, vi.fn(() => ({})))
    return methods.get(key)
  } })
  vi.spyOn(canvas, 'getContext').mockReturnValue(gl as WebGL2RenderingContext)
  const stats: PlaytestStats[] = []
  const renderer = new PlaytestRenderer({
    canvas, notes: [], bpm: 120, bpmChanges: [], effects: [], offset: 0, duration: 5000,
    laneTilt: 45, scrollSpeed: 7, autoplay: false, transparentBackground: true, initialRenderScale: 0.9,
    getTime: () => 1000, getPlaying: () => true, onStats: (value) => stats.push(value),
  })
  try {
    frame(16)
    expect(hasFrame).toBe(true)
    const initialWidth = width
    expect(initialWidth).toBe(Math.round(windowWidth * (windowWidth <= 760 ? 1.5 : 1.25) * 0.9))
    // A steady 30 FPS has no relative long frames but exceeds the 60 FPS budget.
    for (let i = 1; i <= 60; i++) frame(16 + i * 1000 / 30)
    expect(hasFrame).toBe(true)
    expect(stats.at(-1)?.longFramePercent).toBe(0)
    expect(stats.at(-1)?.renderScale).toBeCloseTo(0.8)
    frame(2032)
    expect(width).toBeLessThan(initialWidth)
    expect(hasFrame).toBe(true)

    const beforeResize = width
    clientWidth -= 100
    notifyResize()
    expect(width).toBe(beforeResize)
    expect(hasFrame).toBe(true)
    frame(2048)
    expect(width).toBeLessThan(beforeResize)
    expect(hasFrame).toBe(true)
    expect(methods.get('viewport')).toHaveBeenLastCalledWith(0, 0, width, height)
    // Repeated observer notifications without a size change must not clear it.
    notifyResize(); frame(2064)
    expect(hasFrame).toBe(true)
  } finally { renderer.destroy() }
})
