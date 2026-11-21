// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ChartEditor } from '@/features/chart/ChartEditor'
import { normalizeChart, type ChartNote, type ToolMode } from '@/features/chart/types'

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
const onHoldStart = vi.fn()
async function render(redMode: boolean, tool: ToolMode = 'note', chartNotes: ChartNote[] = notes, holdStart: { lane: number; time: number } | null = null, selectedIds = new Set<string>()) {
  await act(async () => root.render(<ChartEditor chart={normalizeChart({ bpm: 120, notes: chartNotes })} currentTime={1000} subdivision={4} tool={tool} redMode={redMode}
    holdStart={holdStart} selectedIds={selectedIds} region={null} isPlaying={false}
    onSeek={vi.fn()} onNotesChange={onNotesChange} onHoldStart={onHoldStart} onSelectionChange={onSelectionChange}
    onRegionLine={onRegionLine} onRegionMove={onRegionMove} onTempoLine={vi.fn()} onEffectLine={vi.fn()} onEffectEdit={vi.fn()}
    onZoomChange={vi.fn()} onSubdivisionChange={vi.fn()} />))
  vi.spyOn(element.querySelector('.lanes')!, 'getBoundingClientRect').mockReturnValue({ width: 400 } as DOMRect)
  vi.spyOn(element.querySelector('.lane-editor')!, 'getBoundingClientRect').mockReturnValue({ top: 0, width: 500 } as DOMRect)
}
async function pointer(target: EventTarget, type: string, x = 50, y = 500) {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX: x, clientY: y })
  Object.assign(event, { pointerId: 1, pointerType: 'mouse' })
  await act(async () => { target.dispatchEvent(event) })
}

it.each([false, true])('places a note over the opposite mode without selecting it (red=%s)', async (redMode) => {
  const existing = { ...notes[0], ...(redMode ? {} : { red: true }) }
  await render(redMode, 'note', [existing])
  await pointer(element.querySelector('.edit-lane')!, 'pointerdown')
  expect(onNotesChange).toHaveBeenCalledExactlyOnceWith([existing, expect.objectContaining({ time: 1000, lane: 0, kind: 'note', ...(redMode ? { red: true } : {}) })])
  expect(Boolean(onNotesChange.mock.calls[0][0][1].red)).toBe(redMode)
  expect(onSelectionChange).not.toHaveBeenCalled()
  expect(element.querySelector('.editor-note')!.classList.contains('inactive-mode')).toBe(true)
})

it.each([false, true])('places holds over the opposite mode and previews the active mode (red=%s)', async (redMode) => {
  const existing: ChartNote = { ...notes[0], kind: 'hold', endTime: 2000, ...(redMode ? {} : { red: true }) }
  await render(redMode, 'hold', [existing])
  await pointer(element.querySelector('.edit-lane')!, 'pointerdown')
  expect(onHoldStart).toHaveBeenCalledWith({ lane: 0, time: 1000 })
  await render(redMode, 'hold', [existing], { lane: 0, time: 1000 })
  expect(element.querySelector('.hold-pending')).toBeTruthy()
  await pointer(element.querySelector('.edit-lane')!, 'pointerdown', 50, 270)
  expect(onNotesChange).toHaveBeenCalledExactlyOnceWith([existing, expect.objectContaining({ kind: 'hold', time: 1000, endTime: 2000 })])
  expect(Boolean(onNotesChange.mock.calls[0][0][1].red)).toBe(redMode)
})

it.each(['note', 'delete', 'region'] as const)('never selects, drags or deletes opposite mode notes in %s tool', async (tool) => {
  await render(true, tool, notes, null, new Set(notes.map((note) => note.id)))
  const inactive = element.querySelector('.editor-note')!
  await pointer(inactive, 'pointerdown')
  await pointer(window, 'pointermove', 150, 385)
  await pointer(window, 'pointerup', 150, 385)
  expect(onSelectionChange).not.toHaveBeenCalled()
  expect(onNotesChange).not.toHaveBeenCalled()
})

it('selects and deletes the correct note in an exact same-time overlap', async () => {
  const both = [notes[0], { ...notes[0], id: 'red', red: true }]
  await render(true, 'note', both)
  await pointer(element.querySelector('.edit-lane')!, 'pointerdown')
  expect(onSelectionChange).toHaveBeenCalledExactlyOnceWith(new Set(['red']))
  await render(true, 'delete', both)
  await pointer(element.querySelector('.red-zone')!, 'pointerdown')
  expect(onNotesChange).toHaveBeenCalledExactlyOnceWith([notes[0]])
})

it('moves only the active mode even if a stale selection contains both modes', async () => {
  const both = [notes[0], { ...notes[0], id: 'red', red: true }]
  await render(true, 'note', both, null, new Set(['a', 'red']))
  await pointer(element.querySelector('.red-zone')!, 'pointerdown')
  await pointer(window, 'pointermove', 150, 385)
  await pointer(window, 'pointerup', 150, 385)
  expect(onNotesChange).toHaveBeenCalledExactlyOnceWith([notes[0], { ...both[1], lane: 1, time: 1500, endTime: undefined }])
})
