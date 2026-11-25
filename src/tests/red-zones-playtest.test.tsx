// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { DEFAULT_CHART, type Chart, type ChartNote } from '@/features/chart/types'
import PlaytestPage from '@/pages/PlaytestPage'

const state = vi.hoisted(() => ({ editor: {} as Record<string, unknown>, options: {} as { getRecordedNotes(): ChartNote[] }, navigate: vi.fn(), lanePressed: vi.fn(), judgmentDisplay: 'lane' }))
const particles = vi.hoisted(() => ({ id: null as string | null, readAssets: vi.fn() }))
vi.mock('@/features/appearance/particleLibrary', () => ({ readParticleAssets: particles.readAssets }))
vi.mock('@/features/chart/ChartProvider', () => ({ useChart: () => state.editor }))
vi.mock('@/features/platform/PlatformProvider', () => ({ usePlatform: () => ({ session: null }) }))
vi.mock('@/app/i18n', () => ({ useI18n: () => ({ text: (zh: string) => zh }) }))
vi.mock('@/app/navigation', () => ({ navigate: (...args: unknown[]) => state.navigate(...args) }))
vi.mock('@/app/preferences', () => ({ usePreferences: () => ({ preferences: {
  playbackRate: 1, timingWindow: 'normal', laneTilt: 0, noteScrollSpeed: 7, playKeys: ['d', 'f', 'j', 'k'],
  judgmentDisplay: state.judgmentDisplay,
  particleAppearanceId: particles.id, reduceMotion: Boolean(particles.id),
} }) }))
vi.mock('@/features/playtest/PlaytestRenderer', () => ({ PlaytestRenderer: class {
  constructor(options: typeof state.options) { state.options = options }
  reset() {} destroy() {} hideNote() {} setHoldActive() {} setHoldStarted() {} setLanePressed = state.lanePressed
} }))

let audio: HTMLAudioElement
let paused = true
let frameId = 0
let frames: Map<number, FrameRequestCallback>
const commitEdit = vi.fn()
const flush = vi.fn()

beforeEach(() => {
  state.judgmentDisplay = 'lane'
  particles.id = null
  particles.readAssets.mockReset()
  frames = new Map()
  paused = true
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.set(++frameId, callback); return frameId })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id))
  vi.spyOn(performance, 'now').mockReturnValue(0)
  audio = document.createElement('audio')
  Object.defineProperty(audio, 'paused', { get: () => paused })
  audio.pause = vi.fn(() => { paused = true })
  audio.play = vi.fn(async () => { paused = false })
  state.lanePressed.mockClear()
  state.navigate.mockClear()
  commitEdit.mockReset().mockImplementation((update: (chart: Chart) => Chart) => { state.editor.chart = update(state.editor.chart as Chart) })
  flush.mockReset().mockResolvedValue(true)
  state.editor = { chart: { ...DEFAULT_CHART, notes: [] }, improvising: false, audioUrl: 'blob:audio', audioRef: { current: audio }, currentTime: 0,
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
  vi.mocked(performance.now).mockReturnValue(time * 1000)
  audio.currentTime = time
  fireEvent.keyDown(window, { key })
  fireEvent.keyUp(window, { key })
}

const note = (id: string, time: number, lane = 0, red = false): ChartNote => ({ id, time, lane, kind: 'note', ...(red ? { red: true } : {}) })
const redHold = (time: number, endTime: number): ChartNote => ({ ...note('red-hold', time, 0, true), kind: 'hold', endTime })
function move(time: number) { audio.currentTime = time / 1000; vi.mocked(performance.now).mockReturnValue(time) }
async function frame(time: number) {
  move(time)
  await act(async () => { const pending = [...frames.values()]; frames.clear(); pending.forEach((cb) => cb(time)) })
}
function combo() { return document.querySelector('.playtest-combo b')?.textContent ?? '0' }
function score() { return document.querySelector('.playtest-score strong')?.textContent }
function chart(notes: ChartNote[]) { state.editor.chart = { ...DEFAULT_CHART, notes } }

