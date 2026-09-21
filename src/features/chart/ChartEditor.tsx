import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Chart, ChartNote, ToolMode } from './types'

const LANE_COLORS = ['#31d7ff', '#b788ff', '#b788ff', '#31d7ff']
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))
const uid = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`

interface EditorProps {
  chart: Chart
  currentTime: number
  subdivision: number
  tool: ToolMode
  holdStart: { lane: number; time: number } | null
  selectedIds: Set<string>
  region: { start: number; end: number | null } | null
  isPlaying: boolean
  onSeek(time: number): void
  onNotesChange(notes: ChartNote[]): void
  onHoldStart(value: { lane: number; time: number } | null): void
  onSelectionChange(ids: Set<string>): void
  onRegionLine(time: number): void
  onPasteLine(time: number): void
  onZoomChange(value: number): void
}

export function ChartEditor({ chart, currentTime, subdivision, tool, holdStart, selectedIds, region, isPlaying, onSeek, onNotesChange, onHoldStart, onSelectionChange, onRegionLine, onPasteLine, onZoomChange }: EditorProps) {
  const laneRef = useRef<HTMLDivElement>(null)
  const [laneHeight, setLaneHeight] = useState(700)
  const [dragPreview, setDragPreview] = useState<Record<string, { lane: number; time: number; endTime?: number }>>({})
  const dragPreviewRef = useRef<Record<string, { lane: number; time: number; endTime?: number }>>({})
  const pps = chart.settings.editorZoom
  const headerHeight = 34
  const judgmentY = Math.max(300, laneHeight - headerHeight - 18)
  const beat = 60000 / chart.bpm
  const step = beat / subdivision
  const lines = useMemo(() => {
    const from = currentTime - ((laneHeight - headerHeight - judgmentY + 120) / pps * 1000)
    const to = currentTime + ((judgmentY + 120) / pps * 1000)
    const first = Math.floor((from - chart.offset) / step)
    const result: { time: number; major: boolean; index: number }[] = []
    for (let index = first; chart.offset + index * step <= to; index += 1) {
      if (chart.offset + index * step >= 0) result.push({ time: chart.offset + index * step, major: index % subdivision === 0, index })
    }
    return result
  }, [currentTime, chart.offset, step, subdivision, laneHeight, judgmentY, pps])

  const yAt = (time: number) => judgmentY - (time - currentTime) / 1000 * pps
  const pointerTime = (clientY: number) => {
    const rect = laneRef.current!.getBoundingClientRect()
    const raw = currentTime + (judgmentY - (clientY - rect.top - headerHeight)) / pps * 1000
    return clamp(Math.round((raw - chart.offset) / step) * step + chart.offset, 0, chart.duration)
  }
  const laneClick = (event: React.MouseEvent, lane: number) => {
    const time = pointerTime(event.clientY)
    if (tool === 'region') { onRegionLine(time); return }
    if (tool === 'paste') { onPasteLine(time); return }
    if (tool === 'delete') return
    const beatIndex = Math.round((time - chart.offset) / step)
    const noteOnBeat = chart.notes.find((note) => note.lane === lane && Math.round((note.time - chart.offset) / step) === beatIndex)
    if (noteOnBeat) {
      const next = new Set(selectedIds)
      if (next.has(noteOnBeat.id)) next.delete(noteOnBeat.id); else next.add(noteOnBeat.id)
      onSelectionChange(next); return
    }
    if (selectedIds.size) { onSelectionChange(new Set()); return }
    if (tool === 'note') onNotesChange([...chart.notes, { id: uid(), lane, time, kind: 'note' }])
    else if (!holdStart) onHoldStart({ lane, time })
    else {
      const start = Math.min(holdStart.time, time)
      const end = Math.max(holdStart.time, time)
      if (end - start >= step * .5) onNotesChange([...chart.notes, { id: uid(), lane: holdStart.lane, time: start, endTime: end, kind: 'hold' }])
      onHoldStart(null)
    }
  }
  const noteMouseDown = (event: React.MouseEvent, id: string) => {
    if (event.button !== 0) return
    event.stopPropagation(); event.preventDefault()
    if (tool === 'region') { onRegionLine(pointerTime(event.clientY)); return }
    if (tool === 'paste') { onPasteLine(pointerTime(event.clientY)); return }
    if (tool === 'delete') { onNotesChange(chart.notes.filter((note) => note.id !== id)); return }
    const wasSelected = selectedIds.has(id)
    const nextSelection = new Set(selectedIds)
    if (!wasSelected) { nextSelection.add(id); onSelectionChange(nextSelection) }
    const startX = event.clientX
    const startY = event.clientY
    const rect = laneRef.current!.getBoundingClientRect()
    const selectedNotes = chart.notes.filter((note) => nextSelection.has(note.id))
    const earliest = Math.min(...selectedNotes.map((note) => note.time))
    const latest = Math.max(...selectedNotes.map((note) => note.endTime ?? note.time))
    let didDrag = false
    const move = (moveEvent: MouseEvent) => {
      if (!didDrag && Math.hypot(moveEvent.clientX - startX, moveEvent.clientY - startY) < 3) return
      didDrag = true
      const laneDelta = Math.round((moveEvent.clientX - startX) / (rect.width / 4))
      const requestedTimeDelta = Math.round((-(moveEvent.clientY - startY) / pps * 1000) / step) * step
      const timeDelta = clamp(requestedTimeDelta, -earliest, chart.duration - latest)
      const preview: Record<string, { lane: number; time: number; endTime?: number }> = {}
      selectedNotes.forEach((note) => { preview[note.id] = { lane: clamp(note.lane + laneDelta, 0, 3), time: note.time + timeDelta, endTime: note.endTime === undefined ? undefined : note.endTime + timeDelta } })
      dragPreviewRef.current = preview; setDragPreview(preview)
    }
    const up = () => {
      const preview = dragPreviewRef.current
      if (didDrag && Object.keys(preview).length) onNotesChange(chart.notes.map((note) => preview[note.id] ? { ...note, ...preview[note.id] } : note))
      else if (wasSelected) { const next = new Set(selectedIds); next.delete(id); onSelectionChange(next) }
      dragPreviewRef.current = {}; setDragPreview({})
      window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up)
    }
    window.addEventListener('mousemove', move); window.addEventListener('mouseup', up)
  }
  const resizeHold = (event: React.MouseEvent, edge: 'start' | 'end') => {
    if (event.button !== 0) return
    event.stopPropagation(); event.preventDefault()
    const holds = chart.notes.filter((note) => note.kind === 'hold' && selectedIds.has(note.id))
    if (!holds.length) return
    const startY = event.clientY
    const move = (moveEvent: MouseEvent) => {
      const requestedDelta = Math.round((-(moveEvent.clientY - startY) / pps * 1000) / step) * step
      const minDelta = edge === 'end' ? Math.max(...holds.map((note) => note.time + step - note.endTime!)) : Math.max(...holds.map((note) => -note.time))
      const maxDelta = edge === 'end' ? Math.min(...holds.map((note) => chart.duration - note.endTime!)) : Math.min(...holds.map((note) => note.endTime! - step - note.time))
      const delta = clamp(requestedDelta, minDelta, maxDelta)
      const preview: Record<string, { lane: number; time: number; endTime?: number }> = {}
      holds.forEach((note) => { preview[note.id] = { lane: note.lane, time: edge === 'start' ? note.time + delta : note.time, endTime: edge === 'end' ? note.endTime! + delta : note.endTime } })
      dragPreviewRef.current = preview; setDragPreview(preview)
    }
    const up = () => {
      const preview = dragPreviewRef.current
      if (Object.keys(preview).length) onNotesChange(chart.notes.map((note) => preview[note.id] ? { ...note, ...preview[note.id] } : note))
      dragPreviewRef.current = {}; setDragPreview({})
      window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up)
    }
    window.addEventListener('mousemove', move); window.addEventListener('mouseup', up)
  }

  useEffect(() => {
    if (!laneRef.current) return
    const observer = new ResizeObserver((entries) => setLaneHeight(entries[0].contentRect.height))
    observer.observe(laneRef.current)
    return () => observer.disconnect()
  }, [])
  const handleWheel = useCallback((event: WheelEvent) => {
    event.preventDefault()
    if (event.ctrlKey) onZoomChange(clamp(Math.round(pps * (event.deltaY < 0 ? 1.12 : 1 / 1.12)), 90, 1320))
    else onSeek(currentTime - event.deltaY / pps * 1000)
  }, [currentTime, onSeek, onZoomChange, pps])
  useEffect(() => {
    const element = laneRef.current
    if (!element) return
    element.addEventListener('wheel', handleWheel, { passive: false })
    return () => element.removeEventListener('wheel', handleWheel)
  }, [handleWheel])

  return <section className="chart-editor-stage">
    <div className="stage-caption"><span>OVERVIEW</span><span>4K TIMELINE · CTRL + WHEEL {Math.round(pps / 2.3)}%</span><span>{selectedIds.size ? `SELECTED ${selectedIds.size}` : isPlaying ? 'RECORDING INPUT' : `SNAP 1/${subdivision}`}</span></div>
    <div className="editor-body">
      <div className="minimap" onMouseDown={(event) => {
        event.preventDefault(); const minimap = event.currentTarget
        const seekAtPointer = (clientY: number) => { const rect = minimap.getBoundingClientRect(); onSeek((rect.bottom - clientY) / rect.height * chart.duration) }
        seekAtPointer(event.clientY)
        const move = (moveEvent: MouseEvent) => seekAtPointer(moveEvent.clientY)
        const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up) }
        window.addEventListener('mousemove', move); window.addEventListener('mouseup', up)
      }}>
        <div className="minimap-beats" style={{ backgroundSize: `100% ${Math.max(.5, (60000 / chart.bpm) / chart.duration * 100)}%` }} />
        {chart.notes.map((note) => <i key={note.id} style={{ bottom: `${note.time / chart.duration * 100}%`, left: `${10 + note.lane * 11}px`, height: note.kind === 'hold' ? `${Math.max(3, ((note.endTime! - note.time) / chart.duration) * 100)}%` : 2, background: LANE_COLORS[note.lane] }} />)}
        <div className="minimap-window" style={{ bottom: `${clamp(currentTime / chart.duration * 100, 0, 94)}%` }} />
      </div>
      <div className={`lane-editor ${tool === 'region' || tool === 'paste' ? 'region-mode' : ''}`} ref={laneRef}>
        <div className="lane-header">{chart.settings.keys.map((key, index) => <div key={index}><span>{index + 1}</span><b>{key}</b></div>)}</div>
        {region && <div className="region-overlay" style={{ top: headerHeight + yAt(region.end ?? region.start), height: Math.max(2, ((region.end ?? region.start) - region.start) / 1000 * pps) }} />}
        <div className="beat-layer">{lines.map((line) => {
          const y = yAt(line.time); const position = ((line.index % subdivision) + subdivision) % subdivision
          const tone = line.major ? 'major' : subdivision === 3 || (subdivision % 2 === 0 && position === subdivision / 2) ? 'blue' : 'violet'
          return <div key={line.index} className={`beat-line ${tone}`} style={{ top: y }}><span>{line.major ? Math.floor((line.time - chart.offset) / beat) + 1 : ''}</span></div>
        })}</div>
        <div className="lanes">{[0, 1, 2, 3].map((lane) => <div className={`edit-lane lane-${lane}`} key={lane} onMouseDown={(event) => laneClick(event, lane)} />)}</div>
        <div className="notes-layer">{chart.notes.map((originalNote) => {
          const note = dragPreview[originalNote.id] ? { ...originalNote, ...dragPreview[originalNote.id] } : originalNote
          const y = yAt(note.time); const endY = note.kind === 'hold' ? yAt(note.endTime!) : y
          if (y < -150 || endY > laneHeight) return null
          return <div key={note.id} className={`editor-note ${note.kind} ${selectedIds.has(note.id) ? 'selected' : ''} ${tool === 'delete' ? 'deletable' : ''}`} onMouseDown={(event) => noteMouseDown(event, note.id)} style={{ left: `${note.lane * 25 + 1.6}%`, top: note.kind === 'hold' ? endY : y - 7, height: note.kind === 'hold' ? Math.max(16, y - endY + 12) : 14, '--lane': LANE_COLORS[note.lane] } as React.CSSProperties}><i />{note.kind === 'hold' && selectedIds.has(note.id) && <><button className="hold-resize-handle end" aria-label="调整 Hold 终点" onMouseDown={(event) => resizeHold(event, 'end')} /><button className="hold-resize-handle start" aria-label="调整 Hold 起点" onMouseDown={(event) => resizeHold(event, 'start')} /></>}</div>
        })}{holdStart && <div className="hold-pending" style={{ left: `${holdStart.lane * 25 + 2}%`, top: yAt(holdStart.time) - 8 }} />}</div>
        <div className="judgment-line" style={{ top: headerHeight + judgmentY }}><span>JUDGEMENT</span></div>
      </div>
    </div>
  </section>
}
