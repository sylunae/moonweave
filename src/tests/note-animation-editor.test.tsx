// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import NotePropertiesPanel from '@/features/chart/effects/NotePropertiesPanel'
import { motionPreset } from '@/features/chart/effects/noteAnimation'
import { DEFAULT_CHART, type Chart } from '@/features/chart/types'
import ChartEditorPage from '@/pages/ChartEditorPage'

let chart: Chart
let setChart: React.Dispatch<React.SetStateAction<Chart>>
const historyActions = vi.hoisted(() => ({ undo: vi.fn(), redo: vi.fn() }))
vi.mock('@/features/chart/ChartProvider', () => ({ useChart: () => ({ chart, currentTime: 0, activeChartId: 'chart',
  commitEdit: (edit: (chart: Chart) => Chart) => { setChart(edit(chart)) },
  historyLength: 1, futureLength: 1, ...historyActions,
}) }))
vi.mock('@/app/i18n', () => ({ useI18n: () => ({ text: (_: string, en: string) => en }) }))
vi.mock('@/app/preferences', () => ({
  usePreferences: () => ({ preferences: { judgmentLineHeight: 200, playbackRate: 1 } }),
}))
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

const first = { id: '0', kind: 'note', time: 1000, lane: 0, animation: motionPreset('brake', 2) } as const
const second = { id: '1', kind: 'hold', time: 1500, endTime: 2500, lane: 0, animation: motionPreset('reverse', 3) } as const
const unselected = { ...first, id: '2', lane: 1 }

function Inspector({ ids }: { ids: string[] }) {
  const [current, setCurrent] = useState<Chart>({ ...DEFAULT_CHART, notes: [first, second, unselected] })
  chart = current
  setChart = setCurrent
  return <NotePropertiesPanel key={ids.join(',')} notes={chart.notes.filter(note => ids.includes(note.id))} />
}

function typeNumber(label: string, value: string, scope: Pick<typeof screen, 'getByLabelText'> = screen) {
  const field = scope.getByLabelText<HTMLInputElement>(label)
  fireEvent.change(field, { target: { value } })
  return field
}

it('edits a mixed property once across different effects and follows the live selection', () => {
  const { rerender } = render(<Inspector ids={['0', '1']} />)
  const speed = screen.getByLabelText<HTMLInputElement>('Base scroll speed (×)')
  expect(speed.value).toBe('')
  expect(speed.placeholder).toBe('-')
  typeNumber('Base scroll speed (×)', '0.6')
  expect(chart.notes[0]).toEqual(first)
  fireEvent.blur(speed)
  expect(speed.value).toBe('0.6')
  expect(chart.notes).toEqual([
    { ...first, animation: { ...first.animation, speed: 0.6 } },
    { ...second, animation: { ...second.animation, speed: 0.6 } },
    unselected,
  ])
  rerender(<Inspector ids={['1']} />)
  fireEvent.click(screen.getByRole('radio', { name: 'Visual only' }))
  const scrollIntoView = Element.prototype.scrollIntoView
  Element.prototype.scrollIntoView = vi.fn()
  try {
    fireEvent.keyDown(screen.getByRole('combobox', { name: 'Replace with preset' }), { key: 'ArrowDown' })
    fireEvent.click(screen.getByRole('option', { name: 'Reveal' }))
  } finally {
    Element.prototype.scrollIntoView = scrollIntoView
  }
  expect(chart.notes[0].animation?.keys).toEqual(first.animation.keys)
  expect(chart.notes[1]).toEqual({ ...second, visualOnly: true, animation: motionPreset('reveal', 3) })
  expect(chart.notes[2]).toBe(unselected)
})

it('adds keyframes directly by track and resets selected notes only after confirmation', () => {
  render(<Inspector ids={['0', '1']} />)
  const hitOpacity = within(screen.getByRole('region', { name: 'Hit opacity (%)' }))
  fireEvent.click(hitOpacity.getByRole('button', { name: 'Add keyframe · Hit opacity (%)' }))
  expect(hitOpacity.getByLabelText<HTMLInputElement>('Since hit (ms) · 1').value).toBe('0')
  fireEvent.blur(typeNumber('Since hit (ms) · 1', '150'))
  expect(chart.notes.slice(0, 2).map(note => note.animation?.keys.hitOpacity)).toEqual([
    [{ at: 150, value: 100, curve: 'step' }], [{ at: 150, value: 100, curve: 'step' }],
  ])
  const reset = screen.getByRole('button', { name: 'Reset effects' })
  fireEvent.click(reset)
  let dialog = within(screen.getByRole('alertdialog', { name: 'Reset effects' }))
  expect(chart.notes[0].animation?.keys.hitOpacity).toHaveLength(1)
  fireEvent.click(dialog.getByRole('button', { name: 'Cancel' }))
  expect(chart.notes[0].animation?.keys.hitOpacity).toHaveLength(1)
  fireEvent.click(reset)
  dialog = within(screen.getByRole('alertdialog', { name: 'Reset effects' }))
  fireEvent.click(dialog.getByRole('button', { name: 'Reset effects' }))
  expect(chart.notes.map(note => note.animation)).toEqual([undefined, undefined, unselected.animation])
})

