import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  BookOpen, ClipboardPaste, Copy, FileUp, FlipHorizontal2, FolderOpen, Gamepad2, ImagePlus, Library,
  Music2, Pause, Play, Plus, Redo2, Save, ScanSearch, SlidersHorizontal, Trash2,
  Undo2, Upload, X,
} from 'lucide-react'
import { navigate } from '@/app/navigation'
import { usePreferences } from '@/app/preferences'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Slider } from '@/components/ui/slider'
import { ChartEditor } from '@/features/chart/ChartEditor'
import { useChart } from '@/features/chart/ChartProvider'
import type { ChartNote, ToolMode } from '@/features/chart/types'

const SUBDIVISIONS = [2, 3, 4, 6, 8, 12, 16, 24, 32] as const
const PLAYBACK_RATES = [0.5, 0.75, 1] as const
const BPM_MIN = 20
const BPM_MAX = 400
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))
const formatTime = (milliseconds: number) => {
  const total = Math.max(0, milliseconds) / 1000
  return `${Math.floor(total / 60)}:${Math.floor(total % 60).toString().padStart(2, '0')}.${Math.floor((total % 1) * 1000).toString().padStart(3, '0')}`
}
const notesInRegion = (notes: ChartNote[], start: number, end: number) => notes.filter((note) => note.time >= start && (note.endTime ?? note.time) <= end)

