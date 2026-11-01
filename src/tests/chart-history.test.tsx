// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import { ChartProvider, useChart } from '@/features/chart/ChartProvider'
import { normalizeChart } from '@/features/chart/types'
import { retimeInitialBpm } from '@/features/chart/tempoMap'
import { mergeRecording } from '@/features/chart/improvisation'

const dependencies = vi.hoisted(() => ({ setPreferences: vi.fn(), writeWebChart: vi.fn(async () => ({ updatedAt: 1 })) }))
vi.mock('@/app/preferences', () => ({ usePreferences: () => ({ setPreferences: dependencies.setPreferences }), migrateLegacyChartPreferences: vi.fn() }))
vi.mock('@/features/chart/webLibrary', () => ({
  listWebCharts: async () => [{ id: 'test-chart', updatedAt: 1, chart: { bpm: 120, title: 'Original' } }],
  readWebChart: async () => ({ id: 'test-chart', chart: { bpm: 120, title: 'Original' } }),
  writeWebChart: dependencies.writeWebChart, deleteWebChart: vi.fn(),
}))

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