it('disables and enables a mixed selection without changing its note roles or keyframes', () => {
  const { rerender } = render(<Inspector ids={['1']} />)
  fireEvent.click(screen.getByRole('radio', { name: 'Visual only' }))
  fireEvent.click(screen.getByRole('radio', { name: 'Disabled' }))
  expect(chart.notes).toEqual([first, { ...second, visualOnly: true, disabled: true }, unselected])

  rerender(<Inspector ids={['0', '1']} />)
  const status = within(screen.getByRole('radiogroup', { name: 'Note status' }))
  expect(status.queryByRole('radio', { checked: true })).toBeNull()
  fireEvent.click(status.getByRole('radio', { name: 'Disabled' }))
  expect(chart.notes).toEqual([
    { ...first, disabled: true }, { ...second, visualOnly: true, disabled: true }, unselected,
  ])
  fireEvent.click(status.getByRole('radio', { name: 'Enabled' }))
  expect(chart.notes).toEqual([first, { ...second, visualOnly: true }, unselected])
})

it('edits a shared keyframe value without touching individual times and rejects duplicate times atomically', () => {
  render(<Inspector ids={['0', '1']} />)
  expect(screen.getByLabelText<HTMLInputElement>('Beat · 1').value).toBe('')
  expect(screen.getByLabelText<HTMLInputElement>('Value · 1').value).toBe('')
  fireEvent.blur(typeNumber('Beat · 1', '2'))
  expect(screen.getByRole('alert').textContent).toContain('unique times')
  expect(chart.notes).toEqual([first, second, unselected])

  const value = typeNumber('Value · 1', '0.25')
  fireEvent.blur(value)
  expect(value.value).toBe('0.25')
  expect(chart.notes.slice(0, 2).map(note => note.animation?.keys.speed?.[0])).toEqual([
    { ...first.animation.keys.speed![0], value: 0.25 },
    { ...second.animation.keys.speed![0], value: 0.25 },
  ])
  expect(chart.notes[2]).toBe(unselected)
})

it('edits a newly added shared keyframe when the selected notes have different frame counts', () => {
  const { rerender } = render(<Inspector ids={['1']} />)
  const hitOpacity = () => within(screen.getByRole('region', { name: 'Hit opacity (%)' }))
  fireEvent.click(screen.getByRole('button', { name: 'Add keyframe · Hit opacity (%)' }))
  fireEvent.blur(typeNumber('Value · 1', '35', hitOpacity()))
  rerender(<Inspector ids={['0', '1']} />)
  fireEvent.click(screen.getByRole('button', { name: 'Add keyframe · Hit opacity (%)' }))
  fireEvent.blur(typeNumber('Value · 1', '70', hitOpacity()))
  expect(chart.notes[0].animation?.keys.hitOpacity).toEqual([{ at: 100, value: 70, curve: 'step' }])
  expect(chart.notes[1].animation?.keys.hitOpacity).toEqual([
    { at: 0, value: 35, curve: 'step' }, { at: 100, value: 70, curve: 'step' },
  ])
  fireEvent.click(hitOpacity().getByRole('button', { name: 'Delete keyframe · 1' }))
  expect(chart.notes[0].animation?.keys.hitOpacity).toBeUndefined()
  expect(chart.notes[1].animation?.keys.hitOpacity).toEqual([{ at: 0, value: 35, curve: 'step' }])
})

function renderEditor(compact = false) {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
  const viewport = Object.assign(new EventTarget(), { matches: compact })
  vi.stubGlobal('matchMedia', (query: string) => query === '(max-width: 1024px)' ? viewport : { matches: false })
  function Editor() {
    const [current, setCurrent] = useState<Chart>({ ...DEFAULT_CHART, notes: [first, second] })
    chart = current
    setChart = setCurrent
    return <TooltipProvider><ChartEditorPage /></TooltipProvider>
  }
  return {
    ...render(<Editor />),
    resize(matches: boolean) {
      act(() => {
        viewport.matches = matches
        viewport.dispatchEvent(Object.assign(new Event('change'), { matches }))
      })
    },
  }
}