export default function ChartEditorPage() {
  const {
    chart, setChart, activeChartId, charts, libraryReady, storageStatus, currentTime, setCurrentTime,
    isPlaying, historyLength, futureLength, commitNotes, undo, redo, loadChart, saveChart, togglePlay,
    chooseAudio, chooseBackground, removeBackground, createChart, selectChart, deleteChart, revealLibrary, showToast,
  } = useChart()
  const { preferences, setPreferences } = usePreferences()
  const [playbackRate, setPlaybackRate] = useState<(typeof PLAYBACK_RATES)[number]>(1)
  const [subdivision, setSubdivision] = useState<(typeof SUBDIVISIONS)[number]>(4)
  const [tool, setTool] = useState<ToolMode>('note')
  const [holdStart, setHoldStart] = useState<{ lane: number; time: number } | null>(null)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [region, setRegion] = useState<{ start: number; end: number | null } | null>(null)
  const [copiedRegion, setCopiedRegion] = useState<{ start: number; notes: ChartNote[] } | null>(null)
  const [openSheet, setOpenSheet] = useState<'info' | 'settings' | 'playtest' | null>(null)
  const [deleteId, setDeleteId] = useState('')
  const [bpmDraft, setBpmDraft] = useState(String(chart.bpm))
  const [offsetDraft, setOffsetDraft] = useState(String(chart.offset))
  const regionNotes = useMemo(() => !region || region.end === null ? [] : notesInRegion(chart.notes, region.start, region.end), [chart.notes, region])
  const regionStatus = useMemo(() => {
    if (tool === 'paste') return { tone: 'action', title: '选择粘贴位置', detail: `已复制 ${copiedRegion?.notes.length ?? 0} 个音符，请点击轨道上的目标节拍线。` }
    if (tool !== 'region') return copiedRegion ? { tone: 'ready', title: '区域内容已复制', detail: `剪贴板中有 ${copiedRegion.notes.length} 个音符，点击粘贴按钮后选择目标节拍线。` } : null
    if (!region) return { tone: 'action', title: '选择区域起点', detail: '点击轨道上的一条节拍线作为区域起点。' }
    if (region.end === null) return { tone: 'action', title: '继续选择区域终点', detail: `起点 ${formatTime(region.start)}，现在点击另一条节拍线。` }
    if (!regionNotes.length) return { tone: 'empty', title: '所选区域没有音符', detail: '请重新选择包含音符的范围，之后才能复制或镜像。' }
    return { tone: 'ready', title: `已选择 ${regionNotes.length} 个音符`, detail: copiedRegion ? '可以镜像当前区域，或点击粘贴后选择目标位置。' : '现在可以复制或镜像；复制后才能使用粘贴。' }
  }, [copiedRegion, region, regionNotes.length, tool])

  useEffect(() => setBpmDraft(String(chart.bpm)), [chart.bpm])
  useEffect(() => setOffsetDraft(String(chart.offset)), [chart.offset])

  const applyBpm = (value: number) => {
    if (!Number.isFinite(value) || value < BPM_MIN || value > BPM_MAX) return
    setChart((previous) => {
      if (value === previous.bpm) return previous
      const scale = previous.bpm / value
      const fromOffset = (time: number) => previous.offset + (time - previous.offset) * scale
      return { ...previous, bpm: value, notes: previous.notes.map((note) => ({ ...note, time: fromOffset(note.time), endTime: note.endTime === undefined ? undefined : fromOffset(note.endTime) })) }
    })
  }
  const applyOffset = (value: number) => {
    if (!Number.isFinite(value)) return
    setChart((previous) => {
      const delta = value - previous.offset
      if (!delta) return previous
      return { ...previous, offset: value, notes: previous.notes.map((note) => ({ ...note, time: note.time + delta, endTime: note.endTime === undefined ? undefined : note.endTime + delta })) }
    })
  }
  const resetToolContext = useCallback((next: ToolMode) => {
    setTool(next); setHoldStart(null)
    if (next !== 'region') setRegion(null)
    if (next !== 'delete') setSelectedIds(new Set())
  }, [])
  const chooseRegionLine = useCallback((time: number) => {
    if (!region || region.end !== null) { setRegion({ start: time, end: null }); setSelectedIds(new Set()); return }
    const start = Math.min(region.start, time); const end = Math.max(region.start, time)
    setRegion({ start, end }); setSelectedIds(new Set(notesInRegion(chart.notes, start, end).map((note) => note.id)))
  }, [chart.notes, region])
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
  const mirrorRegion = useCallback(() => {
    if (!regionNotes.length) return
    const ids = new Set(regionNotes.map((note) => note.id))
    commitNotes(chart.notes.map((note) => ids.has(note.id) ? { ...note, lane: 3 - note.lane } : note)); showToast(`已镜像 ${ids.size} 个音符`)
  }, [chart.notes, commitNotes, regionNotes, showToast])
  const deleteSelection = useCallback(() => {
    if (!selectedIds.size) { setTool('delete'); setHoldStart(null); return }
    commitNotes(chart.notes.filter((note) => !selectedIds.has(note.id))); setSelectedIds(new Set()); setTool('note')
  }, [chart.notes, commitNotes, selectedIds])
  const changeSubdivision = useCallback((direction: -1 | 1) => {
    setSubdivision((current) => {
      const index = SUBDIVISIONS.indexOf(current)
      return SUBDIVISIONS[clamp(index + direction, 0, SUBDIVISIONS.length - 1)]
    })
  }, [])
  const startRegionSelection = useCallback(() => {
    setTool('region'); setHoldStart(null); setSelectedIds(new Set()); setRegion(null)
  }, [])
  const startPlaytest = useCallback(async (fromStart: boolean) => {
    if (isPlaying) await togglePlay(playbackRate, subdivision)
    setCurrentTime(fromStart ? 0 : currentTime)
    setOpenSheet(null)
    navigate('playtest')
  }, [currentTime, isPlaying, playbackRate, setCurrentTime, subdivision, togglePlay])

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
    <div className="editor-workspace">
      <ChartEditor
        chart={chart} currentTime={currentTime} subdivision={subdivision} tool={tool} holdStart={holdStart}
        selectedIds={selectedIds} region={region} isPlaying={isPlaying} onSeek={setCurrentTime}
        onNotesChange={commitNotes} onHoldStart={setHoldStart} onSelectionChange={setSelectedIds}
        onRegionLine={chooseRegionLine} onPasteLine={pasteRegion}
        onZoomChange={(editorZoom) => setChart((current) => ({ ...current, settings: { ...current.settings, editorZoom } }))}
        onSubdivisionChange={changeSubdivision}
      />

      <aside className="editor-action-rail editor-action-rail-left" aria-label="常用编辑操作">
        <button className="editor-action primary" onClick={() => void togglePlay(playbackRate, subdivision)}><span>{isPlaying ? <Pause /> : <Play />}</span><b>{isPlaying ? '暂停' : '播放'}</b></button>
        <button className={`editor-action${tool === 'region' ? ' active' : ''}`} onClick={startRegionSelection}><span><ScanSearch /></span><b>区域</b></button>
        <button className={`editor-action danger${tool === 'delete' ? ' active' : ''}`} onClick={deleteSelection}><span><Trash2 /></span><b>删除</b></button>
        <div className="editor-compact-actions">
          <button disabled={!regionNotes.length} onClick={copyRegion} title={regionNotes.length ? '复制所选区域' : '完成包含音符的区域选择后可用'}><Copy /></button>
          <button className={tool === 'paste' ? 'active' : ''} disabled={!copiedRegion?.notes.length} onClick={() => setTool('paste')} title={copiedRegion?.notes.length ? '选择粘贴位置' : '先复制一个包含音符的区域'}><ClipboardPaste /></button>
          <button disabled={!regionNotes.length} onClick={mirrorRegion} title={regionNotes.length ? '镜像所选区域' : '完成包含音符的区域选择后可用'}><FlipHorizontal2 /></button>
        </div>
        <small className="region-action-explain">{regionNotes.length ? '可复制或镜像' : copiedRegion ? '可选择粘贴位置' : '先完成区域选择'}</small>
        <div className="editor-compact-actions">
          <button disabled={!historyLength} onClick={undo} title="撤回"><Undo2 /></button>
          <button disabled={!futureLength} onClick={redo} title="重做"><Redo2 /></button>
        </div>
        <div className="playback-rate">{PLAYBACK_RATES.map((rate) => <button key={rate} className={playbackRate === rate ? 'active' : ''} onClick={() => setPlaybackRate(rate)}>{rate}×</button>)}</div>
      </aside>

      <aside className="editor-action-rail editor-action-rail-right" aria-label="音符工具">
        <button className={`editor-action${tool === 'note' ? ' active' : ''}`} onClick={() => resetToolContext('note')}><span className="note-glyph tap" /><b>NOTE</b></button>
        <button className={`editor-action${tool === 'hold' ? ' active' : ''}`} onClick={() => resetToolContext('hold')}><span className="note-glyph hold" /><b>HOLD</b></button>
      </aside>

      <aside className="editor-utility-dock intro" aria-label="编辑器工具栏">
        <button onClick={() => setOpenSheet('info')}><span className="editor-dock-label">谱面信息</span><BookOpen /></button>
        <button onClick={() => setOpenSheet('settings')}><span className="editor-dock-label">谱面设置</span><SlidersHorizontal /></button>
        <button onClick={() => setOpenSheet('playtest')}><span className="editor-dock-label">谱面试玩</span><Gamepad2 /></button>
        <button onClick={() => void saveChart()}><span className="editor-dock-label">保存谱面</span><Save /></button>
      </aside>
      {regionStatus && <div className="region-workflow-status" data-tone={regionStatus.tone}><span><ScanSearch /></span><div><strong>{regionStatus.title}</strong><small>{regionStatus.detail}</small></div></div>}
    </div>

    <Sheet open={openSheet === 'info'} onOpenChange={(open) => setOpenSheet(open ? 'info' : null)}>
      <SheetContent className="editor-sheet">
        <SheetHeader><SheetTitle>谱面信息</SheetTitle><SheetDescription>管理谱面、歌曲信息与关联媒体。</SheetDescription></SheetHeader>
        <div className="editor-sheet-scroll">
          <section className="sheet-section">
            <div className="sheet-section-heading"><span><Library /></span><div><h3>谱面库</h3><p>{libraryReady ? `${charts.length} 份谱面` : '正在读取谱面库…'} · {storageStatus === 'saving' ? '正在保存' : storageStatus === 'error' ? '保存失败' : '已自动保存'}</p></div></div>
            <div className="sheet-inline-actions"><Button variant="outline" size="sm" onClick={() => void revealLibrary()}><FolderOpen />存储位置</Button><Button size="sm" onClick={() => void createChart()}><Plus />新建谱面</Button></div>
            <div className="sheet-chart-list">{charts.map((item) => <div key={item.id} className={item.id === activeChartId ? 'active' : ''}><button disabled={item.id === activeChartId} onClick={() => void selectChart(item.id)}><strong>{item.title || '未命名谱面'}</strong><small>{item.artist || '未知艺术家'} · {item.noteCount} NOTES</small></button><Button variant="ghost" size="icon-sm" title="删除谱面" onClick={() => setDeleteId(item.id)}><Trash2 /></Button></div>)}</div>
          </section>
          <section className="sheet-section">
            <div className="sheet-section-heading"><span><Music2 /></span><div><h3>歌曲信息</h3><p>修改节奏参数时会保持音符相对节拍位置。</p></div></div>
            <div className="config-form">
              <label><span>歌曲标题</span><Input value={chart.title} onChange={(event) => setChart((current) => ({ ...current, title: event.target.value }))} /></label>
              <label><span>艺术家</span><Input value={chart.artist} placeholder="Unknown artist" onChange={(event) => setChart((current) => ({ ...current, artist: event.target.value }))} /></label>
              <label><span>BPM</span><Input inputMode="decimal" value={bpmDraft} onChange={(event) => { const raw = event.target.value; setBpmDraft(raw); if (raw !== '') applyBpm(Number(raw)) }} onBlur={() => { const value = Number(bpmDraft); if (bpmDraft === '' || !Number.isFinite(value) || value < BPM_MIN || value > BPM_MAX) { showToast(`BPM 需在 ${BPM_MIN}–${BPM_MAX} 之间`); setBpmDraft(String(chart.bpm)) } }} /></label>
              <label><span>谱面偏移（ms）</span><Input inputMode="numeric" value={offsetDraft} onChange={(event) => { const raw = event.target.value; setOffsetDraft(raw); if (raw !== '' && Number.isFinite(Number(raw))) applyOffset(Number(raw)) }} onBlur={() => { if (offsetDraft === '' || !Number.isFinite(Number(offsetDraft))) { showToast('偏移值必须是有效毫秒数'); setOffsetDraft(String(chart.offset)) } }} /></label>
            </div>
            <button className="audio-drop" onClick={() => void chooseAudio()}><span className="audio-icon"><Upload /></span><span><strong>{chart.audioName || '上传音频文件'}</strong><small>MP3、WAV、OGG、M4A 或 FLAC</small></span><b>{chart.audioName ? '替换' : '上传'}</b></button>
            <div className="managed-media-row"><button className="audio-drop" onClick={() => void chooseBackground()}><span className="audio-icon"><ImagePlus /></span><span><strong>{chart.backgroundName || '上传试玩背景'}</strong><small>图片或 MP4 / WebM 视频</small></span><b>{chart.backgroundName ? '替换' : '上传'}</b></button>{chart.backgroundName && <Button variant="outline" size="icon" title="移除背景" onClick={() => void removeBackground()}><X /></Button>}</div>
          </section>
        </div>
        <SheetFooter className="editor-sheet-footer"><Button variant="outline" onClick={() => void loadChart()}><FileUp />导入谱面</Button><Button onClick={() => void saveChart()}><Save />导出谱面</Button></SheetFooter>
      </SheetContent>
    </Sheet>

    <Sheet open={openSheet === 'settings'} onOpenChange={(open) => setOpenSheet(open ? 'settings' : null)}>
      <SheetContent className="editor-sheet">
        <SheetHeader><SheetTitle>谱面设置</SheetTitle><SheetDescription>调整当前编辑器的时间轴显示与操作偏好。</SheetDescription></SheetHeader>
        <div className="editor-sheet-scroll">
          <section className="sheet-section">
            <div className="sheet-section-heading"><span><SlidersHorizontal /></span><div><h3>时间轴布局</h3><p>只影响编辑区域，不改变谱面内容与试玩画面。</p></div></div>
            <label className="slider-setting"><span><strong>判定线高度</strong><small>判定线距离编辑区域底部的位置</small></span><div><Slider min={100} max={360} step={10} value={[preferences.judgmentLineHeight]} onValueChange={([judgmentLineHeight]) => setPreferences((current) => ({ ...current, judgmentLineHeight }))} /><output>{preferences.judgmentLineHeight}px</output></div></label>
            <label className="slider-setting"><span><strong>轨道缩放</strong><small>也可以按住 Ctrl 并滚动轨道</small></span><div><Slider min={90} max={1320} step={10} value={[chart.settings.editorZoom]} onValueChange={([editorZoom]) => setChart((current) => ({ ...current, settings: { ...current.settings, editorZoom } }))} /><output>{Math.round(chart.settings.editorZoom / 2.3)}%</output></div></label>
          </section>
          <section className="sheet-section">
            <div className="sheet-section-heading"><span><Play /></span><div><h3>当前状态</h3><p>{chart.notes.length} 个音符 · {formatTime(currentTime)} / {formatTime(chart.duration)}</p></div></div>
          </section>
        </div>
      </SheetContent>
    </Sheet>

    <Sheet open={openSheet === 'playtest'} onOpenChange={(open) => setOpenSheet(open ? 'playtest' : null)}>
      <SheetContent className="editor-sheet playtest-entry-sheet">
        <SheetHeader><SheetTitle>谱面试玩</SheetTitle><SheetDescription>选择这次试玩的开始位置。</SheetDescription></SheetHeader>
        <div className="playtest-entry-options">
          <button onClick={() => void startPlaytest(false)}><span><Play /></span><div><strong>从当前位置开始</strong><small>{formatTime(currentTime)} · 跳过此前音符</small></div></button>
          <button onClick={() => void startPlaytest(true)}><span><Gamepad2 /></span><div><strong>从头开始</strong><small>00:00.000 · 完整试玩整份谱面</small></div></button>
        </div>
      </SheetContent>
    </Sheet>

    <AlertDialog open={Boolean(deleteId)} onOpenChange={(open) => { if (!open) setDeleteId('') }}>
      <AlertDialogContent><AlertDialogHeader><AlertDialogTitle>删除这份谱面？</AlertDialogTitle><AlertDialogDescription>谱面数据与内部保存的音频、背景媒体都会被永久删除。此操作无法撤销。</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>取消</AlertDialogCancel><AlertDialogAction variant="destructive" onClick={() => { const id = deleteId; setDeleteId(''); void deleteChart(id) }}>删除谱面</AlertDialogAction></AlertDialogFooter></AlertDialogContent>
    </AlertDialog>
  </div>
}
