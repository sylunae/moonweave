import { EffectsModule, useEffectsEditor } from '@/features/chart/effects/EffectsModule'
import { shiftChartOffset } from '@/features/chart/editHistory'
import { editorEffects } from '@/config/app'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  BookOpen, ClipboardPaste, Copy, FlipHorizontal2, Gamepad2, Gauge, ImagePlus,
  LogOut, Music2, Pause, Play, Plus, Redo2, ScanSearch, SlidersHorizontal, Trash2,
  Undo2, Upload, X, Sparkles,
} from 'lucide-react'
import { navigate } from '@/app/navigation'
import { useI18n } from '@/app/i18n'
import { usePreferences } from '@/app/preferences'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Slider } from '@/components/ui/slider'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { ChartEditor } from '@/features/chart/ChartEditor'
import { useChart } from '@/features/chart/ChartProvider'
import { adjacentBeatLine, bpmAtTime, retimeInitialBpm, snapToBeatLine } from '@/features/chart/tempoMap'
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
const playCopyConfirmation = () => {
  try {
    const context = new AudioContext()
    const oscillator = context.createOscillator()
    const gain = context.createGain()
    oscillator.type = 'sine'
    oscillator.frequency.setValueAtTime(1174, context.currentTime)
    gain.gain.setValueAtTime(0.0001, context.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.12, context.currentTime + 0.01)
    gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.14)
    oscillator.connect(gain).connect(context.destination)
    oscillator.start()
    oscillator.stop(context.currentTime + 0.15)
    window.setTimeout(() => void context.close(), 180)
  } catch { /* Audio feedback is optional. */ }
}

