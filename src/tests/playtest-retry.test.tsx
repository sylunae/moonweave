// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { DEFAULT_CHART } from '@/features/chart/types'
import PlaytestPage from '@/pages/PlaytestPage'

const state = vi.hoisted(() => ({
  editor: {} as Record<string, unknown>, session: null as Record<string, unknown> | null,
  reset: vi.fn(), hideNote: vi.fn(), readEncodedAudio: vi.fn(), laneTilt: 0, renderTime: (): number => 0,
}))
vi.mock('@/features/chart/ChartProvider', () => ({ useChart: () => state.editor }))
vi.mock('@/features/chart/detectBpm', () => ({ readEncodedAudio: state.readEncodedAudio }))
vi.mock('@/features/platform/PlatformProvider', () => ({ usePlatform: () => ({ session: state.session }) }))
vi.mock('@/app/i18n', () => ({ useI18n: () => ({ text: (zh: string) => zh }) }))
vi.mock('@/app/preferences', () => ({ usePreferences: () => ({ preferences: {
  playbackRate: 1, timingWindow: 'normal', laneTilt: state.laneTilt, noteScrollSpeed: 7, playKeys: ['d', 'f', 'j', 'k'],
} }) }))
vi.mock('@/features/playtest/PlaytestRenderer', () => ({ PlaytestRenderer: class {
  constructor(options: { getTime(): number }) { state.renderTime = options.getTime }
  reset = state.reset
  hideNote = state.hideNote
  destroy() {} setHoldActive() {} setHoldStarted() {} setLanePressed() {}
} }))

let audio: HTMLAudioElement
let frames: Map<number, FrameRequestCallback>
let frameId = 0

beforeEach(() => {
  vi.stubGlobal('sylunae', {})
  frames = new Map()
  state.session = null
  state.laneTilt = 0
  state.reset.mockClear(); state.hideNote.mockClear()
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.set(++frameId, callback); return frameId })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id))
  vi.spyOn(performance, 'now').mockReturnValue(0)
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue()
  audio = document.createElement('audio')
  state.editor = { chart: { ...DEFAULT_CHART, duration: 60000, notes: [
    { id: 'before', kind: 'note', lane: 0, time: 1000 },
    { id: 'at-start', kind: 'note', lane: 0, time: 25000 },
  ] }, audioRef: { current: audio }, currentTime: 25000, audioUrl: 'blob:audio', showToast: vi.fn() }
})

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

it('keeps the opening frame at the preroll target until audio startup finishes', async () => {
  let completeStart!: () => void
  vi.mocked(audio.play).mockReturnValueOnce(new Promise<void>((resolve) => { completeStart = resolve }))
  render(<PlaytestPage />)
  vi.mocked(performance.now).mockReturnValue(20)
  fireEvent.keyDown(window, { code: 'Space' })
  act(() => {
    const pending = [...frames.values()]; frames.clear(); pending.forEach((callback) => callback(16))
  })
  expect(state.renderTime()).toBe(24000)
  await act(async () => {
    const pending = [...frames.values()]; frames.clear(); pending.forEach((callback) => callback(1100))
  })
  audio.currentTime = 24
  expect(state.renderTime()).toBe(25000)
  audio.currentTime = 25
  await act(async () => completeStart())
  vi.mocked(performance.now).mockReturnValue(40)
  expect(state.renderTime()).toBe(25000)
  audio.currentTime = 25.016
  expect(state.renderTime()).toBeCloseTo(25016)
})

it('uses the mobile audio output clock even while the media element is frozen', async () => {
  vi.stubGlobal('sylunae', undefined)
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query.includes('(pointer: coarse)'), addEventListener() {}, removeEventListener() {},
  }))
  Object.defineProperties(audio, { duration: { value: 60 }, readyState: { value: 4 } })
  const start = vi.fn()
  const stop = vi.fn()
  const decode = vi.fn(async () => ({ duration: 60, length: 2_880_000, numberOfChannels: 2 }))
  let contextTime = 10
  let output = 10
  vi.stubGlobal('OfflineAudioContext', class { decodeAudioData = decode })
  vi.stubGlobal('AudioContext', class {
    state = 'running'
    get currentTime() { return contextTime }
    getOutputTimestamp() { return { contextTime: output, performanceTime: 1 } }
    createBufferSource() { return { start, stop, connect() {}, disconnect() {} } }
    close = async () => {}
  })
  state.readEncodedAudio.mockResolvedValueOnce(new ArrayBuffer(1))
  render(<PlaytestPage />)
  await waitFor(() => expect(decode).toHaveBeenCalledOnce())
  fireEvent.keyDown(window, { code: 'Space' })
  await act(async () => {
    const pending = [...frames.values()]; frames.clear(); pending.forEach((callback) => callback(1100))
  })
  expect(start).toHaveBeenCalledWith(10, 25)
  expect(audio.play).not.toHaveBeenCalled()
  contextTime = 10.25
  output = 10.2
  expect(state.renderTime()).toBeCloseTo(25200)
  expect(audio.currentTime).toBe(25)
  fireEvent.click(screen.getByRole('button', { name: '暂停' }))
  expect(stop).toHaveBeenCalledOnce()
  contextTime = output = 11
  expect(state.renderTime()).toBeCloseTo(25200)
})

