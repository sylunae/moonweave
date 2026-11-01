// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import { ChartProvider, useChart } from '@/features/chart/ChartProvider'

const dependencies = vi.hoisted(() => ({ setPreferences: vi.fn() }))
vi.mock('@/app/preferences', () => ({ usePreferences: () => ({ setPreferences: dependencies.setPreferences }), migrateLegacyChartPreferences: vi.fn() }))
vi.mock('@/features/chart/webLibrary', () => ({
  listWebCharts: async () => [{ id: 'test-chart', updatedAt: 1, chart: { bpm: 120 } }],
  readWebChart: async () => ({ chart: { bpm: 120 }, audio: new Blob(['audio']) }),
  writeWebChart: vi.fn(async () => ({ updatedAt: 1 })), deleteWebChart: vi.fn(),
}))

it('applies playback rate immediately to audio and timeline without pausing, seeking, or editing the chart', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  let paused = true
  let frame: FrameRequestCallback = () => {}
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frame = callback; return 1 })
  vi.stubGlobal('cancelAnimationFrame', vi.fn())
  const pause = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => { paused = true })
  const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(async () => { paused = false })
  const originalCreate = URL.createObjectURL, originalRevoke = URL.revokeObjectURL
  URL.createObjectURL = vi.fn(() => 'blob:test-audio'); URL.revokeObjectURL = vi.fn()
  const now = vi.spyOn(performance, 'now').mockReturnValue(1000)
  const element = document.createElement('div'); document.body.appendChild(element)
  const root = createRoot(element)
  let context: ReturnType<typeof useChart>
  function Harness() { context = useChart(); return null }
  try {
    await act(async () => { root.render(<ChartProvider><Harness /></ChartProvider>) })
    const audio = context!.audioRef.current!
    Object.defineProperty(audio, 'paused', { get: () => paused })
    await act(async () => context!.togglePlay(1, 4))
    audio.currentTime = 3.125
    pause.mockClear(); play.mockClear(); dependencies.setPreferences.mockClear()
    const chart = context!.chart
    await act(async () => context!.setPlaybackRate(0.5))
    expect(audio.playbackRate).toBe(0.5)
    expect(audio.currentTime).toBe(3.125)
    now.mockReturnValue(1020)
    await act(async () => frame(1020))
    expect(context!.currentTime).toBeCloseTo(3135)

    for (const rate of [0.75, 1]) {
      await act(async () => context!.setPlaybackRate(rate))
      expect(audio.playbackRate).toBe(rate)
      expect(audio.currentTime).toBe(3.125)
    }
    expect(pause).not.toHaveBeenCalled()
    expect(play).not.toHaveBeenCalled()
    expect(context!.chart).toBe(chart)
    expect(context!.historyLength).toBe(0)
    expect(dependencies.setPreferences).toHaveBeenCalledTimes(3)

    paused = true
    await act(async () => context!.setPlaybackRate(0.5))
    expect(audio.playbackRate).toBe(0.5)
    expect(paused).toBe(true)
    await act(async () => context!.setPlaybackRate(0))
    expect(audio.playbackRate).toBe(0.5)
  } finally {
    await act(async () => root.unmount())
    element.remove(); URL.createObjectURL = originalCreate; URL.revokeObjectURL = originalRevoke
    vi.restoreAllMocks(); vi.unstubAllGlobals()
  }
})

it('stays synchronized across repeated pause, seek, resume, buffering and delayed pause events', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  let paused = true, seeking = false
  let frame: FrameRequestCallback = () => {}
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frame = callback; return 1 })
  const cancel = vi.fn()
  vi.stubGlobal('cancelAnimationFrame', cancel)
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => { paused = true })
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(async () => { paused = false })
  const originalCreate = URL.createObjectURL, originalRevoke = URL.revokeObjectURL
  URL.createObjectURL = vi.fn(() => 'blob:test-audio'); URL.revokeObjectURL = vi.fn()
  const now = vi.spyOn(performance, 'now').mockReturnValue(1000)
  const element = document.createElement('div'); document.body.appendChild(element)
  const root = createRoot(element)
  let context: ReturnType<typeof useChart>
  function Harness() { context = useChart(); return null }
  try {
    await act(async () => root.render(<ChartProvider><Harness /></ChartProvider>))
    const audio = context!.audioRef.current!
    Object.defineProperty(audio, 'paused', { get: () => paused })
    Object.defineProperty(audio, 'seeking', { get: () => seeking })
    await act(async () => context!.togglePlay(1, 4))
    for (const target of [10000, 2000, 8000, 1000]) {
      await act(async () => context!.togglePlay(1, 4))
      seeking = true
      await act(async () => {
        context!.setCurrentTime(target)
        audio.dispatchEvent(new Event('seeking'))
      })
      await act(async () => context!.togglePlay(1, 4))
      now.mockReturnValue(performance.now() + 500)
      await act(async () => frame(performance.now()))
      expect(context!.currentTime).toBe(target)

      seeking = false
      await act(async () => audio.dispatchEvent(new Event('seeked')))
      cancel.mockClear()
      await act(async () => audio.dispatchEvent(new Event('pause')))
      expect(cancel).not.toHaveBeenCalled()
      expect(context!.isPlaying).toBe(true)
      now.mockReturnValue(performance.now() + 16)
      await act(async () => frame(performance.now()))
      expect(context!.currentTime).toBeCloseTo(target + 16)
      audio.currentTime = (target + 16) / 1000
    }
    await act(async () => audio.dispatchEvent(new Event('waiting')))
    const beforeWaiting = audio.currentTime * 1000
    now.mockReturnValue(performance.now() + 2000)
    await act(async () => frame(performance.now()))
    expect(context!.currentTime).toBe(beforeWaiting)
    await act(async () => audio.dispatchEvent(new Event('playing')))
    now.mockReturnValue(performance.now() + 16)
    await act(async () => frame(performance.now()))
    expect(context!.currentTime).toBeCloseTo(beforeWaiting + 16)
  } finally {
    await act(async () => root.unmount())
    element.remove(); URL.createObjectURL = originalCreate; URL.revokeObjectURL = originalRevoke
    vi.restoreAllMocks(); vi.unstubAllGlobals()
  }
})
