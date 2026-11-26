// @vitest-environment jsdom
import { act, createRef } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import { ChartEditor, type ChartEditorHandle } from '@/features/chart/ChartEditor'
import { normalizeChart } from '@/features/chart/types'

vi.mock('@/app/preferences', () => ({ usePreferences: () => ({ preferences: { judgmentLineHeight: 200 } }) }))
vi.mock('@/app/i18n', () => ({ useI18n: () => ({ text: (_zh: string, en: string) => en }) }))

it('flushes wheel preview before transport changes and never commits the old timer afterward', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  vi.useFakeTimers()
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
  vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1))
  vi.stubGlobal('cancelAnimationFrame', vi.fn())
  const ref = createRef<ChartEditorHandle>()
  const onSeek = vi.fn()
  const element = document.createElement('div'); document.body.appendChild(element)
  const root = createRoot(element)
  const props = { ref, chart: normalizeChart({ bpm: 120 }), subdivision: 4, tool: 'note' as const,
    holdStart: null, selectedIds: new Set<string>(), region: null, onSeek,
    onNotesChange: vi.fn(), onHoldStart: vi.fn(), onSelectionChange: vi.fn(), onRegionLine: vi.fn(),
    onTempoLine: vi.fn(), onEffectLine: vi.fn(), onEffectEdit: vi.fn(), onZoomChange: vi.fn(), onSubdivisionChange: vi.fn() }
  try {
    await act(async () => root.render(<ChartEditor {...props} currentTime={1000} isPlaying={false} />))
    const lane = element.querySelector('.lane-editor')!
    await act(async () => lane.dispatchEvent(new WheelEvent('wheel', { deltaY: -1, cancelable: true })))
    expect(onSeek).not.toHaveBeenCalled()
    let target: number | null = null
    await act(async () => { target = ref.current!.flushSeek() })
    expect(target).toBe(1125)
    expect(onSeek).toHaveBeenCalledExactlyOnceWith(1125)
    await act(async () => root.render(<ChartEditor {...props} currentTime={2000} isPlaying />))
    await act(async () => vi.advanceTimersByTime(100))
    expect(onSeek).toHaveBeenCalledTimes(1)
    expect(ref.current!.flushSeek()).toBeNull()
  } finally {
    await act(async () => root.unmount())
    element.remove(); vi.useRealTimers(); vi.unstubAllGlobals()
  }
})

it('pans a touched lane with one seek on release and places notes only on a tap', async () => {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
  const onSeek = vi.fn()
  const onNotesChange = vi.fn()
  const chart = normalizeChart({ bpm: 120, duration: 10_000 })
  const element = document.createElement('div')
  document.body.appendChild(element)
  const root = createRoot(element)
  const pointer = (target: EventTarget, type: string, clientY: number, pointerId = 1) =>
    target.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerType: 'touch', isPrimary: pointerId === 1, pointerId, clientY }))

  try {
    await act(async () => root.render(<ChartEditor chart={chart} currentTime={1000} subdivision={4} tool="note" holdStart={null}
      selectedIds={new Set()} region={null} isPlaying={false} onSeek={onSeek} onNotesChange={onNotesChange}
      onHoldStart={vi.fn()} onSelectionChange={vi.fn()} onRegionLine={vi.fn()} onTempoLine={vi.fn()}
      onEffectLine={vi.fn()} onEffectEdit={vi.fn()} onZoomChange={vi.fn()} onSubdivisionChange={vi.fn()} />))
    const lane = element.querySelector('.edit-lane')!
    await act(async () => {
      pointer(lane, 'pointerdown', 300)
      pointer(lane, 'pointerdown', 310, 2)
      pointer(window, 'pointermove', 300 + chart.settings.editorZoom)
    })
    expect(onSeek).not.toHaveBeenCalled()
    expect(onNotesChange).not.toHaveBeenCalled()
    await act(async () => { pointer(window, 'pointerup', 300 + chart.settings.editorZoom) })
    expect(onSeek).toHaveBeenCalledExactlyOnceWith(2000)
    expect(onNotesChange).not.toHaveBeenCalled()

    await act(async () => {
      pointer(lane, 'pointerdown', 300)
      pointer(window, 'pointermove', 250)
      pointer(window, 'pointercancel', 250)
    })
    expect(onSeek).toHaveBeenCalledTimes(1)
    expect(onNotesChange).not.toHaveBeenCalled()

    await act(async () => { pointer(lane, 'pointerdown', 300) })
    expect(onNotesChange).not.toHaveBeenCalled()
    await act(async () => { pointer(window, 'pointerup', 304) })
    expect(onNotesChange).toHaveBeenCalledExactlyOnceWith([expect.objectContaining({ lane: 0, kind: 'note' })])
  } finally {
    await act(async () => root.unmount())
    element.remove()
    vi.unstubAllGlobals()
  }
})