it.each(['note', 'hold'] as const)('holding a key when a red %s crosses breaks combo without a Miss or score loss', async (kind) => {
  chart([note('a', 500), kind === 'note' ? note('red', 1000, 0, true) : redHold(1000, 1500)])
  render(<PlaytestPage />); await start()
  tap(0.5); expect(combo()).toBe('1'); expect(score()).toBe('10000000')
  move(900); fireEvent.keyDown(window, { key: 'd' })
  await frame(1100)
  expect(combo()).toBe('0'); expect(score()).toBe('10000000')
  expect(screen.getByText('踩中红区')).toBeTruthy()
  expect(screen.queryByText('Miss')).toBeNull()
})

it('catches a press and release spanning a red note between animation frames', async () => {
  chart([note('a', 500, 1), note('red', 1000, 0, true)])
  render(<PlaytestPage />); await start(); tap(0.5, 'f')
  move(980); fireEvent.keyDown(window, { key: 'd' })
  move(1020); fireEvent.keyUp(window, { key: 'd' })
  expect(combo()).toBe('0'); expect(screen.getByText('踩中红区')).toBeTruthy()
})

it('does not retroactively hit a red note when the key is pressed after it passed', async () => {
  chart([note('a', 500, 1), note('red', 1000, 0, true)])
  render(<PlaytestPage />); await start(); tap(0.5, 'f')
  move(1020); fireEvent.keyDown(window, { key: 'd' })
  expect(combo()).toBe('1'); expect(screen.queryByText('踩中红区')).toBeNull()
})

it('ignores fake taps and fully enclosed holds for misses, combo and the score denominator', async () => {
  chart([note('real', 500, 1), redHold(1000, 3000), note('fake', 1500), { ...note('fake-hold', 1000), kind: 'hold', endTime: 2500 }])
  render(<PlaytestPage />); await start(); tap(0.5, 'f')
  expect(score()).toBe('10000000')
  await frame(3500); await frame(4000)
  expect(combo()).toBe('1'); expect(score()).toBe('10000000')
  expect(screen.queryByText('Miss')).toBeNull()
  expect(state.editor.commitEdit).not.toHaveBeenCalled()
})

it('retains real judgments in other lanes while excluding fake notes from early hit candidates', async () => {
  chart([redHold(1000, 2000), note('fake', 1500), note('real', 1500, 1)])
  render(<PlaytestPage />); await start()
  tap(1.4) // Inside the normal early-hit window, before the fake note crosses.
  expect(score()).toBe('00000000'); expect(combo()).toBe('0')
  tap(1.5, 'f'); expect(combo()).toBe('1'); expect(score()).toBe('10000000')
  await frame(2500)
  expect(screen.queryByText('Miss')).toBeNull()
})

it('suppresses only hold ticks inside a red interval and allows resuming after the interval', async () => {
  chart([{ ...note('normal-hold', 500), kind: 'hold', endTime: 2500 }, redHold(1000, 1500)])
  render(<PlaytestPage />); await start()
  move(500); fireEvent.keyDown(window, { key: 'd' })
  await frame(750)
  move(900); fireEvent.keyUp(window, { key: 'd' })
  await frame(1500)
  expect(combo()).toBe('2'); expect(screen.queryByText('Miss')).toBeNull()
  move(1550); fireEvent.keyDown(window, { key: 'd' })
  await frame(2000); await frame(2600)
  expect(score()).toBe('10000000'); expect(combo()).toBe('4')
  expect(screen.queryByText('Miss')).toBeNull()
})

it('requires the portion of a hold after its fake head leaves the red zone', async () => {
  chart([{ ...note('normal-hold', 1000), kind: 'hold', endTime: 3000 }, redHold(1000, 1500)])
  render(<PlaytestPage />); await start()
  await frame(1500); expect(screen.queryByText('Miss')).toBeNull()
  await frame(2000); expect(screen.getByText('Miss')).toBeTruthy()
})

