// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { DEFAULT_CHART, type Chart, type ChartNote } from '@/features/chart/types'
import PlaytestPage from '@/pages/PlaytestPage'

const state = vi.hoisted(() => ({ editor: {} as Record<string, unknown>, options: {} as { getRecordedNotes(): ChartNote[] }, navigate: vi.fn() }))
vi.mock('@/features/chart/ChartProvider', () => ({ useChart: () => state.editor }))
vi.mock('@/features/platform/PlatformProvider', () => ({ usePlatform: () => ({ session: null }) }))
vi.mock('@/app/i18n', () => ({ useI18n: () => ({ text: (zh: string) => zh }) }))
vi.mock('@/app/navigation', () => ({ navigate: (...args: unknown[]) => state.navigate(...args) }))
vi.mock('@/app/preferences', () => ({ usePreferences: () => ({ preferences: {
  playbackRate: 1, timingWindow: 'normal', laneTilt: 0, noteScrollSpeed: 7, playKeys: ['d', 'f', 'j', 'k'],
} }) }))
vi.mock('@/features/playtest/PlaytestRenderer', () => ({ PlaytestRenderer: class {
  constructor(options: typeof state.options) { state.options = options }
  reset() {} destroy() {} hideNote() {} setHoldActive() {} setHoldStarted() {} setLanePressed() {}
} }))

let audio: HTMLAudioElement
let paused = true
let frameId = 0
let frames: Map<number, FrameRequestCallback>
const commitEdit = vi.fn()
const flush = vi.fn()

beforeEach(() => {
  frames = new Map()
  paused = true
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.set(++frameId, callback); return frameId })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id))
  vi.spyOn(performance, 'now').mockReturnValue(0)
  audio = document.createElement('audio')
  Object.defineProperty(audio, 'paused', { get: () => paused })
  audio.pause = vi.fn(() => { paused = true })
  audio.play = vi.fn(async () => { paused = false })
  state.navigate.mockClear()
  commitEdit.mockReset().mockImplementation((update: (chart: Chart) => Chart) => { state.editor.chart = update(state.editor.chart as Chart) })
  flush.mockReset().mockResolvedValue(true)
  state.editor = { chart: { ...DEFAULT_CHART, notes: [] }, improvising: true, audioUrl: 'blob:audio', audioRef: { current: audio }, currentTime: 0,
    setCurrentTime: vi.fn(), setImprovising: vi.fn(), showToast: vi.fn(), commitEdit, flushActiveChart: flush }
})

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

async function start() {
  fireEvent.keyDown(window, { code: 'Space' })
  await act(async () => {
    const pending = [...frames.values()]
    frames.clear()
    pending.forEach((callback) => callback(1100))
  })
}

function tap(time = 1, key = 'd') {
  audio.currentTime = time
  fireEvent.keyDown(window, { key })
  fireEvent.keyUp(window, { key })
}

it('records keyboard and touch only during playback, isolates the exit dialog, and discards without edits', async () => {
  render(<PlaytestPage />)
  tap()
  expect(state.options.getRecordedNotes()).toHaveLength(0)
  fireEvent.keyDown(window, { code: 'Space' })
  tap() // preroll is not recorded
  expect(state.options.getRecordedNotes()).toHaveLength(0)
  await act(async () => {
    const pending = [...frames.values()]; frames.clear(); pending.forEach((callback) => callback(1100))
  })
  tap()
  expect(state.options.getRecordedNotes()).toEqual([expect.objectContaining({ lane: 0, time: 1000, kind: 'note' })])
  const lane = screen.getByRole('button', { name: '轨道 2，按键 f' })
  lane.setPointerCapture = vi.fn()
  lane.hasPointerCapture = vi.fn(() => false)
  fireEvent.pointerDown(lane, { pointerId: 1 })
  fireEvent.pointerUp(lane, { pointerId: 1 })
  expect(state.options.getRecordedNotes()).toHaveLength(2)
  fireEvent.keyDown(window, { code: 'Space' })
  tap(2)
  expect(state.options.getRecordedNotes()).toHaveLength(2)
  fireEvent.keyDown(window, { code: 'Escape' })
  expect(screen.getByRole('dialog')).toBeTruthy()
  fireEvent.keyDown(window, { code: 'Space' })
  tap(3)
  expect(paused).toBe(true)
  expect(state.options.getRecordedNotes()).toHaveLength(2)
  fireEvent.click(screen.getByRole('button', { name: '不保存并退出' }))
  expect(commitEdit).not.toHaveBeenCalled()
  expect(state.navigate).toHaveBeenCalledWith('editor')
})

