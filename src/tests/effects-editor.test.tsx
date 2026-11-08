// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { EffectsModule, useEffectsEditor } from '@/features/chart/effects/EffectsModule'
import { normalizeChart, type Chart, type ToolMode } from '@/features/chart/types'

let chart: Chart
const commitEdit = vi.fn((edit: (chart: Chart) => Chart) => { chart = edit(chart) })
vi.mock('@/features/chart/ChartProvider', () => ({ useChart: () => ({ chart, activeChartId: 'chart', commitEdit, setCurrentTime: vi.fn() }) }))
vi.mock('@/app/i18n', () => ({ useI18n: () => ({ text: (_zh: string, en: string) => en }) }))

beforeEach(() => {
  vi.clearAllMocks()
  chart = normalizeChart({ duration: 10000, effects: [
    { id: 'ramp', type: 'scrollSpeed', time: 2000, endTime: 5000, multiplier: 2, transition: 'linear' },
    { id: 'instant', type: 'scrollSpeed', time: 7000, multiplier: 0, transition: 'instant' },
  ] })
})
afterEach(cleanup)

function setup() {
  return renderHook(() => {
    const [tool, setTool] = useState<ToolMode>('note')
    return useEffectsEditor(tool, setTool)
  })
}

it('moves a ramp start without replacing the effect or changing its other settings, only on save', () => {
  const { result } = setup()
  const original = chart.effects[0]
  act(() => result.current.edit(original))
  act(() => result.current.pickStart())
  act(() => result.current.onLine(3000))
  expect(result.current.picking).toBeNull()
  expect(result.current.draft).toMatchObject({ ...original, time: 3000, multiplier: '2' })
  expect(commitEdit).not.toHaveBeenCalled()
  act(() => result.current.save())
  expect(chart.effects).toEqual([{ ...original, time: 3000 }, expect.objectContaining({ id: 'instant' })])
  expect(commitEdit).toHaveBeenCalledOnce()
})

it('keeps picking when a ramp start is at or beyond its end', () => {
  const { result } = setup()
  act(() => result.current.edit(chart.effects[0]))
  act(() => result.current.pickStart())
  for (const time of [5000, 6000]) {
    act(() => result.current.onLine(time))
    expect(result.current.picking).toBe('start')
    expect(result.current.draft?.time).toBe(2000)
    expect(result.current.error).toBe('Start must precede end')
  }
  act(() => result.current.onLine(1000))
  expect(result.current.error).toBe('')
  expect(result.current.draft?.time).toBe(1000)
})

it('can move an instant stop and cancel without changing the chart', () => {
  const { result } = setup()
  act(() => result.current.edit(chart.effects[1]))
  act(() => result.current.pickStart())
  act(() => result.current.onLine(0))
  expect(result.current.draft).toMatchObject({ id: 'instant', time: 0, multiplier: '0', transition: 'instant' })
  act(() => result.current.cancel())
  expect(commitEdit).not.toHaveBeenCalled()
  expect(chart.effects[1].time).toBe(7000)
})

it('rejects a moved start that overlaps another effect without dropping either effect', () => {
  const { result } = setup()
  act(() => result.current.edit(chart.effects[1]))
  act(() => result.current.pickStart())
  act(() => result.current.onLine(3000))
  act(() => result.current.save())
  expect(result.current.error).toBe('Duplicate position or overlapping speed transition')
  expect(commitEdit).not.toHaveBeenCalled()
  expect(chart.effects).toHaveLength(2)
})

it('returns to the unchanged draft on Escape while picking, and can still add a new effect', () => {
  const { result } = setup()
  act(() => result.current.edit(chart.effects[0]))
  act(() => result.current.pickStart())
  act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })))
  expect(result.current.draft).toMatchObject({ id: 'ramp', time: 2000 })
  expect(result.current.picking).toBeNull()
  act(() => result.current.add())
  act(() => result.current.onLine(6000))
  expect(result.current.draft).toMatchObject({ time: 6000, multiplier: '1', transition: 'instant' })
  expect(result.current.draft?.id).not.toBe('ramp')
})

it('saves custom curves and deletes from the active dialog as one edit', () => {
  const { result } = setup()
  act(() => result.current.edit(chart.effects[0]))
  act(() => result.current.setDraft({ ...result.current.draft!, curve: 'custom', bezier: [0.2, 0.1, 0.8, 0.9] }))
  act(() => result.current.save())
  expect(chart.effects[0]).toMatchObject({ curve: 'custom', bezier: [0.2, 0.1, 0.8, 0.9] })
  act(() => result.current.edit(chart.effects[0]))
  act(() => result.current.remove('ramp'))
  expect(chart.effects.map((e) => e.id)).toEqual(['instant'])
  expect(result.current.draft).toBeNull()
  expect(commitEdit).toHaveBeenCalledTimes(2)
})