it('clears red contacts on restart and does not judge input while paused', async () => {
  chart([note('a', 500, 1), redHold(1000, 2000)])
  render(<PlaytestPage />); await start(); tap(0.5, 'f')
  fireEvent.keyDown(window, { code: 'Space' }); move(1500); fireEvent.keyDown(window, { key: 'd' })
  expect(combo()).toBe('1'); expect(screen.queryByText('踩中红区')).toBeNull()
  fireEvent.keyUp(window, { key: 'd' })
  fireEvent.click(screen.getByTitle('重新开始'))
  vi.mocked(performance.now).mockReturnValue(0)
  await start(); tap(0.5, 'f'); move(1500); fireEvent.keyDown(window, { key: 'd' })
  expect(combo()).toBe('0'); expect(screen.getByText('踩中红区')).toBeTruthy()
})

it('does not miss a hold tick at a red tail with floating-point timestamp drift', async () => {
  chart([{ ...note('normal-hold', 500), kind: 'hold', endTime: 2500 }, redHold(1000, 1500 - 1e-10)])
  render(<PlaytestPage />); await start()
  move(500); fireEvent.keyDown(window, { key: 'd' })
  await frame(750)
  move(1000); fireEvent.keyUp(window, { key: 'd' })
  await frame(1500)
  expect(screen.queryByText('Miss')).toBeNull()
  move(1550); fireEvent.keyDown(window, { key: 'd' })
  await frame(2000); await frame(2600)
  expect(score()).toBe('10000000')
  expect(screen.queryByText('Miss')).toBeNull()
})

it.each([{ release: 1050, resume: 1450 }, { release: 950, resume: 1550 }])('allows late release and early reconnect at red hold edges ($release/$resume)', async ({ release, resume }) => {
  chart([{ ...note('normal-hold', 500), kind: 'hold', endTime: 2500 }, redHold(1000, 1500)])
  render(<PlaytestPage />); await start()
  move(500); fireEvent.keyDown(window, { key: 'd' })
  await frame(750)
  move(release); fireEvent.keyUp(window, { key: 'd' })
  move(resume); fireEvent.keyDown(window, { key: 'd' })
  await frame(2000); await frame(2600)
  expect(score()).toBe('10000000')
  expect(combo()).toBe('4')
  expect(screen.queryByText('踩中红区')).toBeNull()
  expect(screen.queryByText('Miss')).toBeNull()
})

it('protects ordinary hold ticks just outside red boundaries during the transition', async () => {
  chart([{ ...note('normal-hold', 500), kind: 'hold', endTime: 2500 }, redHold(1030, 1470)])
  render(<PlaytestPage />); await start()
  move(500); fireEvent.keyDown(window, { key: 'd' })
  await frame(750)
  move(980); fireEvent.keyUp(window, { key: 'd' })
  await frame(1500)
  expect(screen.queryByText('Miss')).toBeNull()
  move(1520); fireEvent.keyDown(window, { key: 'd' })
  await frame(2000); await frame(2600)
  expect(score()).toBe('10000000')
  expect(screen.queryByText('踩中红区')).toBeNull()
})

it('still breaks combo for releasing too late or pressing in the middle of a red hold', async () => {
  chart([note('real', 500, 1), redHold(1000, 2000)])
  render(<PlaytestPage />); await start(); tap(0.5, 'f')
  move(950); fireEvent.keyDown(window, { key: 'd' })
  move(1150); fireEvent.keyUp(window, { key: 'd' })
  expect(combo()).toBe('0')
  expect(screen.getByText('踩中红区')).toBeTruthy()
})

