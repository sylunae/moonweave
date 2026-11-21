// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import { ChartProvider, useChart } from '@/features/chart/ChartProvider'
import * as editorAudio from '@/features/chart/editorAudio'

const dependencies = vi.hoisted(() => ({ setPreferences: vi.fn() }))
vi.mock('@/app/preferences', () => ({ usePreferences: () => ({ setPreferences: dependencies.setPreferences }), migrateLegacyChartPreferences: vi.fn() }))
vi.mock('@/features/chart/webLibrary', () => ({
  listWebCharts: async () => [{ id: 'test-chart', updatedAt: 1, chart: { bpm: 120 } }],
  readWebChart: async () => ({ chart: { bpm: 120 }, audio: new Blob(['audio']) }),
  writeWebChart: vi.fn(async () => ({ updatedAt: 1 })), deleteWebChart: vi.fn(),
}))

it('starts MP3 playback at the latest seek and reuses the PCM source after a backwards seek', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1))
  vi.stubGlobal('cancelAnimationFrame', vi.fn())
  const originalCreate = URL.createObjectURL, originalRevoke = URL.revokeObjectURL
  URL.createObjectURL = vi.fn(() => 'blob:original')
  URL.revokeObjectURL = vi.fn()
  let resolve!: (url: string) => void
  const ready = new Promise<string>(done => { resolve = done })
  const dispose = vi.fn()
  const cache = vi.spyOn(editorAudio, 'cacheEditorAudio').mockReturnValue({ ready, url: 'blob:pcm', dispose })
  let paused = true
  const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(async () => { paused = false })
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => { paused = true })
  const root = createRoot(document.createElement('div'))
  let context: ReturnType<typeof useChart>
  function Harness() { context = useChart(); return null }
  try {
    await act(async () => root.render(<ChartProvider><Harness /></ChartProvider>))
    await act(async () => context!.setChart(c => ({ ...c, audioName: 'song.mp3', duration: 165000 })))
    const audio = context!.audioRef.current!
    Object.defineProperty(audio, 'paused', { get: () => paused })
    let starting!: Promise<void>
    await act(async () => { starting = context!.togglePlay(0.5, 4) })
    await act(async () => context!.setCurrentTime(124000))
    expect(play).not.toHaveBeenCalled()
    await act(async () => { resolve('blob:pcm'); await starting })
    expect(audio.src).toBe('blob:pcm')
    expect(audio.currentTime).toBe(124)
    await act(async () => context!.togglePlay(0.5, 4))
    await act(async () => context!.setCurrentTime(55000))
    await act(async () => context!.togglePlay(0.5, 4))
    expect(audio.currentTime).toBe(55)
    expect(audio.playbackRate).toBe(0.5)
    expect(audio.src).toBe('blob:pcm')
    expect(cache).toHaveBeenCalledTimes(1)
  } finally {
    await act(async () => root.unmount())
    expect(dispose).toHaveBeenCalledTimes(1)
    URL.createObjectURL = originalCreate; URL.revokeObjectURL = originalRevoke
    vi.restoreAllMocks(); vi.unstubAllGlobals()
  }
})

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
    Object.defineProperty(audio, 'readyState', { value: 4 })
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

it('stays synchronized across repeated pause, seek, resume, buffering and delayed media events', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  let paused = true, seeking = false, readyState = 4
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
    Object.defineProperty(audio, 'readyState', { get: () => readyState })
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
      // The decoder has not advanced yet, even though play/seeked completed.
      now.mockReturnValue(performance.now() + 300)
      await act(async () => frame(performance.now()))
      expect(context!.currentTime).toBe(target)
      now.mockReturnValue(performance.now() + 16)
      audio.currentTime = (target + 16) / 1000
      await act(async () => frame(performance.now()))
      expect(context!.currentTime).toBeCloseTo(target + 16)
    }
    readyState = 2
    await act(async () => audio.dispatchEvent(new Event('waiting')))
    const beforeWaiting = audio.currentTime * 1000
    now.mockReturnValue(performance.now() + 2000)
    await act(async () => frame(performance.now()))
    expect(context!.currentTime).toBe(beforeWaiting)
    readyState = 4
    await act(async () => audio.dispatchEvent(new Event('playing')))
    now.mockReturnValue(performance.now() + 16)
    audio.currentTime = (beforeWaiting + 16) / 1000
    await act(async () => frame(performance.now()))
    expect(context!.currentTime).toBeCloseTo(beforeWaiting + 16)

    // A queued seeking/waiting event can arrive after the media recovered.
    await act(async () => {
      audio.dispatchEvent(new Event('seeking'))
      audio.dispatchEvent(new Event('waiting'))
    })
    now.mockReturnValue(performance.now() + 16)
    await act(async () => frame(performance.now()))
    expect(context!.currentTime).toBeCloseTo(beforeWaiting + 32)

    for (const target of [9000, 2500, 7000, 500]) {
      seeking = true; readyState = 2
      await act(async () => {
        context!.setCurrentTime(target)
        audio.dispatchEvent(new Event('seeking'))
        audio.dispatchEvent(new Event('waiting'))
      })
      // playing may precede seeked; it must still clear the old waiting state.
      readyState = 4
      await act(async () => audio.dispatchEvent(new Event('playing')))
      seeking = false
      await act(async () => audio.dispatchEvent(new Event('seeked')))
      now.mockReturnValue(performance.now() + 16)
      audio.currentTime = (target + 16) / 1000
      await act(async () => frame(performance.now()))
      expect(context!.currentTime).toBeCloseTo(target + 16)
    }

    // seeked is not proof that the audio has enough data to resume output.
    seeking = true; readyState = 2
    await act(async () => {
      context!.setCurrentTime(3000)
      audio.dispatchEvent(new Event('seeking'))
    })
    seeking = false
    await act(async () => audio.dispatchEvent(new Event('seeked')))
    now.mockReturnValue(performance.now() + 500)
    await act(async () => frame(performance.now()))
    expect(context!.currentTime).toBe(3000)
    readyState = 4
    await act(async () => audio.dispatchEvent(new Event('playing')))
    now.mockReturnValue(performance.now() + 16)
    audio.currentTime = 3.016
    await act(async () => frame(performance.now()))
    expect(context!.currentTime).toBeCloseTo(3016)
  } finally {
    await act(async () => root.unmount())
    element.remove(); URL.createObjectURL = originalCreate; URL.revokeObjectURL = originalRevoke
    vi.restoreAllMocks(); vi.unstubAllGlobals()
  }
})
