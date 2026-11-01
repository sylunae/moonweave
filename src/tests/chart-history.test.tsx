// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import { ChartProvider, useChart } from '@/features/chart/ChartProvider'
import { normalizeChart } from '@/features/chart/types'
import { retimeInitialBpm } from '@/features/chart/tempoMap'

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
