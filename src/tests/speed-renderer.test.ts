// @vitest-environment jsdom
import { expect, it, vi } from 'vitest'
import { PlaytestRenderer } from '@/features/playtest/PlaytestRenderer'
import type { ChartNote } from '@/features/chart/types'
import { motionPreset } from '@/features/chart/effects/noteAnimation'

it.each(['note', 'hold'] as const)('keeps red %s above ordinary holds in one cached batch without frame layout reads', (redKind) => {
  const methods = new Map<PropertyKey, ReturnType<typeof vi.fn>>()
  const upload = vi.fn((..._arguments: unknown[]) => methods.get('bindBuffer')?.mock.lastCall?.[1])
  methods.set('bufferSubData', upload)
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
  const height = vi.spyOn(canvas, 'clientHeight', 'get').mockReturnValue(800)
  let renderer: PlaytestRenderer | undefined
  try {
    renderer = new PlaytestRenderer({ canvas, notes: [{ id: 'red', kind: redKind, lane: 0, time: 1100, ...(redKind === 'hold' ? { endTime: 2100 } : {}), red: true }, { id: 'hold', kind: 'hold', lane: 0, time: 1000.123, endTime: 2000.456 }],
      bpm: 120, bpmChanges: [], effects: [], offset: 0, duration: 5000, laneTilt: 0, scrollSpeed: 7,
      autoplay: false, getTime: () => 1100, getPlaying: () => true, onStats: vi.fn(),
    })
    const instances = methods.get('createBuffer')!.mock.results[0].value
    const noteUploads = () => upload.mock.calls.filter((_, index) => upload.mock.results[index].value === instances)
    frame(10)
    expect(noteUploads()).toHaveLength(1)
    const batch = noteUploads()[0][2] as Float32Array
    expect([batch[4], batch[12]]).toEqual([0, 4]) // Both palettes share one batch.
    expect(noteUploads()[0][4]).toBe(16)
    expect(methods.get('drawArraysInstanced')!.mock.calls[0][3]).toBe(2)
    upload.mockClear(); height.mockClear()
    frame(20)
    // Beat lines still move each frame; note instances do not need another upload.
    expect(noteUploads()).toHaveLength(0)
    expect(height).not.toHaveBeenCalled()
    renderer.setHoldActive('hold', true)
    frame(30)
    expect((noteUploads()[0]?.[2] as Float32Array)?.[5]).toBe(1)
  } finally {
    renderer?.destroy(); vi.restoreAllMocks(); vi.unstubAllGlobals()
  }
})

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
    expect(methods.get('bufferData')).toHaveBeenCalledWith(1, 100 * 8 * 4, 1)
    const uploads = methods.get('bufferSubData')!.mock.calls
    const instances = [...uploads].reverse().find((call) => call[2] instanceof Float32Array && call[2].length === 800)?.[2] as Float32Array
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
it.each([
  { kind: 'note' as const, speed: 1 },
  { kind: 'hold' as const, speed: 0.4 },
  { kind: 'hold' as const, speed: 0 },
  { kind: 'hold' as const, speed: -0.4 },
])('preserves the $kind shape at speed $speed on approach and throughout the hit animation', ({ kind, speed }) => {
  let frame: FrameRequestCallback = () => {}
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { frame = cb; return 1 })
  vi.stubGlobal('cancelAnimationFrame', vi.fn())
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
  const draw = vi.fn(), upload = vi.fn()
  const gl = new Proxy({}, { get: (_, key) => {
    if (key === 'drawArraysInstanced') return draw
    if (key === 'bufferSubData') return upload
    return typeof key === 'string' && /^[A-Z_0-9]+$/.test(key) ? 1 : () => ({})
  } })
  const canvas = document.createElement('canvas')
  vi.spyOn(canvas, 'getContext').mockReturnValue(gl as WebGL2RenderingContext)
  let time = 950
  const note: ChartNote = { id: 'n', kind, lane: 1, time: 1000, ...(kind === 'hold' && { endTime: 1500 }),
    animation: { ...motionPreset('rebound', 2), speed } }
  const renderer = new PlaytestRenderer({ canvas, notes: [note],
    bpm: 120, bpmChanges: [], effects: [], offset: 0, duration: 3000, laneTilt: 0, scrollSpeed: 7,
    autoplay: false, getTime: () => time, getPlaying: () => true, onStats: vi.fn() })
  try {
    frame(1)
    const before = (upload.mock.lastCall![2] as Float32Array).slice(0, 8)
    const span = kind === 'hold' ? 500 * speed : 0
    expect(before[3]).toBe(kind === 'hold' ? 2 : 0)
    expect(before[2] - before[1]).toBeCloseTo(Math.max(0, span))
    expect(before[6] - before[1]).toBeCloseTo(Math.min(0, span))
    renderer.animateHit(note, time)
    if (kind === 'hold') renderer.setHoldActive(note.id, true)
    else renderer.hideNote(note.id)
    time = 1070
    frame(2)
    expect(draw).toHaveBeenLastCalledWith(1, 0, 4, 1)
    const data = (upload.mock.lastCall![2] as Float32Array).slice(0, 8)
    expect(data[7]).toBe(0.5)
    expect(data[1] - time).toBeGreaterThan(before[1] - 950)
    expect(data[3]).toBe(before[3])
    expect(data[2] - data[1]).toBeCloseTo(before[2] - before[1])
    expect(data[6] - data[1]).toBeCloseTo(before[6] - before[1])
    expect(data[5]).toBe(kind === 'hold' ? 2 : 0)
    if (kind === 'hold') {
      renderer.setHoldActive(note.id, false)
      frame(3)
      const released = data.slice()
      released[5] = 0
      expect((upload.mock.lastCall![2] as Float32Array).slice(0, 8)).toEqual(released)
      expect(draw).toHaveBeenLastCalledWith(1, 0, 4, 1)

      renderer.setHoldActive(note.id, true)
      frame(4)
      expect((upload.mock.lastCall![2] as Float32Array).slice(0, 8)).toEqual(data)
      expect(draw).toHaveBeenLastCalledWith(1, 0, 4, 1)
    }
    draw.mockClear(); time = 1190; frame(5)
    expect(draw).not.toHaveBeenCalled()
    renderer.reset(950); time = 950; frame(6)
    expect(draw).toHaveBeenCalledTimes(1)
    expect((upload.mock.lastCall![2] as Float32Array)[7]).toBe(1)
  } finally { renderer.destroy(); vi.restoreAllMocks(); vi.unstubAllGlobals() }
})
