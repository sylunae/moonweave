// @vitest-environment jsdom
import { act, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { fireEvent, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import { ChartEditor } from '@/features/chart/ChartEditor'
import { scrollPositionAtTime } from '@/features/chart/tempoMap'
import { normalizeChart, type Chart } from '@/features/chart/types'
import ChartEditorPage from '@/pages/ChartEditorPage'

vi.mock('@/app/preferences', () => ({ usePreferences: () => ({ preferences: { judgmentLineHeight: 200, playbackRate: 1 } }) }))
vi.mock('@/app/i18n', () => ({ useI18n: () => ({ text: (_zh: string, en: string) => en }) }))
let useEditorChart: () => { chart: Chart; currentTime: number; activeChartId: string; commitEdit: (edit: (chart: Chart) => Chart) => void }
vi.mock('@/features/chart/ChartProvider', () => ({ useChart: () => useEditorChart() }))

const notes = [
  { id: 'a', lane: 0, time: 1000, kind: 'note' as const },
  { id: 'b', lane: 2, time: 1500, endTime: 2000, kind: 'hold' as const },
  { id: 'c', lane: 3, time: 3000, kind: 'note' as const },
]
let element: HTMLDivElement
let root: ReturnType<typeof createRoot>
const onRegionLine = vi.fn()
const onRegionMove = vi.fn()
const onNotesChange = vi.fn()
const onSelectionChange = vi.fn()

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
  element = document.createElement('div')
  document.body.appendChild(element)
  root = createRoot(element)
  vi.clearAllMocks()
})
afterEach(async () => {
  await act(async () => root.unmount())
  element.remove()
  vi.unstubAllGlobals()
})
async function render(region: { start: number; end: number | null } | null = { start: 500, end: 2000 }) {
  await act(async () => root.render(<ChartEditor chart={normalizeChart({ bpm: 120, notes })} currentTime={1000} subdivision={4} tool="region"
    holdStart={null} selectedIds={new Set(region?.end != null ? ['a', 'b'] : [])} region={region} isPlaying={false}
    onSeek={vi.fn()} onNotesChange={onNotesChange} onHoldStart={vi.fn()} onSelectionChange={onSelectionChange}
    onRegionLine={onRegionLine} onRegionMove={onRegionMove} onTempoLine={vi.fn()} onEffectLine={vi.fn()} onEffectEdit={vi.fn()}
    onZoomChange={vi.fn()} onSubdivisionChange={vi.fn()} />))
  vi.spyOn(element.querySelector('.lanes')!, 'getBoundingClientRect').mockReturnValue({ width: 400 } as DOMRect)
}
async function pointer(target: EventTarget, type: string, x = 50, y = 500) {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX: x, clientY: y })
  Object.assign(event, { pointerId: 1, pointerType: 'mouse' })
  await act(async () => { target.dispatchEvent(event) })
}