it('keeps the desktop inspector in the workspace and updates it on note selection', async () => {
  const { container } = renderEditor()
  const inspector = screen.getByRole('complementary', { name: 'Inspector' })
  expect(container.querySelector('.editor-workspace')?.contains(inspector)).toBe(true)
  expect(within(inspector).getByText('Select notes')).toBeTruthy()
  expect(screen.queryByRole('button', { name: 'Note properties' })).toBeNull()

  const [tap, hold] = container.querySelectorAll('.editor-note')
  const pointerDown = (note: Element) => {
    const event = new MouseEvent('pointerdown', { bubbles: true, cancelable: true, button: 0 })
    Object.assign(event, { pointerId: 1, pointerType: 'mouse' })
    fireEvent(note, event)
  }
  pointerDown(tap)
  const field = await within(inspector).findByLabelText<HTMLInputElement>('Base scroll speed (×)')
  expect(field.value).toBe(String(first.animation.speed))
  act(() => field.focus())
  fireEvent.change(field, { target: { value: '0.6' } })
  pointerDown(hold)
  expect(chart.notes.map(note => note.animation?.speed)).toEqual([0.6, second.animation.speed])
  expect(within(inspector).getByText('2 selected')).toBeTruthy()
  expect(screen.getByRole('complementary', { name: 'Inspector' })).toBe(inspector)
  fireEvent.click(screen.getByRole('button', { name: 'NOTE' }))
  expect(within(inspector).getByText('Select notes')).toBeTruthy()
})

it('moves the current selection between the drawer and inspector when the viewport crosses the breakpoint', async () => {
  const { resize } = renderEditor(true)
  const trigger = screen.getByRole<HTMLButtonElement>('button', { name: 'Note properties' })
  expect(trigger.disabled).toBe(true)
  fireEvent.keyDown(document.body, { key: 'a', ctrlKey: true })
  fireEvent.click(trigger)
  expect(screen.getByRole('dialog', { name: 'Note properties' }).dataset.side).toBe('bottom')
  resize(false)
  const inspector = screen.getByRole('complementary', { name: 'Inspector' })
  expect(within(inspector).getByText('2 selected')).toBeTruthy()
  expect(await within(inspector).findByLabelText('Base scroll speed (×)')).toBeTruthy()
  expect(screen.queryByRole('dialog', { name: 'Note properties' })).toBeNull()
  resize(true)
  expect(screen.queryByRole('complementary', { name: 'Inspector' })).toBeNull()
  expect(screen.queryByRole('dialog', { name: 'Note properties' })).toBeNull()
  expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Note properties' }).disabled).toBe(false)
})

it('opens the mobile bottom drawer outside the workspace and returns focus on close', async () => {
  const { container } = renderEditor(true)
  fireEvent.keyDown(document.body, { key: 'a', ctrlKey: true })
  const trigger = screen.getByRole('button', { name: 'Note properties' })
  fireEvent.click(trigger)
  const sheet = screen.getByRole('dialog', { name: 'Note properties' })
  expect(sheet.dataset.side).toBe('bottom')
  expect(document.body.querySelector('.note-properties-overlay')).not.toBeNull()
  expect(container.contains(sheet)).toBe(false)

  const field = await within(sheet).findByLabelText<HTMLInputElement>('Base scroll speed (×)')
  historyActions.undo.mockClear()
  historyActions.redo.mockClear()
  act(() => field.focus())
  fireEvent.keyDown(field, { key: 'z', ctrlKey: true })
  expect(historyActions.undo).toHaveBeenCalledOnce()
  fireEvent.keyDown(field, { key: 'z', metaKey: true, shiftKey: true })
  expect(historyActions.redo).toHaveBeenCalledOnce()
  fireEvent.change(field, { target: { value: '0.6' } })
  fireEvent.keyDown(field, { key: 'z', ctrlKey: true })
  expect(historyActions.undo).toHaveBeenCalledOnce()
  fireEvent.keyDown(field, { key: 'Escape' })
  expect(field.value).toBe('')
  expect(chart.notes).toEqual([first, second])
  fireEvent.change(field, { target: { value: '0.75' } })
  fireEvent.click(within(sheet).getByRole('button', { name: 'Close note properties' }))
  expect(chart.notes.map(note => note.animation?.speed)).toEqual([0.75, 0.75])
  await waitFor(() => expect(document.activeElement).toBe(trigger))

  fireEvent.click(trigger)
  const reopened = screen.getByRole('dialog', { name: 'Note properties' })
  fireEvent.click(within(reopened).getByRole('button', { name: 'Reset effects' }))
  const confirm = screen.getByRole('alertdialog', { name: 'Reset effects' })
  fireEvent.keyDown(confirm, { key: 'z', ctrlKey: true })
  expect(historyActions.undo).toHaveBeenCalledOnce()
  fireEvent.click(within(confirm).getByRole('button', { name: 'Reset effects' }))
  await waitFor(() => expect(document.activeElement).toBe(reopened))
  fireEvent.keyDown(reopened, { key: 'z', ctrlKey: true })
  expect(historyActions.undo).toHaveBeenCalledTimes(2)
})