it('auto plays chords and hold ticks across skipped frames and red zones', async () => {
  chart([note('tap', 500, 1), { ...note('hold', 500), kind: 'hold', endTime: 2500 },
    redHold(1000, 1500), note('fake', 1200)])
  render(<PlaytestPage />)
  const toggle = screen.getByRole('button', { name: '自动演奏' })
  fireEvent.click(toggle)
  await start()
  tap(0.45, 'f')
  expect(combo()).toBe('0')
  await frame(750)
  expect(combo()).toBe('3')
  await frame(1200)
  expect(document.querySelector('.playtest-hold-effect')).toBeNull()
  await frame(2000)
  expect(document.querySelector('.playtest-hold-effect')).toBeTruthy()
  await frame(2600)
  expect(combo()).toBe('5')
  expect(score()).toBe('10000000')
  fireEvent.click(screen.getByTitle('重新开始'))
  expect(toggle.getAttribute('aria-pressed')).toBe('true')
  fireEvent.click(toggle)
  expect(toggle.getAttribute('aria-pressed')).toBe('false')
})


it('lights tapped lanes together and releases them independently of a held lane', async () => {
  chart([note('tap', 500, 1), note('chord', 500, 2), { ...note('hold', 500), kind: 'hold', endTime: 1500 }])
  render(<PlaytestPage />)
  fireEvent.click(screen.getByRole('button', { name: '自动演奏' }))
  await start()
  await frame(510)
  const litKeys = () => [...document.querySelectorAll('.playtest-key-caps .pressed')].map((key) => key.textContent)
  expect(litKeys()).toEqual(['d', 'f', 'j'])
  expect(document.querySelector<HTMLElement>('.playtest-hit-effect')?.style.backgroundImage).toContain('/claude/tap_hit_4k.png')
  expect(document.querySelector<HTMLElement>('.playtest-hold-effect')?.style.backgroundImage).toContain('/claude/hold_loop_4k.png')
  expect(state.lanePressed).toHaveBeenCalledWith(1, true)
  const holdSprite = document.querySelector<HTMLElement>('.playtest-hold-effect')!
  fireEvent.animationIteration(holdSprite)
  expect(document.querySelector('.playtest-hold-effect')).toBe(holdSprite)
  await frame(650)
  expect(litKeys()).toEqual(['d'])
  expect(state.lanePressed).toHaveBeenCalledWith(1, false)
  await frame(1500)
  expect(litKeys()).toEqual([])
  expect(document.querySelector('.playtest-hold-effect')).toBe(holdSprite)
  expect(holdSprite.classList.contains('finishing')).toBe(true)
  fireEvent.animationIteration(holdSprite)
  expect(document.querySelector('.playtest-hold-effect')).toBe(holdSprite)
  fireEvent.animationEnd(holdSprite)
  expect(document.querySelector('.playtest-hold-effect')).toBeNull()
})

it('uses the selected appearance for tap and hold effects during play', async () => {
  particles.id = 'custom-look'
  const tapAtlas = new Blob(['tap']), holdAtlas = new Blob(['hold'])
  particles.readAssets.mockResolvedValue({
    tap: { image: tapAtlas, columns: 2, rows: 1, frameDurations: [200, 450] },
    hold: { image: holdAtlas, columns: 2, rows: 2, frameDurations: [30, 40, 60] },
  })
  vi.stubGlobal('Image', class { decode = async () => {} })
  const revoke = vi.fn()
  vi.stubGlobal('URL', class extends URL {
    static createObjectURL = (image: Blob) => image === tapAtlas ? 'blob:tap-atlas' : 'blob:hold-atlas'
    static revokeObjectURL = revoke
  })
  chart([note('tap', 500, 1), { ...note('hold', 500), kind: 'hold', endTime: 1500 }])
  const view = render(<PlaytestPage />)
  await start()
  move(500)
  fireEvent.keyDown(window, { key: 'f' })
  fireEvent.keyDown(window, { key: 'd' })

  const hit = document.querySelector<HTMLElement>('.playtest-hit-effect')
  const hold = document.querySelector<HTMLElement>('.playtest-hold-effect')
  expect(particles.readAssets).toHaveBeenCalledWith('custom-look')
  expect(hit?.style.backgroundImage).toContain('blob:tap-atlas')
  expect(hit?.style.getPropertyValue('--playtest-sprite-duration')).toBe('650ms')
  expect(hold?.style.backgroundImage).toContain('blob:hold-atlas')
  view.unmount()
  expect(revoke.mock.calls.flat()).toEqual(['blob:tap-atlas', 'blob:hold-atlas'])
})

