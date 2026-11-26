// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import { ChartProvider, useChart } from '@/features/chart/ChartProvider'
import { createChartPackage } from '@/features/chart/chartPackage'
import { normalizeChart } from '@/features/chart/types'
import { retimeInitialBpm } from '@/features/chart/tempoMap'
import { mergeRecording } from '@/features/chart/improvisation'
import { prepareAiImport } from '@/features/chart/ai/aiChart'

const dependencies = vi.hoisted(() => ({ setPreferences: vi.fn(), writeWebChart: vi.fn(async () => ({ updatedAt: 1 })) }))
vi.mock('@/app/preferences', () => ({ usePreferences: () => ({ setPreferences: dependencies.setPreferences }), migrateLegacyChartPreferences: vi.fn() }))
vi.mock('@/features/chart/webLibrary', () => ({
  listWebCharts: async () => [{ id: 'test-chart', updatedAt: 1, chart: { bpm: 120, title: 'Original' } }],
  readWebChart: async () => ({ id: 'test-chart', chart: { bpm: 120, title: 'Original' } }),
  writeWebChart: dependencies.writeWebChart, deleteWebChart: vi.fn(),
}))
vi.mock('@/features/chart/BpmDetectionDialog', () => ({ BpmDetectionDialog: () => null }))

it('opens the chart document picker immediately and reserves media selection for the legacy action', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  const pause = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})
  const pickers: HTMLInputElement[] = []
  const click = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(function (this: HTMLInputElement) {
    pickers.push(this)
    this.dispatchEvent(new Event('cancel'))
  })
  const root = createRoot(document.createElement('div'))
  let context!: ReturnType<typeof useChart>
  function Harness() { context = useChart(); return null }
  try {
    await act(async () => root.render(<ChartProvider><Harness /></ChartProvider>))
    dependencies.writeWebChart.mockClear()

    const importing = context.importChart()
    expect(click).toHaveBeenCalledOnce()
    const [primary] = pickers
    expect(primary.accept.split(',')).toEqual(['.mwchart', '.zip', 'application/zip', 'application/json', '.json'])
    expect(primary.multiple).toBe(false)
    await expect(importing).resolves.toBeNull()

    await expect(context.importChart(true)).resolves.toBeNull()
    const [, legacy] = pickers
    expect(legacy.accept.split(',')).toEqual(expect.arrayContaining(['.json', 'audio/*', 'image/png', 'video/mp4']))
    expect(legacy.multiple).toBe(true)
    expect(dependencies.writeWebChart).not.toHaveBeenCalled()
  } finally {
    await act(async () => root.unmount())
    pause.mockRestore()
    click.mockRestore()
  }
})

it('imports ZIP and JSON charts without the secure-context randomUUID API', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  const zipChart = normalizeChart({ title: 'ZIP chart' })
  const jsonChart = normalizeChart({ title: 'JSON chart' })
  const zipBytes = await createChartPackage(zipChart, {})
  const files = [
    Object.assign(new File([], 'song.zip'), { arrayBuffer: async () => new Uint8Array(zipBytes).buffer }),
    Object.assign(new File([], 'song.json'), { text: async () => JSON.stringify(jsonChart) }),
  ]
  const pause = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})
  const click = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(function (this: HTMLInputElement) {
    Object.defineProperty(this, 'files', { value: [files.shift()] })
    this.dispatchEvent(new Event('change'))
  })
  vi.stubGlobal('crypto', { getRandomValues: crypto.getRandomValues.bind(crypto) })
  const root = createRoot(document.createElement('div'))
  let context!: ReturnType<typeof useChart>
  function Harness() { context = useChart(); return null }
  try {
    await act(async () => root.render(<ChartProvider><Harness /></ChartProvider>))
    const ids = new Set<string | null>()
    for (const { title } of [zipChart, jsonChart]) {
      let id: string | null = null
      await act(async () => { id = await context.importChart() })
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
      expect(context.activeChartId).toBe(id)
      expect(dependencies.writeWebChart).toHaveBeenLastCalledWith(id, expect.objectContaining({ title }), expect.anything())
      ids.add(id)
    }
    expect(ids.size).toBe(2)
  } finally {
    await act(async () => root.unmount())
    pause.mockRestore()
    click.mockRestore()
    vi.unstubAllGlobals()
    dependencies.writeWebChart.mockClear()
  }
})