it.each([true, false])('asks separately before replacing existing notes (overwrite=%s)', async (overwrite) => {
  state.editor.chart = { ...DEFAULT_CHART, notes: [{ id: 'hold', lane: 0, time: 800, endTime: 1200, kind: 'hold' }] }
  render(<PlaytestPage />)
  await start()
  tap()
  fireEvent.click(screen.getByRole('button', { name: '返回编辑器' }))
  fireEvent.click(screen.getByRole('button', { name: '保存到制谱器' }))
  expect(screen.getByText('这些位置已有音符')).toBeTruthy()
  expect(commitEdit).not.toHaveBeenCalled()
  await act(async () => fireEvent.click(screen.getByRole('button', { name: overwrite ? '覆盖重叠音符' : '保留原音符' })))
  expect(commitEdit).toHaveBeenCalledTimes(1)
  const notes = (state.editor.chart as Chart).notes
  expect(notes).toHaveLength(1)
  expect(notes[0].id === 'hold').toBe(!overwrite)
  expect(state.navigate).toHaveBeenCalledWith('editor')
})

it('retains the recording on save failure and retries without creating another edit', async () => {
  flush.mockResolvedValueOnce(false).mockResolvedValueOnce(true)
  render(<PlaytestPage />)
  await start()
  tap()
  fireEvent.keyDown(window, { code: 'Escape' })
  await act(async () => fireEvent.click(screen.getByRole('button', { name: '保存到制谱器' })))
  expect(state.navigate).not.toHaveBeenCalled()
  expect(state.options.getRecordedNotes()).toHaveLength(1)
  expect(screen.queryByRole('button', { name: '不保存并退出' })).toBeNull()
  await act(async () => fireEvent.click(screen.getByRole('button', { name: '保存到制谱器' })))
  expect(commitEdit).toHaveBeenCalledTimes(1)
  expect(flush).toHaveBeenCalledTimes(2)
  expect(state.navigate).toHaveBeenCalledWith('editor')
})

it('opens the save choice automatically at the end of the song', async () => {
  render(<PlaytestPage />)
  await start()
  tap()
  fireEvent.ended(audio)
  expect(screen.getByText('保存这次即兴演奏？')).toBeTruthy()
  expect(commitEdit).not.toHaveBeenCalled()
})

it('corrects a take before conflict detection and saves the confirmed corrected positions', async () => {
  state.editor.chart = { ...DEFAULT_CHART, notes: [{ id: 'original', lane: 0, time: 1000, kind: 'note' }] }
  render(<PlaytestPage />)
  await start()
  tap(1.018)
  expect(state.options.getRecordedNotes()[0].time).toBe(1018)
  expect(commitEdit).not.toHaveBeenCalled()
  fireEvent.keyDown(window, { code: 'Escape' })
  fireEvent.click(screen.getByRole('button', { name: '保存到制谱器' }))
  expect(screen.getByText('这些位置已有音符')).toBeTruthy()
  await act(async () => fireEvent.click(screen.getByRole('button', { name: '覆盖重叠音符' })))
  const notes = (state.editor.chart as Chart).notes
  expect(notes).toHaveLength(1)
  expect(notes[0]).toMatchObject({ time: 1000, lane: 0 })
  expect(notes[0].id).not.toBe('original')
  expect(commitEdit).toHaveBeenCalledTimes(1)
})

it.each([{ offset: 180, bpm: 120, target: 1180 }, { offset: -140, bpm: 120, target: 860 }, { offset: 180, bpm: 60000 / 360, target: 900 }])('preserves chart-time alignment at offset $offset and BPM $bpm through saving, conflicts and retry', async ({ offset, bpm, target }) => {
  state.editor.chart = { ...DEFAULT_CHART, offset, bpm, notes: [{ id: 'original', lane: 0, time: target, kind: 'note' }] }
  flush.mockResolvedValueOnce(false).mockResolvedValueOnce(true)
  render(<PlaytestPage />)
  await start()
  const performedAt = target + 4
  tap(performedAt / 1000)
  const raw = state.options.getRecordedNotes()
  expect(raw[0].time).toBeCloseTo(performedAt)
  fireEvent.keyDown(window, { code: 'Escape' })
  fireEvent.click(screen.getByRole('button', { name: '保存到制谱器' }))
  expect(screen.getByText('这些位置已有音符')).toBeTruthy()
  await act(async () => fireEvent.click(screen.getByRole('button', { name: '覆盖重叠音符' })))
  expect((state.editor.chart as Chart).notes).toEqual([expect.objectContaining({ time: target, lane: 0 })])
  expect((state.editor.chart as Chart).offset).toBe(offset)
  expect(state.options.getRecordedNotes()).toEqual(raw)
  await act(async () => fireEvent.click(screen.getByRole('button', { name: '保存到制谱器' })))
  expect((state.editor.chart as Chart).notes[0].time).toBe(target)
  expect(commitEdit).toHaveBeenCalledTimes(1)
  expect(state.navigate).toHaveBeenCalledWith('editor')
})
