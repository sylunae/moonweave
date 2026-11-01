// @vitest-environment jsdom
import { act, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { normalizeChart, type Chart, type ToolMode } from '@/features/chart/types'
import { useEffectsEditor } from '@/features/chart/effects/EffectsModule'

let chart: Chart
let editor: ReturnType<typeof useEffectsEditor>
let tool: ToolMode
let changeTool: (tool: ToolMode) => void
const commitEdit = vi.fn((update: (chart: Chart) => Chart) => { chart = update(chart) })
vi.mock('@/features/chart/ChartProvider', () => ({ useChart: () => ({ chart, activeChartId: 'test-chart', commitEdit, setCurrentTime: vi.fn() }) }))
vi.mock('@/app/i18n', () => ({ useI18n: () => ({ text: (_zh: string, en: string) => en }) }))

function Harness() {
  const [currentTool, setTool] = useState<ToolMode>('note')
  tool = currentTool; changeTool = setTool
  editor = useEffectsEditor(currentTool, setTool)
  return null
}

let root: Root
let container: HTMLDivElement
beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  chart = normalizeChart({ duration: 10000 })
  commitEdit.mockClear()
  container = document.createElement('div'); document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => root.render(<Harness />))
})
afterEach(async () => { await act(async () => root.unmount()); container.remove() })

describe('effect editing workflow', () => {
  it('keeps incomplete inputs local and cancels without saving', async () => {
    await act(async () => editor.add())
    expect(tool).toBe('effect')
    await act(async () => editor.onLine(1000))
    await act(async () => editor.setDraft({ ...editor.draft!, multiplier: '1.' }))
    expect(editor.draft!.multiplier).toBe('1.')
    expect(chart.effects).toEqual([])
    await act(async () => editor.cancel())
    expect(editor.draft).toBeNull()
    expect(commitEdit).not.toHaveBeenCalled()
  })
  it('selects a ramp end then commits once, with zero allowed', async () => {
    await act(async () => editor.add())
    await act(async () => editor.onLine(1000))
    await act(async () => editor.setDraft({ ...editor.draft!, transition: 'linear', multiplier: '0' }))
    await act(async () => editor.pickEnd())
    await act(async () => editor.onLine(500))
    expect(editor.picking).toBe('end')
    expect(editor.error).toBeTruthy()
    await act(async () => editor.onLine(3000))
    expect(editor.draft!.endTime).toBe(3000)
    expect(chart.effects).toEqual([])
    await act(async () => editor.save())
    expect(commitEdit).toHaveBeenCalledTimes(1)
    expect(chart.effects[0]).toMatchObject({ time: 1000, endTime: 3000, multiplier: 0, transition: 'linear' })
  })
  it('rejects overlap without dropping the existing event', async () => {
    chart = normalizeChart({ effects: [{ id: 'old', type: 'scrollSpeed', time: 1000, endTime: 4000, transition: 'linear', multiplier: 0 }] })
    await act(async () => root.render(<Harness />))
    await act(async () => editor.add())
    await act(async () => editor.onLine(2000))
    await act(async () => editor.save())
    expect(editor.error).toContain('overlapping')
    expect(commitEdit).not.toHaveBeenCalled()
    expect(chart.effects).toHaveLength(1)
  })
  it('rejects empty, negative and excessive multipliers', async () => {
    await act(async () => editor.add())
    await act(async () => editor.onLine(1000))
    for (const multiplier of ['', '-1', '11', 'Infinity']) {
      await act(async () => editor.setDraft({ ...editor.draft!, multiplier }))
      await act(async () => editor.save())
      expect(editor.error).toBeTruthy()
    }
    expect(commitEdit).not.toHaveBeenCalled()
  })
  it('cancels line selection on Escape or tool change', async () => {
    await act(async () => editor.add())
    await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })))
    expect(editor.picking).toBeNull()
    expect(tool).toBe('note')
    await act(async () => editor.add())
    await act(async () => changeTool('hold'))
    expect(editor.picking).toBeNull()
    expect(tool).toBe('hold')
    expect(commitEdit).not.toHaveBeenCalled()
  })
})
