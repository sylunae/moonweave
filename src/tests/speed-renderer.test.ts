// @vitest-environment jsdom
import { expect, it, vi } from 'vitest'
import { PlaytestRenderer } from '@/features/playtest/PlaytestRenderer'
import type { ChartNote } from '@/features/chart/types'

it('renders stacked stop notes and clears the final hidden note from GPU instances', () => {
  // Exercise the renderer frame loop without opening a window or requiring a GPU.
  const draw = vi.fn()
  const methods = new Map<PropertyKey, unknown>()
  const gl = new Proxy({}, { get: (_target, key) => {
    if (key === 'drawArraysInstanced') return draw
    if (typeof key === 'string' && /^[A-Z_0-9]+$/.test(key)) return 1
    if (!methods.has(key)) methods.set(key, vi.fn(() => ({})))
    return methods.get(key)
  } })
  let frame: FrameRequestCallback = () => {}
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frame = callback; return 1 })
  vi.stubGlobal('cancelAnimationFrame', vi.fn())
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
  const canvas = document.createElement('canvas')
  vi.spyOn(canvas, 'getContext').mockReturnValue(gl as WebGL2RenderingContext)
  let renderer: PlaytestRenderer | undefined
  try {
    renderer = new PlaytestRenderer({ canvas, notes: [1000, 2000].map((time, lane) => ({ id: String(lane), kind: 'note', time, lane })),
      bpm: 120, bpmChanges: [], effects: [{ id: 'stop', type: 'scrollSpeed', time: 1000, multiplier: 0, transition: 'instant' }],
      offset: 0, duration: 5000, laneTilt: 0, scrollSpeed: 7, autoplay: false,
      getTime: () => 1000, getPlaying: () => false, onStats: vi.fn(),
    })
    frame(10)
    expect(draw).toHaveBeenLastCalledWith(1, 0, 4, 2)
    renderer.hideNote('0'); renderer.hideNote('1'); draw.mockClear()
    frame(20)
    expect(draw).not.toHaveBeenCalled()
    renderer.reset(1000)
    frame(30)
    expect(draw).toHaveBeenLastCalledWith(1, 0, 4, 2)
  } finally {
    renderer?.destroy(); vi.restoreAllMocks(); vi.unstubAllGlobals()
  }
})

it('uploads live reverse notes on an empty chart, grows its buffer, and culls them above the screen even during a scroll stop', () => {
  const methods = new Map<PropertyKey, ReturnType<typeof vi.fn>>()
  methods.set('drawArraysInstanced', vi.fn())
  const gl = new Proxy({}, { get: (_target, key) => {
    if (typeof key === 'string' && /^[A-Z_0-9]+$/.test(key)) return 1
    if (!methods.has(key)) methods.set(key, vi.fn(() => ({})))
    return methods.get(key)
  } })
  let frame: FrameRequestCallback = () => {}
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frame = callback; return 1 })
  vi.stubGlobal('cancelAnimationFrame', vi.fn())
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
  const canvas = document.createElement('canvas')
  vi.spyOn(canvas, 'getContext').mockReturnValue(gl as WebGL2RenderingContext)
  let time = 1000
  const recorded: ChartNote[] = []
  let renderer: PlaytestRenderer | undefined
  try {
    renderer = new PlaytestRenderer({ canvas, notes: [], getRecordedNotes: () => recorded,
      bpm: 120, bpmChanges: [], effects: [{ id: 'stop', type: 'scrollSpeed', time: 0, multiplier: 0, transition: 'instant' }],
      offset: 0, duration: 5000, laneTilt: 45, scrollSpeed: 7, autoplay: false,
      getTime: () => time, getPlaying: () => true, onStats: vi.fn(),
    })
    frame(10)
    expect(methods.get('drawArraysInstanced')).not.toHaveBeenCalled()
    // More live notes than the empty chart's initial buffer can hold.
    recorded.push(...Array.from({ length: 100 }, (_, index): ChartNote => ({ id: String(index), time: 1000, lane: index % 4, kind: 'note' })))
    frame(20)
    expect(methods.get('drawArraysInstanced')).toHaveBeenLastCalledWith(1, 0, 4, 100)
    expect(methods.get('bufferData')).toHaveBeenCalledWith(1, 100 * 6 * 4, 1)
    const uploads = methods.get('bufferSubData')!.mock.calls
    const instances = [...uploads].reverse().find((call) => call[2] instanceof Float32Array && call[2].length === 600)?.[2] as Float32Array
    expect(instances[1]).toBe(1000)
    expect(instances[5]).toBe(-1)
    methods.get('drawArraysInstanced')!.mockClear()
    time = 4000
    frame(30)
    expect(methods.get('drawArraysInstanced')).not.toHaveBeenCalled()
  } finally {
    renderer?.destroy(); vi.restoreAllMocks(); vi.unstubAllGlobals()
  }
})
