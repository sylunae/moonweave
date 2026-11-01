// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ChartEditor } from '@/features/chart/ChartEditor'
import { normalizeChart } from '@/features/chart/types'

vi.mock('@/app/preferences', () => ({ usePreferences: () => ({ preferences: { judgmentLineHeight: 200 } }) }))
vi.mock('@/app/i18n', () => ({ useI18n: () => ({ text: (_zh: string, en: string) => en }) }))

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
