import { EffectMarkers } from './effects/EffectMarkers'
import type { ChartEffect } from './effects/scrollSpeed'
import { useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { createEditorNoteIndex, visibleEditorNotes } from './editorTimeline'
import { adjacentBeatLine, beatAtTime, beatLinesInRange, bpmAtTime, scrollPositionAtTime, snapToBeatLine, timeAtScrollPosition } from './tempoMap'
import { usePreferences } from '@/app/preferences'
import { useI18n } from '@/app/i18n'
import { GameButton } from '@/components/ui/game-controls'
import { EDITOR_LANE_WIDTH, type Chart, type ChartNote, type ToolMode } from './types'

const LANE_COLORS = ['var(--editor-note-blue)', 'var(--editor-note-purple)', 'var(--editor-note-purple)', 'var(--editor-note-blue)']
const TOUCH_DRAG_THRESHOLD = 8
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))
const uid = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`

export interface ChartEditorHandle {
  flushSeek(): number | null
}

interface EditorProps {
  ref?: React.Ref<ChartEditorHandle>
  chart: Chart
  laneWidthPercent?: number
  currentTime: number
  subdivision: number
  tool: ToolMode
  redMode?: boolean
  holdStart: { lane: number; time: number } | null
  selectedIds: Set<string>
  region: { start: number; end: number | null } | null
  isPlaying: boolean
  onSeek(time: number): void
  onNotesChange(notes: ChartNote[]): void
  onHoldStart(value: { lane: number; time: number } | null): void
  onSelectionChange(ids: Set<string>): void
  onRegionLine(time: number): void
  onRegionMove?(delta: number): void
  onTempoLine(time: number): void
  onEffectLine(time: number): void
  onEffectEdit(effect: ChartEffect): void
  onZoomChange(value: number): void
  onSubdivisionChange(direction: -1 | 1): void
}

const formatOverviewTime = (milliseconds: number) => {
  const seconds = Math.max(0, milliseconds) / 1000
  return `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${Math.floor(seconds % 60).toString().padStart(2, '0')}`
}

export function ChartEditor({ ref, chart, laneWidthPercent = chart.settings.editorLaneWidthPercent ?? EDITOR_LANE_WIDTH.default, currentTime, subdivision, tool, redMode = false, holdStart, selectedIds, region, isPlaying, onSeek, onNotesChange, onHoldStart, onSelectionChange, onRegionLine, onRegionMove, onTempoLine, onEffectLine, onEffectEdit, onZoomChange, onSubdivisionChange }: EditorProps) {
  const { preferences } = usePreferences()
  const { text } = useI18n()
  const laneRef = useRef<HTMLDivElement>(null)
  const [laneHeight, setLaneHeight] = useState(700)
  const [viewportTime, setViewportTime] = useState(currentTime)
  const [dragPreview, setDragPreview] = useState<Record<string, { lane: number; time: number; endTime?: number }>>({})
  const dragPreviewRef = useRef<Record<string, { lane: number; time: number; endTime?: number }>>({})
  const viewportTimeRef = useRef(currentTime)
  const currentTimeRef = useRef(currentTime)
  const previewingSeekRef = useRef(false)
  const seekCommitTimerRef = useRef(0)
  const seekFrameRef = useRef(0)
  const pendingViewportTimeRef = useRef(currentTime)
  const pointerCleanupRef = useRef<() => void>(() => undefined)
  const suppressRegionClickRef = useRef(false)
  const pps = chart.settings.editorZoom
  const minJudgmentY = Math.min(120, laneHeight * .6)
  const judgmentY = clamp(laneHeight - preferences.judgmentLineHeight, minJudgmentY, Math.max(minJudgmentY, laneHeight - 80))
  const timelineTime = previewingSeekRef.current ? viewportTime : currentTime
  const timelinePosition = scrollPositionAtTime(chart, timelineTime)
  currentTimeRef.current = currentTime
  if (!previewingSeekRef.current) {
    viewportTimeRef.current = currentTime
    pendingViewportTimeRef.current = currentTime
  }
  const noteIndex = useMemo(() => createEditorNoteIndex(chart.notes), [chart.notes])
  const visibleRange = useMemo(() => ({
    from: timeAtScrollPosition(chart, timelinePosition - ((laneHeight - judgmentY + 160) / pps * 1000)),
    to: timeAtScrollPosition(chart, timelinePosition + ((judgmentY + 160) / pps * 1000)),
  }), [chart, judgmentY, laneHeight, pps, timelinePosition])
  const visibleNotes = useMemo(
    () => visibleEditorNotes(noteIndex, visibleRange.from, visibleRange.to),
    [noteIndex, visibleRange],
  )
  const lines = useMemo(() => {
    const from = timeAtScrollPosition(chart, timelinePosition - ((laneHeight - judgmentY + 120) / pps * 1000))
    const to = timeAtScrollPosition(chart, timelinePosition + ((judgmentY + 120) / pps * 1000))
    return beatLinesInRange(chart, from, to, subdivision)
  }, [timelinePosition, chart, subdivision, laneHeight, judgmentY, pps])

  const yAt = (time: number) => judgmentY - (scrollPositionAtTime(chart, time) - timelinePosition) / 1000 * pps
  const pointerTime = (clientY: number) => {
    const rect = laneRef.current!.getBoundingClientRect()
    const viewportPosition = scrollPositionAtTime(chart, viewportTimeRef.current)
    const raw = timeAtScrollPosition(chart, viewportPosition + (judgmentY - (clientY - rect.top)) / pps * 1000)
    return snapToBeatLine(chart, raw, subdivision)
  }
  const placeAtLane = (clientY: number, lane: number) => {
    const time = pointerTime(clientY)
    if (tool === 'tempo') { onTempoLine(time); return }
    if (tool === 'effect') { onEffectLine(time); return }
    if (tool === 'delete') return
    const beatIndex = Math.round(beatAtTime(chart, time) * subdivision)
    const noteOnBeat = chart.notes.find((note) => Boolean(note.red) === redMode && note.lane === lane && Math.round(beatAtTime(chart, note.time) * subdivision) === beatIndex)
    if (noteOnBeat) {
      const next = new Set(selectedIds)
      if (next.has(noteOnBeat.id)) next.delete(noteOnBeat.id); else next.add(noteOnBeat.id)
      onSelectionChange(next); return
    }
    if (selectedIds.size) { onSelectionChange(new Set()); return }
    if (tool === 'note') onNotesChange([...chart.notes, { id: uid(), lane, time, kind: 'note', ...(redMode ? { red: true } : {}) }])
    else if (!holdStart) onHoldStart({ lane, time })
    else {
      const start = Math.min(holdStart.time, time)
      const end = Math.max(holdStart.time, time)
      if (Math.abs(beatAtTime(chart, end) - beatAtTime(chart, start)) >= 0.5 / subdivision) onNotesChange([...chart.notes, { id: uid(), lane: holdStart.lane, time: start, endTime: end, kind: 'hold', ...(redMode ? { red: true } : {}) }])
      onHoldStart(null)
    }
  }
  const regionClick = (event: React.MouseEvent) => {
    if (tool !== 'region') return
    event.stopPropagation()
    if (!suppressRegionClickRef.current) onRegionLine(pointerTime(event.clientY))
    suppressRegionClickRef.current = false
  }
  const notePointerDown = (event: React.PointerEvent, id?: string) => {
    if (event.button !== 0 || (event.pointerType === 'touch' && event.isPrimary === false)) return
    if (id && Boolean(chart.notes.find((note) => note.id === id)?.red) !== redMode) return
    event.stopPropagation(); event.preventDefault()
    pointerCleanupRef.current()
    suppressRegionClickRef.current = false
    const regionMode = tool === 'region'
    const wasSelected = id !== undefined && selectedIds.has(id)
    const time = pointerTime(event.clientY)
    const canDragRegion = region?.end != null && (wasSelected || (id === undefined && time >= region.start && time <= region.end))
    const applyTool = (clientY: number) => {
      if (tool === 'tempo') onTempoLine(pointerTime(clientY))
      else if (tool === 'effect') onEffectLine(pointerTime(clientY))
      else if (tool === 'delete') onNotesChange(chart.notes.filter((note) => note.id !== id))
      else if (regionMode) onRegionLine(pointerTime(clientY))
      else if (id) onSelectionChange(new Set(selectedIds).add(id))
    }
    if (event.pointerType === 'touch' && !(regionMode ? canDragRegion && selectedIds.size > 0 : wasSelected && (tool === 'note' || tool === 'hold'))) {
      startTouchPan(event, applyTool)
      return
    }
    if (tool === 'tempo' || tool === 'effect' || tool === 'delete') { applyTool(event.clientY); return }
    if (!regionMode && !id) return
    const nextSelection = new Set(selectedIds)
    if (!regionMode && !wasSelected) { nextSelection.add(id!); onSelectionChange(nextSelection) }
    const startX = event.clientX
    const startY = event.clientY
    const pointerId = event.pointerId
    const dragThreshold = event.pointerType === 'touch' ? TOUCH_DRAG_THRESHOLD : 3
    const rect = laneRef.current!.querySelector('.lanes')!.getBoundingClientRect()
    const canDrag = !regionMode || canDragRegion
    const selectedNotes = canDrag ? chart.notes.filter((note) => nextSelection.has(note.id) && Boolean(note.red) === redMode) : []
    const earliest = Math.min(...selectedNotes.map((note) => note.time))
    const latest = Math.max(...selectedNotes.map((note) => note.endTime ?? note.time))
    let didDrag = false
    const move = (moveEvent: globalThis.PointerEvent) => {
      if (moveEvent.pointerId !== pointerId) return
      if (!didDrag && Math.hypot(moveEvent.clientX - startX, moveEvent.clientY - startY) < dragThreshold) return
      didDrag = true
      if (regionMode) suppressRegionClickRef.current = true
      if (!selectedNotes.length) return
      const laneDelta = clamp(Math.round((moveEvent.clientX - startX) / (rect.width / 4)), -Math.min(...selectedNotes.map((note) => note.lane)), 3 - Math.max(...selectedNotes.map((note) => note.lane)))
      const requestedPosition = scrollPositionAtTime(chart, earliest) - (moveEvent.clientY - startY) / pps * 1000
      const requestedTimeDelta = snapToBeatLine(chart, timeAtScrollPosition(chart, requestedPosition), subdivision) - earliest
      const timeDelta = clamp(requestedTimeDelta, -Math.min(earliest, regionMode ? region!.start : earliest), chart.duration - Math.max(latest, regionMode ? region!.end! : latest))
      const preview: Record<string, { lane: number; time: number; endTime?: number }> = {}
      selectedNotes.forEach((note) => { preview[note.id] = { lane: clamp(note.lane + laneDelta, 0, 3), time: note.time + timeDelta, endTime: note.endTime === undefined ? undefined : note.endTime + timeDelta } })
      dragPreviewRef.current = preview; setDragPreview(preview)
    }
    const cleanup = () => {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up)
      pointerCleanupRef.current = () => undefined
    }
    const up = (upEvent: globalThis.PointerEvent) => {
      if (upEvent.pointerId !== pointerId) return
      const preview = dragPreviewRef.current
      if (upEvent.type !== 'pointercancel' && didDrag && Object.keys(preview).length) {
        onNotesChange(chart.notes.map((note) => preview[note.id] ? { ...note, ...preview[note.id] } : note))
        if (regionMode) onRegionMove?.(preview[selectedNotes[0].id].time - selectedNotes[0].time)
      } else if (!regionMode && upEvent.type !== 'pointercancel' && wasSelected) { const next = new Set(selectedIds); next.delete(id!); onSelectionChange(next) }
      if (regionMode && upEvent.type === 'pointercancel') suppressRegionClickRef.current = true
      dragPreviewRef.current = {}; setDragPreview({})
      cleanup()
    }
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up); window.addEventListener('pointercancel', up)
    pointerCleanupRef.current = cleanup
  }
  const resizeHold = (event: React.PointerEvent<HTMLButtonElement>, edge: 'start' | 'end') => {
    if (event.button !== 0 || (event.pointerType === 'touch' && event.isPrimary === false)) return
    event.stopPropagation(); event.preventDefault()
    suppressRegionClickRef.current = true
    pointerCleanupRef.current()
    const holds = chart.notes.filter((note) => note.kind === 'hold' && selectedIds.has(note.id) && Boolean(note.red) === redMode)
    if (!holds.length) return
    const startY = event.clientY
    const pointerId = event.pointerId
    const move = (moveEvent: globalThis.PointerEvent) => {
      if (moveEvent.pointerId !== pointerId) return
      const anchor = edge === 'end' ? holds[0].endTime! : holds[0].time
      const requestedPosition = scrollPositionAtTime(chart, anchor) - (moveEvent.clientY - startY) / pps * 1000
      const requestedDelta = snapToBeatLine(chart, timeAtScrollPosition(chart, requestedPosition), subdivision) - anchor
      const minimumLength = 60_000 / bpmAtTime(chart, anchor) / subdivision
      const minDelta = edge === 'end' ? Math.max(...holds.map((note) => note.time + minimumLength - note.endTime!)) : Math.max(...holds.map((note) => -note.time))
      const maxDelta = edge === 'end' ? Math.min(...holds.map((note) => chart.duration - note.endTime!)) : Math.min(...holds.map((note) => note.endTime! - minimumLength - note.time))
      const delta = clamp(requestedDelta, minDelta, maxDelta)
      const preview: Record<string, { lane: number; time: number; endTime?: number }> = {}
      holds.forEach((note) => { preview[note.id] = { lane: note.lane, time: edge === 'start' ? note.time + delta : note.time, endTime: edge === 'end' ? note.endTime! + delta : note.endTime } })
      dragPreviewRef.current = preview; setDragPreview(preview)
    }
    const cleanup = () => {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up)
      pointerCleanupRef.current = () => undefined
    }
    const up = (upEvent: globalThis.PointerEvent) => {
      if (upEvent.pointerId !== pointerId) return
      const preview = dragPreviewRef.current
      if (upEvent.type !== 'pointercancel' && Object.keys(preview).length) onNotesChange(chart.notes.map((note) => preview[note.id] ? { ...note, ...preview[note.id] } : note))
      dragPreviewRef.current = {}; setDragPreview({})
      cleanup()
    }
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up); window.addEventListener('pointercancel', up)
    pointerCleanupRef.current = cleanup
  }

  useEffect(() => {
    if (!laneRef.current) return
    const observer = new ResizeObserver((entries) => setLaneHeight(entries[0].contentRect.height))
    observer.observe(laneRef.current)
    return () => observer.disconnect()
  }, [])

  const renderSeekPreview = useCallback((time: number) => {
    const value = clamp(time, 0, chart.duration)
    previewingSeekRef.current = true
    pendingViewportTimeRef.current = value
    viewportTimeRef.current = value
    if (!seekFrameRef.current) {
      seekFrameRef.current = requestAnimationFrame(() => {
        seekFrameRef.current = 0
        setViewportTime(pendingViewportTimeRef.current)
      })
    }
  }, [chart.duration])

  const commitSeekPreview = useCallback(() => {
    window.clearTimeout(seekCommitTimerRef.current)
    if (!previewingSeekRef.current) return null
    if (seekFrameRef.current) {
      cancelAnimationFrame(seekFrameRef.current)
      seekFrameRef.current = 0
      setViewportTime(pendingViewportTimeRef.current)
    }
    previewingSeekRef.current = false
    onSeek(pendingViewportTimeRef.current)
    return pendingViewportTimeRef.current
  }, [onSeek])

  const startTouchPan = (event: React.PointerEvent, onTap: (clientY: number) => void) => {
    event.preventDefault()
    pointerCleanupRef.current()
    suppressRegionClickRef.current = true
    const { pointerId, clientX: startX, clientY: startY } = event
    const startPosition = scrollPositionAtTime(chart, viewportTimeRef.current)
    let moved = false
    let panning = false

    const move = (pointer: globalThis.PointerEvent) => {
      if (pointer.pointerId !== pointerId) return
      const deltaY = pointer.clientY - startY
      moved ||= Math.hypot(pointer.clientX - startX, deltaY) >= TOUCH_DRAG_THRESHOLD
      if (!panning && Math.abs(deltaY) < TOUCH_DRAG_THRESHOLD) return
      panning = true
      window.clearTimeout(seekCommitTimerRef.current)
      renderSeekPreview(timeAtScrollPosition(chart, startPosition + deltaY / pps * 1000))
    }
    const cleanup = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', end)
      window.removeEventListener('pointercancel', end)
      pointerCleanupRef.current = () => undefined
    }
    const end = (pointer: globalThis.PointerEvent) => {
      if (pointer.pointerId !== pointerId) return
      cleanup()
      if (pointer.type === 'pointercancel') {
        if (panning) {
          cancelAnimationFrame(seekFrameRef.current)
          seekFrameRef.current = 0
          previewingSeekRef.current = false
          pendingViewportTimeRef.current = currentTimeRef.current
          viewportTimeRef.current = currentTimeRef.current
          setViewportTime(currentTimeRef.current)
        }
        return
      }
      move(pointer)
      if (panning) commitSeekPreview()
      else if (!moved) onTap(startY)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', end)
    window.addEventListener('pointercancel', end)
    pointerCleanupRef.current = cleanup
  }

  const lanePointerDown = (event: React.PointerEvent, lane: number) => {
    if (event.button !== 0 || (event.pointerType === 'touch' && event.isPrimary === false)) return
    if (tool === 'region') notePointerDown(event)
    else if (event.pointerType === 'touch') startTouchPan(event, (clientY) => placeAtLane(clientY, lane))
    else placeAtLane(event.clientY, lane)
  }

  useImperativeHandle(ref, () => ({ flushSeek: commitSeekPreview }), [commitSeekPreview])

  const handleWheel = useCallback((event: WheelEvent) => {
    event.preventDefault()
    if (event.ctrlKey) onZoomChange(clamp(Math.round(pps * (event.deltaY < 0 ? 1.12 : 1 / 1.12)), 90, 1320))
    else {
      const direction = event.deltaY < 0 ? 1 : -1
      renderSeekPreview(adjacentBeatLine(chart, viewportTimeRef.current, subdivision, direction))
      window.clearTimeout(seekCommitTimerRef.current)
      seekCommitTimerRef.current = window.setTimeout(commitSeekPreview, 90)
    }
  }, [chart, commitSeekPreview, onZoomChange, pps, renderSeekPreview, subdivision])
  useEffect(() => {
    const element = laneRef.current
    if (!element) return
    element.addEventListener('wheel', handleWheel, { passive: false })
    return () => element.removeEventListener('wheel', handleWheel)
  }, [handleWheel])
  useEffect(() => () => {
    window.clearTimeout(seekCommitTimerRef.current)
    cancelAnimationFrame(seekFrameRef.current)
    pointerCleanupRef.current()
  }, [])

  const densityBins = useMemo(() => {
    const count = 84
    const bins = Array.from({ length: count }, () => 0)
    for (const note of chart.notes) {
      const start = clamp(Math.floor(note.time / chart.duration * count), 0, count - 1)
      const end = clamp(Math.floor((note.endTime ?? note.time) / chart.duration * count), start, count - 1)
      for (let index = start; index <= end; index += 1) bins[index] += note.kind === 'hold' ? .55 : 1
    }
    const maximum = Math.max(1, ...bins)
    return bins.map((value) => value / maximum)
  }, [chart.duration, chart.notes])

  const regionAnchor = tool === 'region' ? chart.notes.find((note) => selectedIds.has(note.id) && dragPreview[note.id]) : undefined
  const regionDelta = regionAnchor ? dragPreview[regionAnchor.id].time - regionAnchor.time : 0

  return <section className="chart-editor-stage">
    <div className="editor-body">
      <aside className="density-overview" aria-label={text('音符密集度与吸附精度', 'Note density and snap precision')}>
        <div className="density-stepper">
          <GameButton size="icon-sm" onClick={() => onSubdivisionChange(1)} aria-label={text('提高吸附精度', 'Increase snap precision')}><ChevronUp /></GameButton>
          <strong>1/{subdivision}</strong>
          <GameButton size="icon-sm" onClick={() => onSubdivisionChange(-1)} aria-label={text('降低吸附精度', 'Decrease snap precision')}><ChevronDown /></GameButton>
        </div>
        <div className="minimap" onPointerDown={(event) => {
          event.preventDefault(); pointerCleanupRef.current(); const minimap = event.currentTarget
          const pointerId = event.pointerId
          const seekAtPointer = (clientY: number) => { const rect = minimap.getBoundingClientRect(); renderSeekPreview((rect.bottom - clientY) / rect.height * chart.duration) }
          seekAtPointer(event.clientY)
          const move = (moveEvent: globalThis.PointerEvent) => { if (moveEvent.pointerId === pointerId) seekAtPointer(moveEvent.clientY) }
          const cleanup = () => {
            window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up)
            pointerCleanupRef.current = () => undefined
          }
          const up = (upEvent: globalThis.PointerEvent) => {
            if (upEvent.pointerId !== pointerId) return
            commitSeekPreview(); cleanup()
          }
          window.addEventListener('pointermove', move); window.addEventListener('pointerup', up); window.addEventListener('pointercancel', up)
          pointerCleanupRef.current = cleanup
        }}>
          <div className="density-bars">{densityBins.map((density, index) => <i key={index} style={{ width: `${density * 100}%`, opacity: density > 0 ? 1 : 0 }} />)}</div>
          <div className="minimap-window" style={{ bottom: `${clamp(timelineTime / chart.duration * 100, 0, 94)}%` }} />
        </div>
        <time>{formatOverviewTime(timelineTime)} / {formatOverviewTime(chart.duration)}</time>
      </aside>
      <div className="editor-track-space" style={{ '--editor-lane-width': `${laneWidthPercent}%` } as React.CSSProperties}>
        <div className={`lane-editor ${tool === 'region' || tool === 'tempo' || tool === 'effect' ? 'region-mode' : ''}`} ref={laneRef}>
          <EffectMarkers effects={chart.effects} from={visibleRange.from} to={visibleRange.to} height={laneHeight} yAt={yAt} onEdit={onEffectEdit} />
          {region && <div className="region-overlay" style={{ top: yAt((region.end ?? region.start) + regionDelta), height: Math.max(2, (scrollPositionAtTime(chart, (region.end ?? region.start) + regionDelta) - scrollPositionAtTime(chart, region.start + regionDelta)) / 1000 * pps) }} />}
          <div className="beat-layer">{lines.map((line) => {
            const y = yAt(line.time); const position = ((line.index % subdivision) + subdivision) % subdivision
            const tone = line.major ? 'major' : subdivision === 3 || (subdivision % 2 === 0 && position === subdivision / 2) ? 'blue' : 'violet'
            const tempo = chart.bpmChanges.find((change) => Math.abs(change.time - line.time) < 0.01)
            return <div key={line.index} className={`beat-line ${tone}${tempo ? ' tempo-change' : ''}`} style={{ top: y }}><span>{line.major ? Math.floor(line.beat) + 1 : ''}</span>{tempo && <b>{tempo.bpm} BPM</b>}</div>
          })}</div>
          <div className="lanes">{[0, 1, 2, 3].map((lane) => <div className={`edit-lane lane-${lane}`} key={lane} onPointerDown={(event) => lanePointerDown(event, lane)} onClick={regionClick} />)}</div>
          <div className="notes-layer">{visibleNotes.map((originalNote) => {
            const note = dragPreview[originalNote.id] ? { ...originalNote, ...dragPreview[originalNote.id] } : originalNote
            const y = yAt(note.time); const endY = note.kind === 'hold' ? yAt(note.endTime!) : y
            if (y < -150 || endY > laneHeight) return null
            return <div key={note.id} className={`editor-note ${note.kind} ${note.red ? 'red-zone' : ''} ${Boolean(note.red) !== redMode ? 'inactive-mode' : ''} ${selectedIds.has(note.id) ? 'selected' : ''} ${tool === 'delete' ? 'deletable' : ''}`} onPointerDown={(event) => notePointerDown(event, note.id)} onClick={regionClick} style={{ left: `${note.lane * 25 + 1.6}%`, top: note.kind === 'hold' ? endY : y - 7, height: note.kind === 'hold' ? Math.max(16, y - endY + 12) : 14, '--lane': note.red ? 'var(--red-zone)' : LANE_COLORS[note.lane] } as React.CSSProperties}><i />{note.kind === 'hold' && selectedIds.has(note.id) && Boolean(note.red) === redMode && <><button className="hold-resize-handle end" aria-label={text('调整 Hold 终点', 'Adjust Hold end')} onPointerDown={(event) => resizeHold(event, 'end')} /><button className="hold-resize-handle start" aria-label={text('调整 Hold 起点', 'Adjust Hold start')} onPointerDown={(event) => resizeHold(event, 'start')} /></>}</div>
          })}{holdStart && <div className="hold-pending" style={{ left: `${holdStart.lane * 25 + 2}%`, top: yAt(holdStart.time) - 8, '--lane': redMode ? 'var(--red-zone)' : LANE_COLORS[holdStart.lane] } as React.CSSProperties} />}</div>
          <div className="judgment-line" style={{ top: judgmentY }}><span>{isPlaying ? text('播放中', 'Playing') : text('判定线', 'Judgment')}</span></div>
        </div>
      </div>
    </div>
  </section>
}
