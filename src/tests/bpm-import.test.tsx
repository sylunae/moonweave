// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import { ChartProvider, useChart } from '@/features/chart/ChartProvider'

const detection = vi.hoisted(() => ({ props: null as null | { url: string; onApply(bpm: number): void } }))
vi.mock('@/features/chart/BpmDetectionDialog', () => ({ BpmDetectionDialog: (props: typeof detection.props) => { detection.props = props; return null } }))
vi.mock('@/app/preferences', () => ({ usePreferences: () => ({ setPreferences: stableSetPreferences }), migrateLegacyChartPreferences: vi.fn() }))
const stableSetPreferences = vi.fn()

afterEach(() => { delete window.moonweave; vi.restoreAllMocks(); detection.props = null })

async function setup() {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})
  const original = {
    bpm: 120, offset: 125, title: 'Test',
    notes: [{ id: 'note', lane: 0, kind: 'note', time: 1000 }],
    effects: [{ id: 'speed', type: 'scrollSpeed', time: 1500, multiplier: 2 }],
    bpmChanges: [{ time: 3000, bpm: 180 }],
  }
  const api = {
    listCharts: vi.fn(async () => [{ id: 'test', title: 'Test' }]),
    readChart: vi.fn(async () => ({ chart: original, audioUrl: '', backgroundUrl: '', coverUrl: '' })),
    writeChart: vi.fn(async () => ({ id: 'test', title: 'Test' })),
    chooseAudio: vi.fn(async () => ({ name: 'song.wav', audioPath: 'song.wav', url: 'moon-audio://library/song.wav' })),
  }
  window.moonweave = api as unknown as NonNullable<typeof window.moonweave>
  let context: ReturnType<typeof useChart>
  function Harness() { context = useChart(); return null }
  const element = document.createElement('div')
  const root = createRoot(element)
  await act(async () => root.render(<ChartProvider><Harness /></ChartProvider>))
  return { api, get context() { return context! }, cleanup: async () => { await act(async () => root.unmount()) } }
}

it('only applies BPM after confirmation, preserves timing and supports undo/redo', async () => {
  const session = await setup()
  try {
    await act(async () => session.context.chooseAudio())
    expect(detection.props?.url).toBe('moon-audio://library/song.wav')
    expect(session.context.chart.bpm).toBe(120)
    const before = session.context.chart
    await act(async () => detection.props!.onApply(150))
    expect(session.context.chart.bpm).toBe(150)
    expect(session.context.chart.notes).toEqual(before.notes)
    expect(session.context.chart.effects).toEqual(before.effects)
    expect(session.context.chart.bpmChanges).toEqual(before.bpmChanges)
    expect(session.context.chart.offset).toBe(before.offset)
    await act(async () => session.context.undo())
    expect(session.context.chart.bpm).toBe(120)
    expect(session.context.chart.audioName).toBe('song.wav')
    await act(async () => session.context.redo())
    expect(session.context.chart.bpm).toBe(150)
  } finally { await session.cleanup() }
})

it('ignores confirmation from an older audio import', async () => {
  const session = await setup()
  try {
    await act(async () => session.context.chooseAudio())
    const stale = detection.props!
    await act(async () => session.context.chooseAudio())
    await act(async () => stale.onApply(160))
    expect(session.context.chart.bpm).toBe(120)
    await act(async () => detection.props!.onApply(140))
    expect(session.context.chart.bpm).toBe(140)
  } finally { await session.cleanup() }
})

it('ignores detection results after switching charts', async () => {
  const session = await setup()
  try {
    await act(async () => session.context.chooseAudio())
    const stale = detection.props!
    await act(async () => { await session.context.selectChart('another') })
    await act(async () => stale.onApply(160))
    expect(session.context.chart.bpm).toBe(120)
  } finally { await session.cleanup() }
})

it('ignores a file picker result if the chart changed while it was open', async () => {
  const session = await setup()
  try {
    let finish!: (result: Awaited<ReturnType<typeof session.api.chooseAudio>>) => void
    session.api.chooseAudio.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
    let pending!: Promise<void>
    await act(async () => { pending = session.context.chooseAudio() })
    await act(async () => { await session.context.selectChart('another') })
    await act(async () => { finish({ name: 'late.wav', audioPath: 'late.wav', url: 'moon-audio://library/late.wav' }); await pending })
    expect(session.context.chart.audioName).not.toBe('late.wav')
    expect(detection.props).toBeNull()
  } finally { await session.cleanup() }
})