it('requires creation audio and shares song info while keeping four distinct difficulty tracks', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  const pause = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})
  vi.stubGlobal('URL', class extends URL {
    static createObjectURL() { return 'blob:test-song' }
    static revokeObjectURL() {}
  })
  const root = createRoot(document.createElement('div'))
  let context!: ReturnType<typeof useChart>
  function Harness() { context = useChart(); return null }
  try {
    await act(async () => root.render(<ChartProvider><Harness /></ChartProvider>))
    dependencies.writeWebChart.mockClear()
    const initial = normalizeChart({ title: 'Four tracks' })
    expect(await context.createChart(initial, {})).toBeNull()
    expect(dependencies.writeWebChart).not.toHaveBeenCalled()

    const audio = new File(['audio'], 'song.ogg', { type: 'audio/ogg' })
    const cover = new File(['cover'], 'cover.png', { type: 'image/png' })
    let id = ''
    await act(async () => { id = (await context.createChart(initial, { audio, cover }))! })
    expect(context.chart.library).toMatchObject({ status: 'draft', levels: [1, 1, 1, 1], tier: 1 })
    expect(Object.keys(context.chart.tracks!)).toEqual(['0', '2', '3'])
    expect(dependencies.writeWebChart).toHaveBeenLastCalledWith(id, expect.objectContaining({ audioName: 'song.ogg', coverName: 'cover.png' }), { audio, cover })

    for (const tier of [0, 1, 2, 3]) {
      await act(async () => { await context.selectChart(id, tier) })
      expect(context.chart.notes).toEqual([])
      await act(async () => context.commitNotes([{ id: String(tier), kind: 'note', lane: tier, time: 2000 }]))
    }
    await act(async () => {
      const chart = retimeInitialBpm(context.chart, 240)
      await context.saveChartInfo(id, { ...chart, title: 'Renamed', library: { ...chart.library!, levels: [2, 4, 6, 8] } }, {})
    })
    for (const tier of [0, 1, 2, 3]) {
      await act(async () => { await context.selectChart(id, tier) })
      expect(context.chart).toMatchObject({
        title: 'Renamed', bpm: 240, audioName: 'song.ogg', coverName: 'cover.png',
        library: { tier, levels: [2, 4, 6, 8] },
        notes: [{ id: String(tier), lane: tier, time: 1000 }],
      })
    }
    const normalNotes = context.chart.tracks![1].notes
    expect(await context.importNotes(normalNotes, id, 2)).toBe('stale')
    await act(async () => { expect(await context.importNotes(normalNotes, id, 3)).toBe('saved') })
    expect(context.chart.notes).toEqual(normalNotes)
    expect(context.chart.tracks?.[1].notes).toEqual(normalNotes)
    expect(context.chart).toMatchObject({ title: 'Renamed', bpm: 240, audioName: 'song.ogg', coverName: 'cover.png' })
    expect(dependencies.writeWebChart).toHaveBeenLastCalledWith(id, expect.objectContaining({ notes: normalNotes }), expect.anything())
    await act(async () => context.undo())
    expect(context.chart.notes).toEqual([{ id: '3', kind: 'note', lane: 3, time: 1000 }])
  } finally {
    await act(async () => root.unmount())
    pause.mockRestore()
    vi.unstubAllGlobals()
    dependencies.writeWebChart.mockClear()
  }
})

it('undoes and redoes BPM, notes, effects and linked retiming as atomic edits', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  const pause = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})
  const element = document.createElement('div'); document.body.appendChild(element)
  const root = createRoot(element)
  let context: ReturnType<typeof useChart>
  function Harness() { context = useChart(); return null }
  try {
    await act(async () => { root.render(<ChartProvider><Harness /></ChartProvider>) })
    expect(context!.activeChartId).toBe('test-chart')
    await act(async () => context!.commitEdit((chart) => ({ ...chart, ...normalizeChart({ ...chart,
      notes: [{ id: 'note', lane: 0, time: 2000, kind: 'note' }],
      effects: [{ id: 'speed', type: 'scrollSpeed', time: 2000, endTime: 4000, multiplier: 0, transition: 'linear' }],
    }) })))
    await act(async () => context!.commitEdit((chart) => retimeInitialBpm(chart, 240)))
    expect(context!.chart.effects[0]).toMatchObject({ time: 1000, endTime: 2000 })
    expect(context!.historyLength).toBe(2)
    await act(async () => context!.setChart((chart) => ({ ...chart, title: 'Renamed' })))
    await act(async () => context!.undo())
    expect(context!.chart.bpm).toBe(120)
    expect(context!.chart.notes[0].time).toBe(2000)
    expect(context!.chart.effects[0]).toMatchObject({ time: 2000, endTime: 4000 })
    expect(context!.chart.title).toBe('Renamed')
    await act(async () => context!.redo())
    expect(context!.chart.notes[0].time).toBe(1000)
    expect(context!.chart.effects[0]).toMatchObject({ time: 1000, endTime: 2000 })
    await act(async () => context!.undo())
    await act(async () => context!.commitNotes([]))
    expect(context!.futureLength).toBe(0)
    await act(async () => context!.undo())
    expect(context!.chart.notes[0].time).toBe(2000)
    expect(dependencies.writeWebChart).not.toHaveBeenCalled()
  } finally {
    await act(async () => root.unmount())
    element.remove(); pause.mockRestore()
  }
})

