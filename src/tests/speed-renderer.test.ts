// @vitest-environment jsdom
import { expect, it, vi } from 'vitest'
import { PlaytestRenderer } from '@/features/playtest/PlaytestRenderer'

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