it.each([true, false])('pastes region speed effects with notes present: %s', async (withNotes) => {
  const original = normalizeChart({ bpm: 120, duration: 4000, notes: withNotes ? [{ ...notes[0], time: 625 }] : [], effects: [
    { id: 'instant', type: 'scrollSpeed', time: 500, multiplier: 2, transition: 'instant' },
    { id: 'ramp', type: 'scrollSpeed', time: 750, endTime: 1000, multiplier: 1, transition: 'linear', curve: 'custom', bezier: [0.2, 0.3, 0.8, 0.9] },
    { id: 'partial', type: 'scrollSpeed', time: 1125, endTime: 1500, multiplier: 2, transition: 'linear' },
  ] })
  let chart = original
  let setTime!: (time: number) => void
  function Editor() {
    const [current, setCurrent] = useState(original)
    const [currentTime, setCurrentTime] = useState(1000)
    chart = current
    setTime = setCurrentTime
    useEditorChart = () => ({ chart: current, currentTime, activeChartId: 'chart', commitEdit: setCurrent })
    return <TooltipProvider><ChartEditorPage /></TooltipProvider>
  }
  await act(async () => root.render(<Editor />))
  const page = within(element)
  fireEvent.click(page.getByRole('button', { name: 'Region' }))
  const lane = element.querySelector('.edit-lane')!
  for (const time of [500, 1125]) {
    const y = 500 - (scrollPositionAtTime(original, time) - scrollPositionAtTime(original, 1000)) / 1000 * original.settings.editorZoom
    fireEvent.click(lane, { clientY: y })
  }

  const copy = page.getByRole<HTMLButtonElement>('button', { name: 'Copy selection' })
  expect(copy.disabled).toBe(false)
  if (withNotes) fireEvent.keyDown(document.body, { key: 'c', ctrlKey: true })
  else fireEvent.click(copy)
  await act(async () => setTime(3750))
  const paste = page.getByRole<HTMLButtonElement>('button', { name: 'Paste at the current judgment line' })
  expect(paste.disabled).toBe(false)
  fireEvent.click(paste)
  expect(chart).toBe(original)
  expect(page.getByRole('status').textContent).toContain('outside the chart duration')

  await act(async () => setTime(3000))
  await act(async () => { fireEvent.keyDown(document.body, { key: 'v', ctrlKey: true }) })
  expect(page.getByRole('status').textContent).toContain('Region contents pasted')
  expect(chart.effects).toEqual([...original.effects,
    { ...original.effects[0], id: expect.any(String), time: 3000 },
    { ...original.effects[1], id: expect.any(String), time: 3250, endTime: 3500 },
  ])
  expect(new Set(chart.effects.map(effect => effect.id)).size).toBe(5)
  expect(chart.notes.map(note => note.time)).toEqual(withNotes ? [625, 3125] : [])

  const pasted = chart
  fireEvent.click(paste)
  expect(chart).toBe(pasted)
})

it.each(['.edit-lane', '.editor-note'])('selects a region on click, never on pointerdown (%s)', async (selector) => {
  await render(null)
  const target = element.querySelector(selector)!
  await pointer(target, 'pointerdown')
  expect(onRegionLine).not.toHaveBeenCalled()
  await pointer(window, 'pointerup')
  await pointer(target, 'click')
  expect(onRegionLine).toHaveBeenCalledTimes(1)
  expect(onNotesChange).not.toHaveBeenCalled()
})

it.each(['.edit-lane', '.editor-note'])('moves the entire selection and suppresses the click after dragging (%s)', async (selector) => {
  await render()
  const target = element.querySelector(selector)!
  await pointer(target, 'pointerdown')
  await pointer(window, 'pointermove', 150, 385)
  expect(onNotesChange).not.toHaveBeenCalled()
  await pointer(window, 'pointerup', 150, 385)
  await pointer(target, 'click', 150, 385)
  expect(onNotesChange).toHaveBeenCalledExactlyOnceWith([
    { ...notes[0], lane: 1, time: 1500 },
    { ...notes[1], lane: 3, time: 2000, endTime: 2500 },
    notes[2],
  ])
  expect(onRegionMove).toHaveBeenCalledExactlyOnceWith(500)
  expect(onRegionLine).not.toHaveBeenCalled()
  expect(onSelectionChange).not.toHaveBeenCalled()
  await pointer(target, 'pointerdown')
  await pointer(window, 'pointerup')
  await pointer(target, 'click')
  expect(onRegionLine).toHaveBeenCalledTimes(1)
})

it('cancels dragging without changing notes or selection', async () => {
  await render()
  const target = element.querySelector('.editor-note')!
  await pointer(target, 'pointerdown')
  await pointer(window, 'pointermove', 150, 385)
  await pointer(window, 'pointercancel')
  expect(onNotesChange).not.toHaveBeenCalled()
  expect(onRegionMove).not.toHaveBeenCalled()
  expect(onRegionLine).not.toHaveBeenCalled()
  expect(onSelectionChange).not.toHaveBeenCalled()
  expect(element.querySelectorAll('.editor-note.selected')).toHaveLength(2)
})