it('saves an improvised take as one undoable edit and flushes the committed chart immediately', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  const pause = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})
  const element = document.createElement('div'); document.body.appendChild(element)
  const root = createRoot(element)
  let context: ReturnType<typeof useChart>
  function Harness() { context = useChart(); return null }
  try {
    await act(async () => root.render(<ChartProvider><Harness /></ChartProvider>))
    await act(async () => context!.commitNotes([{ id: 'original', kind: 'hold', lane: 0, time: 500, endTime: 1500 }]))
    const original = context!.chart.notes
    const take = [{ id: 'recorded', kind: 'note' as const, lane: 0, time: 1000 }, { id: 'free', kind: 'note' as const, lane: 1, time: 1000 }]
    dependencies.writeWebChart.mockClear()
    await act(async () => {
      context!.commitEdit((chart) => ({ ...chart, notes: mergeRecording(chart.notes, take, true) }))
      expect(await context!.flushActiveChart()).toBe(true)
    })
    expect(context!.historyLength).toBe(2)
    expect(context!.chart.notes).toEqual(take)
    expect(dependencies.writeWebChart).toHaveBeenLastCalledWith('test-chart', expect.objectContaining({ notes: take }), expect.anything())
    await act(async () => context!.undo())
    expect(context!.chart.notes).toEqual(original)
    await act(async () => context!.redo())
    expect(context!.chart.notes).toEqual(take)
  } finally {
    await act(async () => root.unmount())
    element.remove(); pause.mockRestore()
    dependencies.writeWebChart.mockClear()
  }
})

it('applies an AI batch once, persists it immediately and restores its receipt with undo/redo', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  const pause = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})
  const element = document.createElement('div'); document.body.appendChild(element)
  const root = createRoot(element)
  let context: ReturnType<typeof useChart>
  function Harness() { context = useChart(); return null }
  try {
    await act(async () => root.render(<ChartProvider><Harness /></ChartProvider>))
    await act(async () => context!.setChart((chart) => ({ ...chart, audioName: 'song.wav', duration: 10000 })))
    const input = { format: 'moonweave-ai-chart', version: 1, requestId: 'ai-batch', mode: 'replace', unit: 'beat',
      song: { audioName: 'song.wav', duration: 10000, bpm: 150, offset: 1000, bpmChanges: [] },
      notes: [{ id: 'tap', lane: 0, kind: 'note', beat: 0 }, { id: 'hold', lane: 2, kind: 'hold', beat: 1, endBeat: 3 }] }
    dependencies.writeWebChart.mockClear()
    const plan = await prepareAiImport(context!.chart, context!.activeChartId, input)
    expect(dependencies.writeWebChart).not.toHaveBeenCalled()
    await act(async () => { expect(await context!.applyAiImport(plan)).toBe(true) })
    expect(context!.historyLength).toBe(1)
    expect(context!.chart.notes[1]).toMatchObject({ time: 1400, endTime: 2200 })
    expect(dependencies.writeWebChart).toHaveBeenLastCalledWith('test-chart', expect.objectContaining({ bpm: 150, aiImportHistory: ['ai-batch'] }), expect.anything())
    await act(async () => context!.undo())
    expect(context!.chart).toMatchObject({ bpm: 120, offset: 0, notes: [], aiImportHistory: [] })
    await act(async () => context!.redo())
    expect(context!.chart.aiImportHistory).toEqual(['ai-batch'])
    expect(context!.chart.notes).toHaveLength(2)
    const calls = dependencies.writeWebChart.mock.calls.length
    await expect(context!.applyAiImport(plan)).rejects.toThrow()
    expect(dependencies.writeWebChart).toHaveBeenCalledTimes(calls)
  } finally {
    await act(async () => root.unmount())
    element.remove(); pause.mockRestore(); dependencies.writeWebChart.mockClear()
  }
})

it('keeps an applied AI batch undoable if persistence fails', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  vi.useFakeTimers()
  const pause = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})
  const element = document.createElement('div'); document.body.appendChild(element)
  const root = createRoot(element)
  let context: ReturnType<typeof useChart>
  function Harness() { context = useChart(); return null }
  try {
    await act(async () => root.render(<ChartProvider><Harness /></ChartProvider>))
    await act(async () => context!.setChart((chart) => ({ ...chart, audioName: 'song.wav' })))
    const chart = context!.chart
    const plan = await prepareAiImport(chart, context!.activeChartId, { format: 'moonweave-ai-chart', version: 1, requestId: 'save-fails', mode: 'replace', unit: 'ms',
      song: { audioName: 'song.wav', duration: chart.duration, bpm: 120, offset: 0, bpmChanges: [] },
      notes: [{ id: 'tap', kind: 'note', lane: 0, time: 1000 }] })
    dependencies.writeWebChart.mockRejectedValueOnce(new Error('disk unavailable'))
    await act(async () => { expect(await context!.applyAiImport(plan)).toBe(false) })
    expect(context!.chart.notes).toHaveLength(1)
    expect(context!.storageStatus).toBe('error')
    expect(context!.historyLength).toBe(1)
    const calls = dependencies.writeWebChart.mock.calls.length
    await act(async () => vi.advanceTimersByTimeAsync(600))
    expect(dependencies.writeWebChart).toHaveBeenCalledTimes(calls)
    expect(context!.storageStatus).toBe('error')
    await act(async () => context!.undo())
    expect(context!.chart.notes).toEqual([])
    expect(context!.chart.aiImportHistory).toEqual([])
  } finally {
    await act(async () => root.unmount())
    element.remove(); pause.mockRestore(); dependencies.writeWebChart.mockClear(); vi.useRealTimers()
  }
})
