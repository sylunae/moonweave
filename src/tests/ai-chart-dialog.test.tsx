// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import AiChartDialog from '@/features/chart/ai/AiChartDialog'
import { normalizeChart, type Chart } from '@/features/chart/types'
import type { AiPlan } from '@/features/chart/ai/aiChart'

let chart: Chart
const applyAiImport = vi.fn(async (_plan: AiPlan) => true)
const showToast = vi.fn()
vi.mock('@/features/chart/ChartProvider', () => ({ useChart: () => ({ chart, activeChartId: 'chart-a', currentTime: 1500, isPlaying: false, applyAiImport, showToast }) }))
vi.mock('@/app/i18n', () => ({ useI18n: () => ({ text: (_zh: string, en: string) => en }) }))
let root: Root
let element: HTMLDivElement
const onClose = vi.fn(), onApplied = vi.fn()
const render = () => root.render(<AiChartDialog subdivision={4} initialRange={{ start: 1000, end: 2000 }} onClose={onClose} onApplied={onApplied} />)
const button = (label: string) => [...document.querySelectorAll('button')].find((node) => node.textContent === label)!
const input = () => ({ format: 'moonweave-ai-chart', version: 1, requestId: 'batch-1', mode: 'replace', unit: 'ms',
  song: { audioName: 'song.wav', duration: 10000, bpm: 120, offset: 0, bpmChanges: [] }, notes: [{ id: 'a', lane: 0, kind: 'note', time: 1000 }] })
async function paste(value: unknown) {
  const textarea = document.querySelector('textarea')!
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(textarea, JSON.stringify(value))
    textarea.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  vi.clearAllMocks(); applyAiImport.mockResolvedValue(true)
  chart = normalizeChart({ audioName: 'song.wav', duration: 10000 })
  element = document.createElement('div'); document.body.appendChild(element); root = createRoot(element)
  await act(async () => render())
})
afterEach(async () => { await act(async () => root.unmount()); element.remove() })

it('previews without writing and only applies after an explicit click', async () => {
  await paste(input())
  expect(button('Apply batch').disabled).toBe(true)
  await act(async () => button('Validate and preview').click())
  expect(document.body.textContent).toContain('Validation passed')
  expect(applyAiImport).not.toHaveBeenCalled()
  expect(button('Apply batch').disabled).toBe(false)
  await act(async () => button('Apply batch').click())
  expect(applyAiImport).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ chartId: 'chart-a', mode: 'replace' }))
  expect(onApplied).toHaveBeenCalledOnce()
  expect(onClose).toHaveBeenCalledOnce()
})

it('blocks a preview after human editing and clears it when JSON changes', async () => {
  await paste(input())
  await act(async () => button('Validate and preview').click())
  chart = { ...chart, notes: [{ id: 'human', kind: 'note', lane: 3, time: 2000 }] }
  await act(async () => render())
  expect(button('Apply batch').disabled).toBe(true)
  expect(document.body.textContent).toContain('The chart changed')
  await paste({ ...input(), requestId: 'batch-2' })
  expect(document.querySelector('[role="status"]')).toBeNull()
  expect(applyAiImport).not.toHaveBeenCalled()
})

it('reports validation errors without losing the JSON or applying any changes', async () => {
  const invalid = { ...input(), notes: [{ id: 'bad', kind: 'hold', lane: 0, time: 2000, endTime: 1000 }] }
  await paste(invalid)
  await act(async () => button('Validate and preview').click())
  expect(document.querySelector('[role="alert"]')?.textContent).toContain('A hold needs an end after its start')
  expect(document.querySelector('textarea')!.value).toBe(JSON.stringify(invalid))
  expect(button('Apply batch').disabled).toBe(true)
  expect(applyAiImport).not.toHaveBeenCalled()
})

it('shows applied-but-unsaved state without closing or reapplying the batch', async () => {
  applyAiImport.mockResolvedValue(false)
  await paste(input())
  await act(async () => button('Validate and preview').click())
  await act(async () => button('Apply batch').click())
  expect(document.querySelector('[role="alert"]')?.textContent).toContain('Batch applied, but saving failed')
  expect(onApplied).toHaveBeenCalledOnce()
  expect(onClose).not.toHaveBeenCalled()
  expect(button('Apply batch').disabled).toBe(true)
})

it('defaults to reusing an old bound chart on different audio without exporting context', async () => {
  chart = { ...chart, audioName: 'midi-render.wav', duration: 12000 }
  await act(async () => render())
  await paste({ ...input(), target: { chartId: 'original-chart', revision: 'old' } })
  expect(document.querySelector('[role="checkbox"]')?.getAttribute('aria-checked')).toBe('true')
  await act(async () => button('Validate and preview').click())
  expect(button('Apply batch').disabled).toBe(false)
  await act(async () => button('Apply batch').click())
  expect(applyAiImport.mock.calls[0]?.[0]).toMatchObject({ next: { audioName: 'midi-render.wav', duration: 12000, notes: input().notes } })
})

it('clears the reuse preview when switching back to context-bound import', async () => {
  await paste({ ...input(), target: { chartId: 'original-chart', revision: 'old' } })
  await act(async () => button('Validate and preview').click())
  expect(button('Apply batch').disabled).toBe(false)
  await act(async () => (document.querySelector('[role="checkbox"]') as HTMLButtonElement).click())
  expect(button('Apply batch').disabled).toBe(true)
  await act(async () => button('Validate and preview').click())
  expect(document.querySelector('[role="alert"]')?.textContent).toContain('Wrong target chart')
})