it('does not save invalid custom coordinates or invalid exact times', () => {
  const { result } = setup()
  act(() => result.current.edit(chart.effects[0]))
  act(() => result.current.setDraft({ ...result.current.draft!, curve: 'custom', bezier: [0, -1, 1, 1] }))
  act(() => result.current.save())
  expect(result.current.error).toContain('control coordinates')
  act(() => result.current.setDraft({ ...result.current.draft!, curve: 'easeIn', time: NaN }))
  act(() => result.current.save())
  expect(result.current.error).toContain('valid start and end')
  expect(commitEdit).not.toHaveBeenCalled()
})

it('protects unsaved settings on navigation and close, and can discard explicitly', () => {
  const { result } = setup()
  act(() => result.current.edit(chart.effects[0]))
  expect(result.current.dirty).toBe(false)
  act(() => result.current.setDraft({ ...result.current.draft!, multiplier: '3' }))
  act(() => result.current.navigate(chart.effects[1]))
  expect(result.current.pending?.event?.id).toBe('instant')
  expect(result.current.draft?.id).toBe('ramp')
  act(() => result.current.dismissPending())
  expect(result.current.draft?.multiplier).toBe('3')
  act(() => result.current.requestClose())
  expect(result.current.pending).toEqual({})
  act(() => result.current.discardPending())
  expect(result.current.draft).toBeNull()
  expect(commitEdit).not.toHaveBeenCalled()
})

it('treats equivalent numbers and a restored linear curve as unchanged', () => {
  const { result } = setup()
  act(() => result.current.edit(chart.effects[0]))
  act(() => result.current.setDraft({ ...result.current.draft!, multiplier: '2.0', startText: '2000', curve: 'linear', bezier: [0.42, 0, 0.58, 1] }))
  expect(result.current.dirty).toBe(false)
  act(() => result.current.save())
  expect(commitEdit).not.toHaveBeenCalled()
  act(() => result.current.requestClose())
  expect(result.current.pending).toBeNull()
  expect(result.current.draft).toBeNull()
})

function renderEditor() {
  let editor!: ReturnType<typeof useEffectsEditor>
  function Harness() {
    const [tool, setTool] = useState<ToolMode>('note')
    editor = useEffectsEditor(tool, setTool)
    return <EffectsModule editor={editor} />
  }
  render(<Harness />)
  act(() => editor.edit(chart.effects[0]))
  return { get editor() { return editor } }
}

it('edits exact positions through the dialog, previews a custom curve and saves via keyboard', () => {
  const session = renderEditor()
  fireEvent.change(screen.getByRole('textbox', { name: 'Start (ms)' }), { target: { value: '1500' } })
  fireEvent.change(screen.getByRole('textbox', { name: 'End (ms)' }), { target: { value: '4500' } })
  act(() => session.editor.setDraft({ ...session.editor.draft!, curve: 'custom', bezier: [0.42, 0, 0.58, 1] }))
  const coordinate = screen.getByRole('textbox', { name: 'Control point X1' })
  fireEvent.change(coordinate, { target: { value: '0.' } })
  expect((coordinate as HTMLInputElement).value).toBe('0.')
  fireEvent.change(coordinate, { target: { value: '0.25' } })
  expect(screen.getByLabelText('Speed curve preview')).toBeTruthy()
  expect(commitEdit).not.toHaveBeenCalled()
  fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Enter', ctrlKey: true })
  expect(chart.effects[0]).toMatchObject({ time: 1500, endTime: 4500, curve: 'custom', bezier: [0.25, 0, 0.58, 1] })
  expect(screen.queryByRole('dialog')).toBeNull()
})

it('exposes deletion in the settings dialog and closes after deleting', () => {
  renderEditor()
  fireEvent.click(screen.getByRole('button', { name: 'Delete effect' }))
  expect(chart.effects.map((event) => event.id)).toEqual(['instant'])
  expect(screen.queryByRole('dialog')).toBeNull()
})

it('keeps invalid time input intact, reports the error and returns from beat picking', () => {
  const session = renderEditor()
  const start = screen.getByRole('textbox', { name: 'Start (ms)' })
  fireEvent.change(start, { target: { value: '' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save' }))
  expect((start as HTMLInputElement).value).toBe('')
  expect(screen.getByRole('alert').textContent).toContain('valid start and end')
  fireEvent.click(screen.getByRole('button', { name: 'Start · Pick beat line' }))
  expect(screen.queryByRole('dialog')).toBeNull()
  act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })))
  expect((screen.getByRole('textbox', { name: 'Start (ms)' }) as HTMLInputElement).value).toBe('')
  expect(session.editor.picking).toBeNull()
  expect(commitEdit).not.toHaveBeenCalled()
})
