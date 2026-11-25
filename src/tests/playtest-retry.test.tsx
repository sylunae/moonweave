// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { DEFAULT_CHART } from '@/features/chart/types'
import PlaytestPage from '@/pages/PlaytestPage'

const state = vi.hoisted(() => ({
  editor: {} as Record<string, unknown>, session: null as Record<string, unknown> | null,
  reset: vi.fn(), hideNote: vi.fn(),
}))
vi.mock('@/features/chart/ChartProvider', () => ({ useChart: () => state.editor }))
vi.mock('@/features/platform/PlatformProvider', () => ({ usePlatform: () => ({ session: state.session }) }))
vi.mock('@/app/i18n', () => ({ useI18n: () => ({ text: (zh: string) => zh }) }))
vi.mock('@/app/preferences', () => ({ usePreferences: () => ({ preferences: {
  playbackRate: 1, timingWindow: 'normal', laneTilt: 0, noteScrollSpeed: 7, playKeys: ['d', 'f', 'j', 'k'],
} }) }))
vi.mock('@/features/playtest/PlaytestRenderer', () => ({ PlaytestRenderer: class {
  reset = state.reset
  hideNote = state.hideNote
  destroy() {} setHoldActive() {} setHoldStarted() {} setLanePressed() {}
} }))

let audio: HTMLAudioElement
let frames: Map<number, FrameRequestCallback>
let frameId = 0

beforeEach(() => {
  frames = new Map()
  state.session = null
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

it.each(['paused', 'preroll', 'playing'])('retries at the entry position after %s and ignores later editor time updates', async (phase) => {
  const view = render(<PlaytestPage />)
  expect(audio.currentTime).toBe(25)
  if (phase !== 'paused') fireEvent.keyDown(window, { code: 'Space' })
  if (phase === 'playing') await act(async () => {
    const pending = [...frames.values()]; frames.clear(); pending.forEach((callback) => callback(1100))
  })
  audio.currentTime = 40
  state.editor.currentTime = 40000
  view.rerender(<PlaytestPage />)
  state.reset.mockClear(); state.hideNote.mockClear()
  fireEvent.click(screen.getByTitle('重新开始'))
  expect(audio.currentTime).toBe(25)
  expect(state.reset).toHaveBeenLastCalledWith(24000)
  expect(state.hideNote).toHaveBeenCalledWith('before')
  expect(state.hideNote).not.toHaveBeenCalledWith('at-start')
  // A cancelled preroll must not start the old run after retry.
  await act(async () => {
    const pending = [...frames.values()]; frames.clear(); pending.forEach((callback) => callback(2000))
  })
  expect(audio.currentTime).toBe(25)
})

it.each([-1000, 0, 90000])('clamps the saved entry position %s to chart bounds on every retry', (entry) => {
  state.editor.currentTime = entry
  render(<PlaytestPage />)
  audio.currentTime = 30
  fireEvent.click(screen.getByTitle('重新开始'))
  expect(audio.currentTime).toBe(Math.max(0, Math.min(entry, 60000)) / 1000)
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