it('shows Miss text without a sprite for a missed tap or hold head', async () => {
  chart([note('tap', 500, 1), { ...note('hold', 1000), kind: 'hold', endTime: 2000 }])
  render(<PlaytestPage />)
  await start()
  await frame(701)
  expect(screen.getByText('Miss')).toBeTruthy()
  expect(document.querySelector('.playtest-hit-effect')).toBeNull()

  move(835)
  fireEvent.keyDown(window, { key: 'd' })
  expect(screen.getAllByText('Miss')).toHaveLength(2)
  expect(document.querySelector('.playtest-hit-effect, .playtest-hold-effect')).toBeNull()
  await frame(1500)
  expect(document.querySelector('.playtest-hold-effect')).toBeTruthy()
})

it('shows only the latest judgment at center even after the combo breaks', async () => {
  state.judgmentDisplay = 'center'
  chart([note('hit', 500, 1), note('miss', 600, 2)])
  render(<PlaytestPage />)
  await start()
  tap(0.5, 'f')
  expect(screen.getByText('Perfect').closest('.playtest-judgment.centered')).toBeTruthy()
  expect(document.querySelector('.playtest-hit-effect')).toBeTruthy()
  expect(combo()).toBe('1')

  await frame(801)
  expect(screen.queryByText('Perfect')).toBeNull()
  expect(screen.getByText('Miss').closest('.playtest-judgment.centered')).toBeTruthy()
  expect(screen.getByText('Late')).toBeTruthy()
  expect(combo()).toBe('0')
})

it('replays the pop and replaces the timing text during dense repeated judgments', async () => {
  state.judgmentDisplay = 'center'
  chart([note('early', 600), note('late', 490, 1), note('perfect', 750)])
  render(<PlaytestPage />)
  await start()

  tap(0.5)
  const firstResult = screen.getByText('Good')
  expect(firstResult.closest('.playtest-judgment.centered')?.previousElementSibling?.textContent).toBe('1')
  expect(firstResult.contains(screen.getByText('Early'))).toBe(true)

  tap(0.59, 'f')
  const nextResult = screen.getByText('Good')
  expect(nextResult).not.toBe(firstResult)
  expect(nextResult.contains(screen.getByText('Late'))).toBe(true)
  expect(screen.queryByText('Early')).toBeNull()

  tap(0.75)
  expect(screen.getByText('Perfect')).toBeTruthy()
  expect(screen.queryByText('Late')).toBeNull()
})

it('keeps the hold sprite mounted across scoring ticks without spawning a tap sprite', async () => {
  chart([{ ...note('hold', 500), kind: 'hold', endTime: 2000 }])
  render(<PlaytestPage />)
  await start()
  move(500)
  fireEvent.keyDown(window, { key: 'd' })
  const hold = document.querySelector<HTMLElement>('.playtest-hold-effect')
  expect(hold?.style.backgroundImage).toContain('/claude/hold_loop_4k.png')
  expect(document.querySelector('.playtest-hit-effect')).toBeNull()

  await frame(1000)
  expect(Number(combo())).toBeGreaterThan(1)
  expect(document.querySelector('.playtest-hold-effect')).toBe(hold)
  expect(document.querySelector('.playtest-hit-effect')).toBeNull()

  fireEvent.keyUp(window, { key: 'd' })
  expect(document.querySelector('.playtest-hold-effect')).toBeNull()
})