export default function ChartEditorPage() {
  const { text } = useI18n()
  const {
    chart, setChart, commitEdit, activeChartId, storageStatus, coverUrl, currentTime, setCurrentTime,
    isPlaying, historyLength, futureLength, commitNotes, undo, redo, flushActiveChart, togglePlay,
    chooseAudio, chooseBackground, removeBackground, chooseCover, removeCover, showToast,
  } = useChart()
  const { preferences, setPreferences } = usePreferences()
  const playbackRate = preferences.playbackRate
  const [subdivision, setSubdivision] = useState<(typeof SUBDIVISIONS)[number]>(4)
  const [tool, setTool] = useState<ToolMode>('note')
  const effectsEditor = useEffectsEditor(tool, (tool) => { setTool(tool); setHoldStart(null); setRegion(null); setSelectedIds(new Set()) })
  const [holdStart, setHoldStart] = useState<{ lane: number; time: number } | null>(null)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [region, setRegion] = useState<{ start: number; end: number | null } | null>(null)
  const [clipboard, setClipboard] = useState<{ start: number; notes: ChartNote[] } | null>(null)
  const [actionFeedback, setActionFeedback] = useState<{ id: number; tone: 'action' | 'empty' | 'ready'; title: string; detail: string } | null>(null)
  const feedbackTimerRef = useRef(0)
  const feedbackIdRef = useRef(0)
  const [openSheet, setOpenSheet] = useState<'info' | 'tempo' | 'settings' | 'playtest' | null>(null)
  const [tempoTime, setTempoTime] = useState<number | null>(null)
  const [tempoDraft, setTempoDraft] = useState('')
  const [bpmDraft, setBpmDraft] = useState(String(chart.bpm))
  const [offsetDraft, setOffsetDraft] = useState(String(chart.offset))
  const [backgroundVideoStartDraft, setBackgroundVideoStartDraft] = useState(String(chart.backgroundVideoStartTime))
  const regionNotes = useMemo(() => !region || region.end === null ? [] : notesInRegion(chart.notes, region.start, region.end), [chart.notes, region])
  const selectedNotes = useMemo(() => chart.notes.filter((note) => selectedIds.has(note.id)), [chart.notes, selectedIds])
  const regionStatus = useMemo(() => {
    if (effectsEditor.status) return effectsEditor.status
    if (actionFeedback) return actionFeedback
    if (tool === 'tempo') return { tone: 'action', title: text('选择 BPM 变化位置', 'Choose a BPM change position'), detail: text('点击轨道上的目标节拍线，然后输入从该位置开始使用的 BPM。', 'Click the target beat line, then enter the BPM to use from that point.') }
    if (tool !== 'region') return null
    if (!region) return { tone: 'action', title: text('选择区域起点', 'Choose the region start'), detail: text('点击轨道上的一条节拍线作为区域起点。', 'Click a beat line to set the start of the region.') }
    if (region.end === null) return { tone: 'action', title: text('继续选择区域终点', 'Choose the region end'), detail: text(`起点 ${formatTime(region.start)}，现在点击另一条节拍线。`, `Start ${formatTime(region.start)}; now click another beat line.`) }
    if (!regionNotes.length) return { tone: 'empty', title: text('所选区域没有音符', 'No notes in this region'), detail: text('请重新选择包含音符的范围，之后才能复制或镜像。', 'Select a range containing notes before copying or mirroring.') }
    return { tone: 'ready', title: text(`已选择 ${regionNotes.length} 个音符`, `${regionNotes.length} notes selected`), detail: text('现在可以复制或镜像这些音符。', 'You can now copy or mirror these notes.') }
  }, [effectsEditor.status, actionFeedback, clipboard, region, regionNotes.length, text, tool])

  useEffect(() => setBpmDraft(String(chart.bpm)), [chart.bpm])
  useEffect(() => setOffsetDraft(String(chart.offset)), [chart.offset])
  useEffect(() => setBackgroundVideoStartDraft(String(chart.backgroundVideoStartTime)), [chart.backgroundVideoStartTime])
  useEffect(() => () => window.clearTimeout(feedbackTimerRef.current), [])

  const showEditorFeedback = useCallback((title: string, detail: string, tone: 'action' | 'empty' | 'ready' = 'ready') => {
    window.clearTimeout(feedbackTimerRef.current)
    setActionFeedback({ id: feedbackIdRef.current += 1, tone, title, detail })
    feedbackTimerRef.current = window.setTimeout(() => setActionFeedback(null), 5000)
  }, [])

  const applyBpm = (value: number) => {
    if (!Number.isFinite(value) || value < BPM_MIN || value > BPM_MAX) return
    commitEdit((previous) => retimeInitialBpm(previous, value))
  }
  const applyOffset = (value: number) => {
    if (!Number.isFinite(value)) return
    try { commitEdit((previous) => shiftChartOffset(previous, value)) }
    catch { showToast(text('偏移不能将事件移到谱面起点之前', 'Offset cannot move events before the chart start')); setOffsetDraft(String(chart.offset)) }
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
  const copySelection = useCallback(() => {
    if (!selectedNotes.length) return
    const start = Math.min(...selectedNotes.map((note) => note.time))
    setClipboard({ start, notes: selectedNotes.map((note) => ({ ...note })) })
    setSelectedIds(new Set()); setRegion(null); setTool('note')
    playCopyConfirmation()
    showEditorFeedback(text('已复制到粘贴板', 'Copied to clipboard'), text(`${selectedNotes.length} 个音符已就绪；点击粘贴后选择目标节拍线。`, `${selectedNotes.length} notes are ready; paste at the target beat line.`))
  }, [selectedNotes, showEditorFeedback, text])
  const pasteClipboard = useCallback((time: number) => {
    if (!clipboard?.notes.length) return
    const delta = time - clipboard.start
    if (clipboard.notes.some((note) => note.time + delta < 0 || (note.endTime ?? note.time) + delta > chart.duration)) { showEditorFeedback(text('无法粘贴到这里', 'Cannot paste here'), text('目标位置超出谱面时长，请选择另一条节拍线。', 'The target is outside the chart duration; choose another beat line.'), 'empty'); return }
    const pasted = clipboard.notes.map((note) => ({ ...note, id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`, time: note.time + delta, endTime: note.endTime === undefined ? undefined : note.endTime + delta }))
    commitNotes([...chart.notes, ...pasted]); setSelectedIds(new Set(pasted.map((note) => note.id))); setRegion(null); setTool('note'); showEditorFeedback(text('已粘贴音符', 'Notes pasted'), text(`${pasted.length} 个音符已粘贴并保持选中。`, `${pasted.length} notes pasted and kept selected.`))
  }, [chart.duration, chart.notes, clipboard, commitNotes, showEditorFeedback, text])
  const pasteAtCurrentBeat = useCallback(() => {
    if (!clipboard?.notes.length) return
    pasteClipboard(snapToBeatLine(chart, currentTime, subdivision))
  }, [chart, clipboard, currentTime, pasteClipboard, subdivision])
  const mirrorSelection = useCallback(() => {
    if (!selectedNotes.length) return
    const ids = new Set(selectedNotes.map((note) => note.id))
    commitNotes(chart.notes.map((note) => ids.has(note.id) ? { ...note, lane: 3 - note.lane } : note)); showEditorFeedback(text('已镜像音符', 'Notes mirrored'), text(`${ids.size} 个音符已左右镜像。`, `${ids.size} notes mirrored horizontally.`))
  }, [chart.notes, commitNotes, selectedNotes, showEditorFeedback, text])
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
  const chooseTempoLine = useCallback((time: number) => {
    const existing = chart.bpmChanges.find((change) => Math.abs(change.time - time) < 0.01)
    setTempoTime(time)
    setTempoDraft(String(existing?.bpm ?? bpmAtTime(chart, time)))
  }, [chart])
  const saveTempoChange = useCallback(() => {
    if (tempoTime === null) return
    const bpm = Number(tempoDraft)
    if (!Number.isFinite(bpm) || bpm < BPM_MIN || bpm > BPM_MAX) { showToast(text(`BPM 需在 ${BPM_MIN}–${BPM_MAX} 之间`, `BPM must be between ${BPM_MIN} and ${BPM_MAX}`)); return }
    commitEdit((previous) => ({
      ...previous,
      bpmChanges: [...previous.bpmChanges.filter((change) => Math.abs(change.time - tempoTime) >= 0.01), { time: tempoTime, bpm }].sort((a, b) => a.time - b.time),
    }))
    setTempoTime(null); setTool('note'); showToast(text(`已在 ${formatTime(tempoTime)} 设置 ${bpm} BPM`, `Set ${bpm} BPM at ${formatTime(tempoTime)}`))
  }, [commitEdit, showToast, tempoDraft, tempoTime, text])
  const deleteTempoChange = useCallback((time: number) => {
    commitEdit((previous) => ({ ...previous, bpmChanges: previous.bpmChanges.filter((change) => Math.abs(change.time - time) >= 0.01) }))
    setTempoTime(null); showToast(text('已删除 BPM 变化点', 'BPM change removed'))
  }, [commitEdit, showToast, text])
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
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault()
        void flushActiveChart().then((saved) => { if (saved) showToast(text('已保存到内部谱面库', 'Saved to the local chart library')) })
        return
      }
      if (editing) return
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); event.shiftKey ? redo() : undo(); return }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a') { event.preventDefault(); setRegion(null); setSelectedIds(new Set(chart.notes.map((note) => note.id))); return }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'c' && selectedNotes.length) { event.preventDefault(); copySelection(); return }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'v' && clipboard) { event.preventDefault(); pasteAtCurrentBeat(); return }
      if (event.repeat) return
      if (event.code === 'KeyQ') { event.preventDefault(); void togglePlay(playbackRate, subdivision) }
      if (event.code === 'Delete' && selectedIds.size) { event.preventDefault(); deleteSelection() }
      if (event.code === 'ArrowUp') { event.preventDefault(); setCurrentTime(adjacentBeatLine(chart, currentTime, subdivision, 1)) }
      if (event.code === 'ArrowDown') { event.preventDefault(); setCurrentTime(adjacentBeatLine(chart, currentTime, subdivision, -1)) }
      if (event.code === 'Space') { event.preventDefault(); setCurrentTime(adjacentBeatLine(chart, currentTime, 1, 1)) }
    }
    window.addEventListener('keydown', keydown)
    return () => window.removeEventListener('keydown', keydown)
  }, [chart, clipboard, copySelection, currentTime, deleteSelection, flushActiveChart, pasteAtCurrentBeat, playbackRate, redo, selectedIds.size, selectedNotes.length, setCurrentTime, showToast, subdivision, text, togglePlay, undo])

  if (!activeChartId) return <div className="editor-empty page-enter"><BookOpen /><h1>{text('未选择谱面', 'No chart selected')}</h1><Button onClick={() => navigate('manage')}>{text('前往我的谱面', 'Go to My Charts')}</Button></div>

  return <div className="editor-page page-enter">
    <div className="editor-workspace">
      <ChartEditor
        chart={chart} currentTime={currentTime} subdivision={subdivision} tool={tool} holdStart={holdStart}
        selectedIds={selectedIds} region={region} isPlaying={isPlaying} onSeek={setCurrentTime}
        onNotesChange={commitNotes} onHoldStart={setHoldStart} onSelectionChange={setSelectedIds}
        onRegionLine={chooseRegionLine} onTempoLine={chooseTempoLine} onEffectLine={effectsEditor.onLine} onEffectEdit={effectsEditor.edit}
        onZoomChange={(editorZoom) => setChart((current) => ({ ...current, settings: { ...current.settings, editorZoom } }))}
        onSubdivisionChange={changeSubdivision}
      />

      <aside className="editor-action-rail editor-action-rail-left" aria-label={text('常用编辑操作', 'Common editing actions')}>
        <button className="editor-action primary" onClick={() => void togglePlay(playbackRate, subdivision)}><span>{isPlaying ? <Pause /> : <Play />}</span><b>{isPlaying ? text('暂停', 'Pause') : text('播放', 'Play')}</b></button>
        <button className={`editor-action${tool === 'region' ? ' active' : ''}`} onClick={startRegionSelection}><span><ScanSearch /></span><b>{text('区域', 'Region')}</b></button>
        <button className={`editor-action danger${tool === 'delete' ? ' active' : ''}`} onClick={deleteSelection}><span><Trash2 /></span><b>{text('删除', 'Delete')}</b></button>
        <div className="editor-compact-actions">
          <Tooltip><TooltipTrigger asChild><span><button disabled={!selectedNotes.length} onClick={copySelection} aria-label={text('复制选中音符', 'Copy selected notes')}><Copy /></button></span></TooltipTrigger><TooltipContent side="right" sideOffset={9}>{selectedNotes.length ? text(`复制选中的 ${selectedNotes.length} 个音符`, `Copy ${selectedNotes.length} selected notes`) : text('请选择要复制的音符', 'Select notes to copy')}</TooltipContent></Tooltip>
          <Tooltip><TooltipTrigger asChild><span><button disabled={!clipboard?.notes.length} onClick={pasteAtCurrentBeat} aria-label={text('粘贴到当前判定线', 'Paste at the current judgment line')}><ClipboardPaste /></button></span></TooltipTrigger><TooltipContent side="right" sideOffset={9}>{clipboard?.notes.length ? text(`粘贴 ${clipboard.notes.length} 个音符到当前判定线`, `Paste ${clipboard.notes.length} notes at the current judgment line`) : text('复制音符后可粘贴', 'Copy notes before pasting')}</TooltipContent></Tooltip>
          <Tooltip><TooltipTrigger asChild><span><button disabled={!selectedNotes.length} onClick={mirrorSelection} aria-label={text('镜像选中音符', 'Mirror selected notes')}><FlipHorizontal2 /></button></span></TooltipTrigger><TooltipContent side="right" sideOffset={9}>{selectedNotes.length ? text(`镜像选中的 ${selectedNotes.length} 个音符`, `Mirror ${selectedNotes.length} selected notes`) : text('请选择要镜像的音符', 'Select notes to mirror')}</TooltipContent></Tooltip>
        </div>
        {/* <small className="region-action-explain">{selectedNotes.length ? `已选中 ${selectedNotes.length} 个音符，可复制或镜像` : clipboard ? `粘贴板中有 ${clipboard.notes.length} 个音符` : '选择音符或区域后即可复制、镜像'}</small> */}
        <div className="editor-compact-actions">
          <Tooltip><TooltipTrigger asChild><span><button disabled={!historyLength} onClick={undo} aria-label={text('撤回', 'Undo')}><Undo2 /></button></span></TooltipTrigger><TooltipContent side="right" sideOffset={9}>{text('撤回', 'Undo')}</TooltipContent></Tooltip>
          <Tooltip><TooltipTrigger asChild><span><button disabled={!futureLength} onClick={redo} aria-label={text('重做', 'Redo')}><Redo2 /></button></span></TooltipTrigger><TooltipContent side="right" sideOffset={9}>{text('重做', 'Redo')}</TooltipContent></Tooltip>
        </div>
        <div className="playback-rate">{PLAYBACK_RATES.map((rate) => <button key={rate} className={playbackRate === rate ? 'active' : ''} onClick={() => setPreferences((current) => ({ ...current, playbackRate: rate }))}>{rate}×</button>)}</div>
      </aside>

      <aside className="editor-action-rail editor-action-rail-right" aria-label={text('音符工具', 'Note tools')}>
        <button className={`editor-action${tool === 'note' ? ' active' : ''}`} onClick={() => resetToolContext('note')}><span className="note-glyph tap" /><b>NOTE</b></button>
        <button className={`editor-action${tool === 'hold' ? ' active' : ''}`} onClick={() => resetToolContext('hold')}><span className="note-glyph hold" /><b>HOLD</b></button>
      </aside>

      <aside className="editor-utility-dock intro" aria-label={text('编辑器工具栏', 'Editor toolbar')}>
        <Tooltip><TooltipTrigger asChild><button onClick={() => setOpenSheet('info')} aria-label={text('谱面信息', 'Chart info')}><span className="editor-dock-label">{text('谱面信息', 'Chart info')}</span><BookOpen /></button></TooltipTrigger><TooltipContent side="left" sideOffset={9}>{text('谱面信息', 'Chart info')}</TooltipContent></Tooltip>
        <Tooltip><TooltipTrigger asChild><button onClick={() => setOpenSheet('tempo')} aria-label={text('BPM 变化', 'BPM changes')}><span className="editor-dock-label">{text('BPM 变化', 'BPM changes')}</span><Gauge /></button></TooltipTrigger><TooltipContent side="left" sideOffset={9}>{text('BPM 变化', 'BPM changes')}</TooltipContent></Tooltip>
        <Tooltip><TooltipTrigger asChild><button onClick={() => effectsEditor.setOpen(true)} aria-label={text(editorEffects.title.zh, editorEffects.title.en)}><span className="editor-dock-label">{text(editorEffects.title.zh, editorEffects.title.en)}</span><Sparkles /></button></TooltipTrigger><TooltipContent side="left" sideOffset={9}>{text(editorEffects.title.zh, editorEffects.title.en)}</TooltipContent></Tooltip>
        <Tooltip><TooltipTrigger asChild><button onClick={() => setOpenSheet('settings')} aria-label={text('谱面设置', 'Chart settings')}><span className="editor-dock-label">{text('谱面设置', 'Chart settings')}</span><SlidersHorizontal /></button></TooltipTrigger><TooltipContent side="left" sideOffset={9}>{text('谱面设置', 'Chart settings')}</TooltipContent></Tooltip>
        <Tooltip><TooltipTrigger asChild><button onClick={() => void flushActiveChart().finally(() => navigate('manage'))} aria-label={text('退出编辑器', 'Exit editor')}><span className="editor-dock-label">{text('退出编辑器', 'Exit editor')}</span><LogOut /></button></TooltipTrigger><TooltipContent side="left" sideOffset={9}>{text('退出编辑器', 'Exit editor')}</TooltipContent></Tooltip>
      </aside>
      <Button className="editor-playtest-cta" onClick={() => setOpenSheet('playtest')}><Gamepad2 />{text('谱面试玩', 'Playtest')}</Button>
      {regionStatus && <div key={actionFeedback?.id} className="region-workflow-status" data-tone={regionStatus.tone} data-feedback={Boolean(actionFeedback)}><span><ScanSearch /></span><div><strong>{regionStatus.title}</strong><small>{regionStatus.detail}</small></div></div>}
    </div>

    <EffectsModule editor={effectsEditor} />

    <Sheet open={openSheet === 'info'} onOpenChange={(open) => setOpenSheet(open ? 'info' : null)}>
      <SheetContent className="editor-sheet">
        <SheetHeader><SheetTitle>{text('谱面信息', 'Chart info')}</SheetTitle><SheetDescription>{storageStatus === 'saving' ? text('正在保存到内部谱面库', 'Saving to the local chart library') : storageStatus === 'error' ? text('内部保存失败', 'Local save failed') : text('已自动保存到内部谱面库', 'Autosaved to the local chart library')}</SheetDescription></SheetHeader>
        <div className="editor-sheet-scroll">
          <section className="sheet-section">
            <div className="sheet-section-heading"><span><Music2 /></span><div><h3>{text('歌曲信息', 'Song info')}</h3><p>{text('修改初始 BPM 时会保持音符相对节拍位置。', 'Changing the initial BPM preserves each note’s relative beat position.')}</p></div></div>
            <div className="config-form">
              <label><span>{text('歌曲标题', 'Song title')}</span><Input value={chart.title} onChange={(event) => setChart((current) => ({ ...current, title: event.target.value }))} /></label>
              <label><span>{text('艺术家', 'Artist')}</span><Input value={chart.artist} placeholder="Unknown artist" onChange={(event) => setChart((current) => ({ ...current, artist: event.target.value }))} /></label>
              <label><span>{text('初始 BPM', 'Initial BPM')}</span><Input inputMode="decimal" value={bpmDraft} onChange={(event) => { const raw = event.target.value; setBpmDraft(raw) }} onBlur={() => { const value = Number(bpmDraft); if (bpmDraft === '' || !Number.isFinite(value) || value < BPM_MIN || value > BPM_MAX) { showToast(text(`BPM 需在 ${BPM_MIN}–${BPM_MAX} 之间`, `BPM must be between ${BPM_MIN} and ${BPM_MAX}`)); setBpmDraft(String(chart.bpm)) } else applyBpm(value) }} /></label>
              <label><span>{text('谱面偏移（ms）', 'Chart offset (ms)')}</span><Input inputMode="numeric" value={offsetDraft} onChange={(event) => { const raw = event.target.value; setOffsetDraft(raw) }} onBlur={() => { if (offsetDraft === '' || !Number.isFinite(Number(offsetDraft))) { showToast(text('偏移值必须是有效毫秒数', 'Offset must be a valid millisecond value')); setOffsetDraft(String(chart.offset)) } else applyOffset(Number(offsetDraft)) }} /></label>
            </div>
            <button className="audio-drop" onClick={() => void chooseAudio()}><span className="audio-icon"><Upload /></span><span><strong>{chart.audioName || text('上传音频文件', 'Upload audio file')}</strong><small>{text('MP3、WAV、OGG、M4A 或 FLAC', 'MP3, WAV, OGG, M4A, or FLAC')}</small></span><b>{chart.audioName ? text('替换', 'Replace') : text('上传', 'Upload')}</b></button>
            <div className="managed-media-row"><button className="audio-drop" onClick={() => void chooseBackground()}><span className="audio-icon"><ImagePlus /></span><span><strong>{chart.backgroundName || text('上传试玩背景', 'Upload playtest background')}</strong><small>{text('图片或 MP4 / WebM 视频', 'Image or MP4 / WebM video')}</small></span><b>{chart.backgroundName ? text('替换', 'Replace') : text('上传', 'Upload')}</b></button>{chart.backgroundName && <Button variant="outline" size="icon" title={text('移除背景', 'Remove background')} onClick={() => void removeBackground()}><X /></Button>}</div>
            {chart.backgroundType === 'video' && <label className="video-start-setting"><span><strong>{text('视频起始偏移（ms）', 'Video start offset (ms)')}</strong><small>{text('正数延后开始，负数提前播放', 'Positive values delay playback; negative values start early')}</small></span><Input inputMode="numeric" value={backgroundVideoStartDraft} onChange={(event) => setBackgroundVideoStartDraft(event.target.value)} onBlur={() => { const value = Number(backgroundVideoStartDraft); if (!Number.isFinite(value)) { showToast(text('视频起始偏移必须是有效毫秒数', 'Video start offset must be a valid millisecond value')); setBackgroundVideoStartDraft(String(chart.backgroundVideoStartTime)); return } const backgroundVideoStartTime = Math.round(value); setBackgroundVideoStartDraft(String(backgroundVideoStartTime)); setChart((current) => ({ ...current, backgroundVideoStartTime })) }} /></label>}
            <div className="managed-media-row"><button className="audio-drop" onClick={() => void chooseCover()}><span className="audio-icon cover-preview">{coverUrl ? <img src={coverUrl} alt="" /> : <ImagePlus />}</span><span><strong>{chart.coverName || text('上传曲目封面', 'Upload cover art')}</strong><small>{text('PNG、JPG、WebP 或 AVIF', 'PNG, JPG, WebP, or AVIF')}</small></span><b>{chart.coverName ? text('替换', 'Replace') : text('上传', 'Upload')}</b></button>{chart.coverName && <Button variant="outline" size="icon" title={text('移除封面', 'Remove cover')} onClick={() => void removeCover()}><X /></Button>}</div>
          </section>
        </div>
      </SheetContent>
    </Sheet>

    <Sheet open={openSheet === 'tempo'} onOpenChange={(open) => setOpenSheet(open ? 'tempo' : null)}>
      <SheetContent className="editor-sheet">
        <SheetHeader><SheetTitle>{text('BPM 变化', 'BPM changes')}</SheetTitle><SheetDescription>{text('在任意节拍线上设置从该位置开始生效的 BPM。', 'Set a BPM on any beat line that takes effect from that point.')}</SheetDescription></SheetHeader>
        <div className="editor-sheet-scroll">
          <section className="sheet-section">
            <div className="sheet-section-heading"><span><Gauge /></span><div><h3>{text('BPM 时间轴', 'Tempo timeline')}</h3><p>{chart.bpmChanges.length ? text(`已有 ${chart.bpmChanges.length} 个 BPM 变化点`, `${chart.bpmChanges.length} BPM changes`) : text('当前谱面使用固定 BPM', 'This chart uses a fixed BPM')}</p></div></div>
            <Button className="tempo-add-button" onClick={() => { setOpenSheet(null); resetToolContext('tempo') }}><Plus />{text('选择节拍线添加 BPM 变化', 'Choose a beat line to add a BPM change')}</Button>
            <div className="tempo-change-list">{chart.bpmChanges.length ? chart.bpmChanges.map((change) => <div key={change.time}><button onClick={() => { setCurrentTime(change.time); setOpenSheet(null); chooseTempoLine(change.time) }}><time>{formatTime(change.time)}</time><strong>{change.bpm} BPM</strong></button><Button variant="ghost" size="icon-sm" title={text('删除 BPM 变化点', 'Delete BPM change')} onClick={() => deleteTempoChange(change.time)}><Trash2 /></Button></div>) : <p>{text('点击上方按钮，再选择轨道中的目标节拍线。', 'Click the button above, then choose the target beat line in the lanes.')}</p>}</div>
          </section>
        </div>
      </SheetContent>
    </Sheet>

    <Sheet open={openSheet === 'settings'} onOpenChange={(open) => setOpenSheet(open ? 'settings' : null)}>
      <SheetContent className="editor-sheet">
        <SheetHeader><SheetTitle>{text('谱面设置', 'Chart settings')}</SheetTitle><SheetDescription>{text('调整当前编辑器的时间轴显示与操作偏好。', 'Adjust the current editor timeline and interaction preferences.')}</SheetDescription></SheetHeader>
        <div className="editor-sheet-scroll">
          <section className="sheet-section">
            <div className="sheet-section-heading"><span><SlidersHorizontal /></span><div><h3>{text('时间轴布局', 'Timeline layout')}</h3><p>{text('只影响编辑区域，不改变谱面内容与试玩画面。', 'Only affects the editor and does not change chart content or playtesting.')}</p></div></div>
            <label className="slider-setting"><span><strong>{text('判定线高度', 'Judgment line height')}</strong><small>{text('判定线距离编辑区域底部的位置', 'Distance of the judgment line from the bottom of the editor')}</small></span><div><Slider min={100} max={360} step={10} value={[preferences.judgmentLineHeight]} onValueChange={([judgmentLineHeight]) => setPreferences((current) => ({ ...current, judgmentLineHeight }))} /><output>{preferences.judgmentLineHeight}px</output></div></label>
            <label className="slider-setting"><span><strong>{text('轨道缩放', 'Lane zoom')}</strong><small>{text('也可以按住 Ctrl 并滚动轨道', 'You can also hold Ctrl and scroll over the lanes')}</small></span><div><Slider min={90} max={1320} step={10} value={[chart.settings.editorZoom]} onValueChange={([editorZoom]) => setChart((current) => ({ ...current, settings: { ...current.settings, editorZoom } }))} /><output>{Math.round(chart.settings.editorZoom / 2.3)}%</output></div></label>
          </section>
          <section className="sheet-section">
            <div className="sheet-section-heading"><span><Play /></span><div><h3>{text('当前状态', 'Current status')}</h3><p>{text(`${chart.notes.length} 个音符`, `${chart.notes.length} notes`)} · {formatTime(currentTime)} / {formatTime(chart.duration)}</p></div></div>
          </section>
        </div>
      </SheetContent>
    </Sheet>

    <Sheet open={openSheet === 'playtest'} onOpenChange={(open) => setOpenSheet(open ? 'playtest' : null)}>
      <SheetContent className="editor-sheet playtest-entry-sheet">
        <SheetHeader><SheetTitle>{text('谱面试玩', 'Playtest')}</SheetTitle><SheetDescription>{text('选择这次试玩的开始位置。', 'Choose where to begin this playtest.')}</SheetDescription></SheetHeader>
        <div className="playtest-entry-options">
          <button onClick={() => void startPlaytest(false)}><span><Play /></span><div><strong>{text('从当前位置开始', 'Start at current position')}</strong><small>{formatTime(currentTime)} · {text('跳过此前音符', 'Skip earlier notes')}</small></div></button>
          <button onClick={() => void startPlaytest(true)}><span><Gamepad2 /></span><div><strong>{text('从头开始', 'Start from beginning')}</strong><small>00:00.000 · {text('完整试玩整份谱面', 'Play the full chart')}</small></div></button>
        </div>
      </SheetContent>
    </Sheet>

    <Dialog open={tempoTime !== null} onOpenChange={(open) => { if (!open) setTempoTime(null) }}>
      <DialogContent className="tempo-dialog">
        <DialogHeader><DialogTitle>{text('设置 BPM 变化', 'Set BPM change')}</DialogTitle><DialogDescription>{tempoTime === null ? '' : text(`从 ${formatTime(tempoTime)} 的节拍线开始使用新 BPM。`, `Use the new BPM from the beat line at ${formatTime(tempoTime)}.`)}</DialogDescription></DialogHeader>
        <label><span>BPM</span><Input autoFocus inputMode="decimal" value={tempoDraft} onChange={(event) => setTempoDraft(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') saveTempoChange() }} /></label>
        <DialogFooter>{tempoTime !== null && chart.bpmChanges.some((change) => Math.abs(change.time - tempoTime) < 0.01) && <Button variant="destructive" onClick={() => deleteTempoChange(tempoTime)}>{text('删除 BPM 变化点', 'Delete BPM change')}</Button>}<Button variant="outline" onClick={() => setTempoTime(null)}>{text('取消', 'Cancel')}</Button><Button onClick={saveTempoChange}>{text('保存', 'Save')}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </div>
}
