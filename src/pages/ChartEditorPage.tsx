import { useCallback, useEffect, useMemo, useState } from 'react'
import { ClipboardPaste, Copy, FileDown, FileUp, FlipHorizontal2, Redo2, Settings2, Trash2, Undo2 } from 'lucide-react'
import { navigate } from '@/app/navigation'
import { Button } from '@/components/ui/button'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { Slider } from '@/components/ui/slider'
import { ChartEditor } from '@/features/chart/ChartEditor'
import { useChart } from '@/features/chart/ChartProvider'
import type { ChartNote, ToolMode } from '@/features/chart/types'

const SUBDIVISIONS = [2, 3, 4, 6, 8, 12, 16, 24, 32] as const
const PLAYBACK_RATES = [0.5, 0.75, 1] as const
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))
const formatTime = (milliseconds: number) => {
  const total = Math.max(0, milliseconds) / 1000
  return `${Math.floor(total / 60)}:${Math.floor(total % 60).toString().padStart(2, '0')}.${Math.floor((total % 1) * 1000).toString().padStart(3, '0')}`
}
const notesInRegion = (notes: ChartNote[], start: number, end: number) => notes.filter((note) => note.time >= start && (note.endTime ?? note.time) <= end)

export default function ChartEditorPage() {
  const { chart, setChart, currentTime, setCurrentTime, isPlaying, historyLength, futureLength, commitNotes, undo, redo, loadChart, saveChart, togglePlay, showToast } = useChart()
  const [playbackRate, setPlaybackRate] = useState<(typeof PLAYBACK_RATES)[number]>(1)
  const [subdivision, setSubdivision] = useState<(typeof SUBDIVISIONS)[number]>(4)
  const [tool, setTool] = useState<ToolMode>('note')
  const [holdStart, setHoldStart] = useState<{ lane: number; time: number } | null>(null)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [region, setRegion] = useState<{ start: number; end: number | null } | null>(null)
  const [copiedRegion, setCopiedRegion] = useState<{ start: number; notes: ChartNote[] } | null>(null)
  const regionNotes = useMemo(() => !region || region.end === null ? [] : notesInRegion(chart.notes, region.start, region.end), [chart.notes, region])

  const resetToolContext = (next: ToolMode) => {
    setTool(next); setHoldStart(null)
    if (next !== 'region') setRegion(null)
    if (next !== 'delete') setSelectedIds(new Set())
  }
  const chooseRegionLine = (time: number) => {
    if (!region || region.end !== null) { setRegion({ start: time, end: null }); setSelectedIds(new Set()); return }
    const start = Math.min(region.start, time); const end = Math.max(region.start, time)
    setRegion({ start, end }); setSelectedIds(new Set(notesInRegion(chart.notes, start, end).map((note) => note.id)))
  }
  const copyRegion = useCallback(() => {
    if (!region || region.end === null || !regionNotes.length) return
    setCopiedRegion({ start: region.start, notes: regionNotes.map((note) => ({ ...note })) })
    showToast(`已复制 ${regionNotes.length} 个音符；选择粘贴并点击目标节拍线`)
  }, [region, regionNotes, showToast])
  const pasteRegion = useCallback((time: number) => {
    if (!copiedRegion?.notes.length) return
    const delta = time - copiedRegion.start
    if (copiedRegion.notes.some((note) => note.time + delta < 0 || (note.endTime ?? note.time) + delta > chart.duration)) { showToast('目标位置超出谱面时长，无法粘贴完整区域'); return }
    const pasted = copiedRegion.notes.map((note) => ({ ...note, id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`, time: note.time + delta, endTime: note.endTime === undefined ? undefined : note.endTime + delta }))
    commitNotes([...chart.notes, ...pasted]); setSelectedIds(new Set(pasted.map((note) => note.id))); setRegion(null); setTool('region'); showToast(`已粘贴 ${pasted.length} 个音符`)
  }, [chart.duration, chart.notes, commitNotes, copiedRegion, showToast])
  const mirrorRegion = () => {
    if (!regionNotes.length) return
    const ids = new Set(regionNotes.map((note) => note.id))
    commitNotes(chart.notes.map((note) => ids.has(note.id) ? { ...note, lane: 3 - note.lane } : note)); showToast(`已镜像 ${ids.size} 个音符`)
  }
  const deleteSelection = useCallback(() => {
    if (!selectedIds.size) { setTool('delete'); setHoldStart(null); return }
    commitNotes(chart.notes.filter((note) => !selectedIds.has(note.id))); setSelectedIds(new Set()); setTool('note')
  }, [chart.notes, commitNotes, selectedIds])

  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement
      const editing = target instanceof HTMLInputElement || target instanceof HTMLSelectElement || target instanceof HTMLTextAreaElement || target.isContentEditable
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); void saveChart(); return }
      if (editing) return
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); event.shiftKey ? redo() : undo(); return }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a') { event.preventDefault(); setRegion(null); setSelectedIds(new Set(chart.notes.map((note) => note.id))); return }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'c' && region?.end != null) { event.preventDefault(); copyRegion(); return }
      const beat = 60000 / chart.bpm; const step = beat / subdivision
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'v' && copiedRegion) { event.preventDefault(); pasteRegion(clamp(Math.round((currentTime - chart.offset) / step) * step + chart.offset, 0, chart.duration)); return }
      if (event.repeat) return
      if (event.code === 'KeyQ') { event.preventDefault(); void togglePlay(playbackRate, subdivision) }
      if (event.code === 'Delete' && selectedIds.size) { event.preventDefault(); deleteSelection() }
      if (event.code === 'ArrowUp') { event.preventDefault(); setCurrentTime(currentTime + step) }
      if (event.code === 'ArrowDown') { event.preventDefault(); setCurrentTime(currentTime - step) }
      if (event.code === 'Space') { event.preventDefault(); setCurrentTime(currentTime + beat) }
    }
    window.addEventListener('keydown', keydown)
    return () => window.removeEventListener('keydown', keydown)
  }, [chart.bpm, chart.duration, chart.notes, chart.offset, copiedRegion, copyRegion, currentTime, deleteSelection, pasteRegion, playbackRate, redo, region, saveChart, selectedIds.size, setCurrentTime, subdivision, togglePlay, undo])

  return <div className="editor-page page-enter">
    <header className="editor-toolbar">
      <div className="editor-song"><span className="eyebrow">CHART EDITOR</span><strong>{chart.title}</strong><small>{chart.audioName || '尚未选择音频'} · {chart.notes.length} NOTES</small></div>
      <div className="editor-file-actions"><Button variant="outline" size="icon" title="打开谱面" onClick={() => void loadChart()}><FileUp /></Button><Button variant="outline" size="icon" title="保存谱面" onClick={() => void saveChart()}><FileDown /></Button><Button variant="outline" onClick={() => navigate('setup')}><Settings2 />谱面配置</Button></div>
    </header>
    <div className="editor-workspace">
      <aside className="editor-tools editor-panel">
        <section><label className="section-label">谱面工具</label><div className="tool-grid">
          <button className={tool === 'note' ? 'active' : ''} onClick={() => resetToolContext('note')}><span className="note-glyph tap" /><b>NOTE</b><small>单击放置</small></button>
          <button className={tool === 'hold' ? 'active' : ''} onClick={() => resetToolContext('hold')}><span className="note-glyph hold" /><b>HOLD</b><small>{holdStart ? '选择终点' : '两次点击'}</small></button>
          <button className={`danger ${tool === 'delete' ? 'active' : ''}`} onClick={deleteSelection}><Trash2 /><b>删除</b><small>{selectedIds.size ? `${selectedIds.size} 个已选` : '点击移除'}</small></button>
        </div></section>
        <section><label className="section-label">区域操作</label><button className={`region-select ${tool === 'region' ? 'active' : ''}`} onClick={() => { setTool('region'); setHoldStart(null); setSelectedIds(new Set()); setRegion(null) }}>选择区域<small>依次点击起点与终点节拍线</small></button>
          <div className="region-range">{region ? `${formatTime(region.start)} → ${region.end === null ? '选择终点' : formatTime(region.end)}` : '尚未选择区域'}{region?.end !== null && region ? <span>{regionNotes.length} 个</span> : null}</div>
          <div className="region-actions"><Button variant="outline" disabled={!regionNotes.length} onClick={copyRegion}><Copy />复制</Button><Button variant="outline" disabled={!copiedRegion?.notes.length} className={tool === 'paste' ? 'active' : ''} onClick={() => setTool('paste')}><ClipboardPaste />粘贴</Button><Button variant="outline" disabled={!regionNotes.length} onClick={mirrorRegion}><FlipHorizontal2 />镜像</Button></div>
        </section>
        <section><label className="section-label">吸附精度</label><NativeSelect className="editor-select" value={subdivision} onChange={(event) => setSubdivision(Number(event.target.value) as typeof subdivision)}>{SUBDIVISIONS.map((value) => <NativeSelectOption key={value} value={value}>1 / {value}</NativeSelectOption>)}</NativeSelect><p className="editor-hint">仅影响后续放置，已有音符不会移动。</p></section>
        <section className="history-actions"><Button variant="outline" onClick={undo} disabled={!historyLength}><Undo2 />撤回</Button><Button variant="outline" onClick={redo} disabled={!futureLength}><Redo2 />重做</Button></section>
      </aside>

      <ChartEditor chart={chart} currentTime={currentTime} subdivision={subdivision} tool={tool} holdStart={holdStart} selectedIds={selectedIds} region={region} isPlaying={isPlaying} onSeek={setCurrentTime} onNotesChange={commitNotes} onHoldStart={setHoldStart} onSelectionChange={setSelectedIds} onRegionLine={chooseRegionLine} onPasteLine={pasteRegion} onZoomChange={(editorZoom) => setChart((current) => ({ ...current, settings: { ...current.settings, editorZoom } }))} />

      <aside className="editor-inspector editor-panel">
        <section className="inspector-head"><div><label className="section-label">编辑器状态</label><b>{isPlaying ? '实时制谱' : '已暂停'}</b></div><span className={`status ${isPlaying ? 'live' : ''}`}>{isPlaying ? 'PLAY' : 'READY'}</span></section>
        <section className="time-card"><span>当前时间</span><strong>{formatTime(currentTime)}</strong><div><span>总时长</span><b>{formatTime(chart.duration)}</b></div></section>
        <section><label className="section-label">时间轴</label><Slider min={0} max={chart.duration || 1} value={[currentTime]} onValueChange={([value]) => setCurrentTime(value)} /></section>
        <section><label className="section-label">编辑播放速度</label><div className="moon-segmented">{PLAYBACK_RATES.map((rate) => <button key={rate} className={playbackRate === rate ? 'active' : ''} onClick={() => setPlaybackRate(rate)}>{rate}×</button>)}</div></section>
        <section className="summary-card"><div><span>NOTE</span><b>{chart.notes.filter((note) => note.kind === 'note').length}</b></div><div><span>HOLD</span><b>{chart.notes.filter((note) => note.kind === 'hold').length}</b></div><div><span>密度</span><b>{(chart.notes.length / Math.max(1, chart.duration / 60000)).toFixed(1)}/m</b></div></section>
        <section className="shortcut-card"><span className="section-label">快捷键</span><div><kbd>Q</kbd><span>播放 / 暂停</span></div><div><kbd>Space</kbd><span>前进主拍</span></div><div><kbd>↑ ↓</kbd><span>分拍步进</span></div><div><kbd>Ctrl + 滚轮</kbd><span>缩放轨道</span></div><div><kbd>Ctrl + S</kbd><span>保存谱面</span></div></section>
      </aside>
    </div>
  </div>
}