it.each(['paused', 'preroll', 'playing'])('restarts from the beginning after %s and ignores later editor time updates', async (phase) => {
  const view = render(<PlaytestPage />)
  expect(audio.currentTime).toBe(25)
  if (phase !== 'paused') fireEvent.keyDown(window, { code: 'Space' })
  if (phase === 'playing') await act(async () => {
    const pending = [...frames.values()]; frames.clear(); pending.forEach((callback) => callback(1100))
  })
  audio.currentTime = 40
  state.editor.currentTime = 40000
  view.rerender(<PlaytestPage />)
  fireEvent.click(screen.getByRole('button', { name: '暂停' }))
  const oldFrames = [...frames.values()]
  state.reset.mockClear(); state.hideNote.mockClear()
  fireEvent.click(screen.getByRole('button', { name: '重头开始' }))
  expect(audio.currentTime).toBe(0)
  expect(state.reset).toHaveBeenLastCalledWith(-1000)
  expect(state.hideNote).not.toHaveBeenCalled()
  const play = vi.mocked(audio.play)
  play.mockClear()
  await act(async () => { oldFrames.forEach((callback) => callback(2000)) })
  expect(play).not.toHaveBeenCalled()
  await act(async () => { [...frames.values()].forEach((callback) => callback(2000)) })
  expect(play).toHaveBeenCalledOnce()
  expect(audio.currentTime).toBe(0)
})

it.each([-1000, 0, 90000])('clamps the editor entry position %s to chart bounds', (entry) => {
  state.editor.currentTime = entry
  render(<PlaytestPage />)
  expect(audio.currentTime).toBe(Math.max(0, Math.min(entry, 60000)) / 1000)
})

it.each([{ code: 'Escape' }, { key: 'BrowserBack' }, { code: 'ArrowLeft', altKey: true }])('opens the pause menu on back key %j without leaving', (key) => {
  const setEditorTime = vi.fn()
  state.editor.setCurrentTime = setEditorTime
  render(<PlaytestPage />)
  fireEvent.keyDown(window, key)
  expect(screen.getByRole('dialog', { name: '暂停' })).toBeTruthy()
  fireEvent.keyDown(window, key)
  expect(screen.getByRole('dialog', { name: '暂停' })).toBeTruthy()
  expect(setEditorTime).not.toHaveBeenCalled()
})

it.each([false, true])('opens the pause menu when browser history goes back (touch=%s)', async (touch) => {
  vi.stubGlobal('sylunae', undefined)
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: touch && query === '(pointer: coarse)', addEventListener: vi.fn(), removeEventListener: vi.fn(),
  }))
  const setEditorTime = vi.fn()
  state.editor.setCurrentTime = setEditorTime
  const view = render(<PlaytestPage />)
  await waitFor(() => expect(window.history.state?.moonweaveMobileBack).toBe(true))
  await act(async () => {
    const wentBack = new Promise<void>((resolve) => window.addEventListener('popstate', () => resolve(), { once: true }))
    window.history.back()
    await wentBack
  })
  expect(screen.getByRole('dialog', { name: '暂停' })).toBeTruthy()
  expect(setEditorTime).not.toHaveBeenCalled()
  await waitFor(() => expect(window.history.state?.moonweaveMobileBack).toBe(true))
  view.unmount()
  await waitFor(() => expect(window.history.state?.moonweaveMobileBack).toBeUndefined())
})

it('retries a formal play result from zero even when the editor is at another position', () => {
  state.session = { chart: state.editor.chart, audioUrl: 'blob:formal-audio' }
  render(<PlaytestPage />)
  const formalAudio = document.querySelector('audio')!
  formalAudio.currentTime = 60
  fireEvent.ended(formalAudio)
  fireEvent.click(screen.getByRole('button', { name: '再来一次' }))
  expect(formalAudio.currentTime).toBe(0)
  expect(state.reset).toHaveBeenLastCalledWith(-1000)
})

it('pauses for settings, blocks play shortcuts, and preserves the run when the view changes', async () => {
  const onSettings = vi.fn()
  const setEditorTime = vi.fn()
  state.editor.setCurrentTime = setEditorTime
  state.editor.setImprovising = vi.fn()
  const view = render(<PlaytestPage onSettings={onSettings} />)
  expect(within(screen.getByRole('banner')).queryByText(DEFAULT_CHART.title)).toBeNull()
  expect(within(screen.getByRole('region', { name: DEFAULT_CHART.title })).getByText(DEFAULT_CHART.title)).toBeTruthy()
  fireEvent.keyDown(window, { code: 'Space' })
  await act(async () => {
    const pending = [...frames.values()]; frames.clear(); pending.forEach((callback) => callback(1100))
  })
  expect(screen.queryByRole('button', { name: '设置' })).toBeNull()
  expect(screen.queryByText(DEFAULT_CHART.title)).toBeNull()

  audio.currentTime = 26
  const pause = vi.mocked(audio.pause)
  pause.mockClear()
  fireEvent.click(screen.getByRole('button', { name: '暂停' }))
  expect(within(screen.getByRole('dialog', { name: '暂停' })).getByText(DEFAULT_CHART.title)).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: '设置' }))
  expect(onSettings).toHaveBeenCalledOnce()
  expect(pause).toHaveBeenCalledOnce()
  expect(audio.currentTime).toBe(26)

  view.rerender(<PlaytestPage onSettings={onSettings} settingsOpen />)
  const play = vi.mocked(audio.play)
  play.mockClear()
  fireEvent.keyDown(window, { code: 'Space' })
  fireEvent.keyDown(window, { code: 'Escape' })
  expect(play).not.toHaveBeenCalled()
  expect(setEditorTime).not.toHaveBeenCalled()

  state.hideNote.mockClear()
  state.reset.mockClear()
  state.laneTilt = 20
  view.rerender(<PlaytestPage onSettings={onSettings} settingsOpen />)
  expect(state.hideNote).toHaveBeenCalledWith('before')
  expect(state.reset).not.toHaveBeenCalled()

  view.rerender(<PlaytestPage onSettings={onSettings} />)
  expect(play).not.toHaveBeenCalled()
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: /继续/ })) })
  expect(play).toHaveBeenCalledOnce()
  expect(audio.currentTime).toBe(26)
})
