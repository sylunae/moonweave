import { EffectsModule, useEffectsEditor } from '@/features/chart/effects/EffectsModule'
import { normalizeEffects, type ChartEffect } from '@/features/chart/effects/scrollSpeed'
import { shiftChartOffset } from '@/features/chart/editHistory'
import { aiChartCopy, backgroundVideoPreviewCopy, editorEffects, improvisationCopy, noteImportTitle, notePropertiesCopy, redZoneCopy } from '@/config/app'
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import {
  ArrowLeft, BookOpen, ClipboardPaste, Copy, FlipHorizontal2, Gamepad2, Gauge, ImagePlus,
  Music2, Pause, Play, Plus, Redo2, ScanSearch, SlidersHorizontal, Trash2,
  Undo2, Upload, X, Sparkles, FileJson, FileUp,
} from 'lucide-react'
import { navigate } from '@/app/navigation'
import { isTouchWeb, useMobileBack } from '@/app/mobileBack'
import { useI18n } from '@/app/i18n'
import { usePreferences } from '@/app/preferences'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { GameButton } from '@/components/ui/game-controls'
import { Input } from '@/components/ui/input'
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import { Slider } from '@/components/ui/slider'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { BackgroundVideoPreview } from '@/features/chart/BackgroundVideoPreview'
import { ChartEditor, type ChartEditorHandle } from '@/features/chart/ChartEditor'
import { useChart } from '@/features/chart/ChartProvider'
import { DifficultyLevelFields } from '@/features/chart/DifficultyLevelFields'
import { libraryMetadata, tiers } from '@/features/chart/libraryMetadata'
import { adjacentBeatLine, bpmAtTime, retimeInitialBpm, snapToBeatLine } from '@/features/chart/tempoMap'
import { EDITOR_LANE_WIDTH, type ChartNote, type ToolMode } from '@/features/chart/types'

const SUBDIVISIONS = [2, 3, 4, 6, 8, 12, 16, 24, 32] as const
const AiChartDialog = lazy(() => import('@/features/chart/ai/AiChartDialog'))
const NoteImportDialog = lazy(() => import('@/features/chart/NoteImportDialog'))
const NotePropertiesPanel = lazy(() => import('@/features/chart/effects/NotePropertiesPanel'))
const NOTE_PROPERTIES_DRAWER_QUERY = '(max-width: 1024px)'
const PLAYBACK_RATES = [0.5, 0.75, 1] as const
const BPM_MIN = 20
const BPM_MAX = 400
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))
const formatTime = (milliseconds: number) => {
  const total = Math.max(0, milliseconds) / 1000
  return `${Math.floor(total / 60)}:${Math.floor(total % 60).toString().padStart(2, '0')}.${Math.floor((total % 1) * 1000).toString().padStart(3, '0')}`
}
const notesInRegion = (notes: ChartNote[], start: number, end: number) => notes.filter((note) => note.time >= start && (note.endTime ?? note.time) <= end)

function commitFocusedNoteProperty() {
  const focused = document.activeElement
  if (focused instanceof HTMLInputElement && focused.closest('.note-properties')) focused.blur()
}

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
    chart, setChart, setImprovising, commitEdit, activeChartId, storageStatus, audioRef, audioUrl, backgroundUrl, coverUrl, currentTime, setCurrentTime, setPlaybackRate,
    isPlaying, historyLength, futureLength, commitNotes, undo, redo, flushActiveChart, togglePlay,
    chooseAudio, chooseBackground, removeBackground, chooseCover, removeCover, showToast,
  } = useChart()
  const leaveEditor = () => { void flushActiveChart().finally(() => navigate('manage')) }
  useMobileBack(true, activeChartId ? leaveEditor : () => navigate('manage'))
  const { preferences, setPreferences } = usePreferences()
  const playbackRate = preferences.playbackRate
  const editorRef = useRef<ChartEditorHandle>(null)
  const playbackLifetime = useRef<AbortController | null>(null)
  useEffect(() => {
    const controller = new AbortController()
    playbackLifetime.current = controller
    return () => controller.abort()
  }, [])
  const [subdivision, setSubdivision] = useState<(typeof SUBDIVISIONS)[number]>(4)
  const toggleEditorPlay = useCallback(() => {
    editorRef.current?.flushSeek()
    return togglePlay(playbackRate, subdivision, playbackLifetime.current?.signal)
  }, [playbackRate, subdivision, togglePlay])
  const [tool, setTool] = useState<ToolMode>('note')
  const [redMode, setRedMode] = useState(false)
  const [aiOpen, setAiOpen] = useState(false)
  const [noteImportOpen, setNoteImportOpen] = useState(false)
  const [propertiesInDrawer, setPropertiesInDrawer] = useState(() => window.matchMedia?.(NOTE_PROPERTIES_DRAWER_QUERY).matches ?? false)
  const [propertiesTarget, setPropertiesTarget] = useState<{ chartId: string; tier?: number } | null>(null)
  const propertiesOpen = propertiesInDrawer && propertiesTarget?.chartId === activeChartId && propertiesTarget.tier === chart.library?.tier
  useEffect(() => {
    const viewport = window.matchMedia?.(NOTE_PROPERTIES_DRAWER_QUERY)
    if (!viewport) return
    const changeLayout = ({ matches }: MediaQueryListEvent) => {
      commitFocusedNoteProperty()
      setPropertiesInDrawer(matches)
      setPropertiesTarget(null)
    }
    setPropertiesInDrawer(viewport.matches)
    viewport.addEventListener?.('change', changeLayout)
    return () => viewport.removeEventListener?.('change', changeLayout)
  }, [])
  const effectsEditor = useEffectsEditor(tool, (tool) => { setTool(tool); setHoldStart(null); setRegion(null); setSelectedIds(new Set()) })
  const [holdStart, setHoldStart] = useState<{ lane: number; time: number } | null>(null)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const selectNotes = useCallback((ids: Set<string>) => {
    commitFocusedNoteProperty()
    setSelectedIds(ids)
  }, [])
  const [region, setRegion] = useState<{ start: number; end: number | null } | null>(null)
  const [clipboard, setClipboard] = useState<{ start: number; notes: ChartNote[]; effects: ChartEffect[] } | null>(null)
  const [actionFeedback, setActionFeedback] = useState<{ id: number; tone: 'action' | 'empty' | 'ready'; title: string; detail: string } | null>(null)
  const feedbackTimerRef = useRef(0)
  const feedbackIdRef = useRef(0)
  const [openSheet, setOpenSheet] = useState<'info' | 'tempo' | 'settings' | 'playtest' | null>(null)
  const [laneWidthPreview, setLaneWidthPreview] = useState<number | null>(null)
  const laneWidth = laneWidthPreview ?? chart.settings.editorLaneWidthPercent ?? EDITOR_LANE_WIDTH.default
  const [tempoTime, setTempoTime] = useState<number | null>(null)
  const [tempoDraft, setTempoDraft] = useState('')
  const [bpmDraft, setBpmDraft] = useState(String(chart.bpm))
  const [offsetDraft, setOffsetDraft] = useState(String(chart.offset))
  const [backgroundVideoStartDraft, setBackgroundVideoStartDraft] = useState(String(chart.backgroundVideoStartTime))
  const [videoPreviewChartId, setVideoPreviewChartId] = useState<string | null>(null)
  const regionNotes = useMemo(() => !region || region.end === null ? [] : notesInRegion(chart.notes, region.start, region.end).filter((note) => Boolean(note.red) === redMode), [chart.notes, redMode, region])
  const regionEffects = useMemo(() => {
    if (tool !== 'region' || !region || region.end === null) return []
    const { start, end } = region
    return chart.effects.filter((effect) => effect.time >= start && (effect.endTime ?? effect.time) <= end)
  }, [chart.effects, region, tool])
  const selectedNotes = useMemo(() => chart.notes.filter((note) => selectedIds.has(note.id) && Boolean(note.red) === redMode), [chart.notes, redMode, selectedIds])
  const canCopy = selectedNotes.length > 0 || regionEffects.length > 0
  const selectionKey = useMemo(() => JSON.stringify([...selectedIds]), [selectedIds])
  const regionStatus = useMemo(() => {
    if (effectsEditor.status) return effectsEditor.status
    if (actionFeedback) return actionFeedback
    if (tool === 'tempo') return { tone: 'action', title: text('选择 BPM 变化位置', 'Choose a BPM change position'), detail: text('点击轨道上的目标节拍线，然后输入从该位置开始使用的 BPM。', 'Click the target beat line, then enter the BPM to use from that point.') }
    if (tool !== 'region') return null
    if (!region) return { tone: 'action', title: text('选择区域起点', 'Choose the region start'), detail: text('点击轨道上的一条节拍线作为区域起点。', 'Click a beat line to set the start of the region.') }
    if (region.end === null) return { tone: 'action', title: text('继续选择区域终点', 'Choose the region end'), detail: text(`起点 ${formatTime(region.start)}，现在点击另一条节拍线。`, `Start ${formatTime(region.start)}; now click another beat line.`) }
    if (regionEffects.length) return { tone: 'ready', title: text(`已选择 ${regionNotes.length} 个音符、${regionEffects.length} 个变速`, `${regionNotes.length} notes and ${regionEffects.length} speed effects selected`), detail: text('可一起复制选区中的音符和变速。', 'Copy the notes and speed effects in this region together.') }
    if (!regionNotes.length) return { tone: 'empty', title: text('所选区域没有音符或变速', 'No notes or speed effects in this region'), detail: text('请选择包含音符或变速的范围。', 'Select a range containing notes or speed effects.') }
    return { tone: 'ready', title: text(`已选择 ${regionNotes.length} 个音符`, `${regionNotes.length} notes selected`), detail: text('现在可以复制或镜像这些音符。', 'You can now copy or mirror these notes.') }
  }, [effectsEditor.status, actionFeedback, region, regionEffects.length, regionNotes.length, text, tool])

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
    if (!region || region.end !== null) { setRegion({ start: time, end: null }); selectNotes(new Set()); return }
    const start = Math.min(region.start, time); const end = Math.max(region.start, time)
    setRegion({ start, end }); selectNotes(new Set(notesInRegion(chart.notes, start, end).filter((note) => Boolean(note.red) === redMode).map((note) => note.id)))
  }, [chart.notes, redMode, region, selectNotes])
  const copySelection = useCallback(() => {
    if (!canCopy) return
    const start = [...selectedNotes, ...regionEffects].reduce((earliest, item) => Math.min(earliest, item.time), Infinity)
    setClipboard({ start, notes: selectedNotes, effects: regionEffects })
    setSelectedIds(new Set()); setRegion(null); setTool('note')
    playCopyConfirmation()
    showEditorFeedback(text('已复制到粘贴板', 'Copied to clipboard'), regionEffects.length
      ? text(`已复制 ${selectedNotes.length} 个音符、${regionEffects.length} 个变速。`, `Copied ${selectedNotes.length} notes and ${regionEffects.length} speed effects.`)
      : text(`已复制 ${selectedNotes.length} 个音符。`, `Copied ${selectedNotes.length} notes.`))
  }, [canCopy, regionEffects, selectedNotes, showEditorFeedback, text])
  const pasteClipboard = useCallback((time: number) => {
    if (!clipboard) return
    const delta = time - clipboard.start
    const shift = <T extends ChartNote | ChartEffect,>(item: T): T => ({
      ...item, id: crypto.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`, time: item.time + delta,
      ...(item.endTime === undefined ? {} : { endTime: item.endTime + delta }),
    })
    if ([...clipboard.notes, ...clipboard.effects].some((item) => item.time + delta < 0 || (item.endTime ?? item.time) + delta > chart.duration)) {
      showEditorFeedback(text('无法粘贴到这里', 'Cannot paste here'), text('目标位置超出谱面时长，请选择另一条节拍线。', 'The target is outside the chart duration. Choose another beat line.'), 'empty'); return
    }
    const pasted = clipboard.notes.map(shift)
    const pastedEffects = clipboard.effects.map(shift)
    if (pastedEffects.length) {
      const candidates = [...chart.effects, ...pastedEffects]
      const effects = normalizeEffects(candidates)
      if (effects.length !== candidates.length) {
        showEditorFeedback(text('无法粘贴到这里', 'Cannot paste here'), text('变速位置重复或与渐变区间重叠。', 'Duplicate speed effect position or overlapping transition.'), 'empty'); return
      }
      commitEdit((previous) => ({ ...previous, effects, notes: pasted.length ? [...previous.notes, ...pasted].sort((a, b) => a.time - b.time) : previous.notes }))
    } else commitNotes([...chart.notes, ...pasted])
    if (pasted.length) setRedMode(Boolean(pasted[0].red))
    setSelectedIds(new Set(pasted.map((note) => note.id))); setRegion(null); setTool('note')
    if (pastedEffects.length) showEditorFeedback(text('已粘贴选区内容', 'Region contents pasted'), text(`已粘贴 ${pasted.length} 个音符、${pastedEffects.length} 个变速。`, `Pasted ${pasted.length} notes and ${pastedEffects.length} speed effects.`))
    else showEditorFeedback(text('已粘贴音符', 'Notes pasted'), text(`${pasted.length} 个音符已粘贴并保持选中。`, `${pasted.length} notes pasted and kept selected.`))
  }, [chart.duration, chart.effects, chart.notes, clipboard, commitEdit, commitNotes, showEditorFeedback, text])
  const pasteAtCurrentBeat = useCallback(() => {
    pasteClipboard(snapToBeatLine(chart, currentTime, subdivision))
  }, [chart, currentTime, pasteClipboard, subdivision])
  const mirrorSelection = useCallback(() => {
    if (!selectedNotes.length) return
    const ids = new Set(selectedNotes.map((note) => note.id))
    commitNotes(chart.notes.map((note) => ids.has(note.id) ? { ...note, lane: 3 - note.lane } : note)); showEditorFeedback(text('已镜像音符', 'Notes mirrored'), text(`${ids.size} 个音符已左右镜像。`, `${ids.size} notes mirrored horizontally.`))
  }, [chart.notes, commitNotes, selectedNotes, showEditorFeedback, text])
  const deleteSelection = useCallback(() => {
    if (!selectedIds.size) { setTool('delete'); setHoldStart(null); return }
    commitNotes(chart.notes.filter((note) => !(selectedIds.has(note.id) && Boolean(note.red) === redMode))); setSelectedIds(new Set()); setTool('note')
  }, [chart.notes, commitNotes, redMode, selectedIds])
  const changeSubdivision = useCallback((direction: -1 | 1) => {
    setSubdivision((current) => {
      const index = SUBDIVISIONS.indexOf(current)
      return SUBDIVISIONS[clamp(index + direction, 0, SUBDIVISIONS.length - 1)]
    })
  }, [])
  const toggleActionTool = useCallback((next: 'region' | 'delete') => {
    resetToolContext(tool === next ? 'note' : next)
    setSelectedIds(new Set()); setRegion(null)
  }, [resetToolContext, tool])
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
  const startPlaytest = useCallback(async (fromStart: boolean, improvise = false) => {
    const pendingTime = editorRef.current?.flushSeek()
    if (isPlaying) await togglePlay(playbackRate, subdivision)
    setCurrentTime(fromStart ? 0 : pendingTime ?? currentTime)
    setImprovising(improvise)
    setOpenSheet(null)
    navigate('playtest')
  }, [currentTime, isPlaying, playbackRate, setCurrentTime, setImprovising, subdivision, togglePlay])

  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement
      if (event.defaultPrevented || propertiesOpen || target.closest('[role="dialog"], [role="alertdialog"], [role="listbox"]')) return
      if (event.code === 'Space' && target.closest('.video-preview button')) return
      const editing = target instanceof HTMLInputElement || target instanceof HTMLSelectElement || target instanceof HTMLTextAreaElement || target.isContentEditable
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault()
        void flushActiveChart().then((saved) => { if (saved) showToast(text('已保存到内部谱面库', 'Saved to the local chart library')) })
        return
      }
      if (editing || target.closest('.note-properties')) return
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); event.shiftKey ? redo() : undo(); return }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a') { event.preventDefault(); setRegion(null); setSelectedIds(new Set(chart.notes.map((note) => note.id))); return }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'c' && canCopy) { event.preventDefault(); copySelection(); return }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'v' && clipboard) { event.preventDefault(); pasteAtCurrentBeat(); return }
      if (event.repeat) return
      if (event.code === 'KeyQ') { event.preventDefault(); void toggleEditorPlay() }
      if (event.code === 'Delete' && selectedIds.size) { event.preventDefault(); deleteSelection() }
      if (event.code === 'ArrowUp') { event.preventDefault(); setCurrentTime(adjacentBeatLine(chart, editorRef.current?.flushSeek() ?? currentTime, subdivision, 1)) }
      if (event.code === 'ArrowDown') { event.preventDefault(); setCurrentTime(adjacentBeatLine(chart, editorRef.current?.flushSeek() ?? currentTime, subdivision, -1)) }
      if (event.code === 'Space') { event.preventDefault(); setCurrentTime(adjacentBeatLine(chart, editorRef.current?.flushSeek() ?? currentTime, 1, 1)) }
    }
    window.addEventListener('keydown', keydown)
    return () => window.removeEventListener('keydown', keydown)
  }, [canCopy, chart, clipboard, copySelection, currentTime, deleteSelection, flushActiveChart, pasteAtCurrentBeat, playbackRate, propertiesOpen, redo, selectedIds.size, setCurrentTime, showToast, subdivision, text, toggleEditorPlay, undo])

  if (!activeChartId) return <div className="editor-page page-enter">
    <div className="editor-workspace">
      <div className="library-empty"><BookOpen /><h1>{text('未选择谱面', 'No chart selected')}</h1><GameButton className="primary" onClick={() => navigate('manage')}>{text('前往我的谱面', 'Go to My Charts')}</GameButton></div>
    </div>
  </div>

  const propertiesDescription = selectedNotes.length
    ? text(`已选 ${selectedNotes.length} 个音符`, `${selectedNotes.length} selected`)
    : text(...notePropertiesCopy.emptySelection)
  const selectedNoteId = selectedNotes.length === 1 && <p className="note-properties-id">
    {text(...notePropertiesCopy.id)} <code>{selectedNotes[0].id}</code>
  </p>
  const propertiesPanel = !!selectedNotes.length && <Suspense fallback={null}>
    <NotePropertiesPanel key={selectionKey} notes={selectedNotes} />
  </Suspense>

  const onPropertiesKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
    const target = event.target
    if (event.defaultPrevented || !(event.ctrlKey || event.metaKey) || event.altKey || !(target instanceof Element)
      || !event.currentTarget.contains(target) || target.hasAttribute('data-draft')) return
    const key = event.key.toLowerCase()
    if (key !== 'z' && key !== 'y') return
    event.preventDefault()
    if (key === 'y' || event.shiftKey) redo()
    else undo()
  }

  return <Sheet open={propertiesOpen} onOpenChange={open => {
    if (!open) commitFocusedNoteProperty()
    setPropertiesTarget(open ? { chartId: activeChartId, tier: chart.library?.tier } : null)
  }}><div className="editor-page page-enter">
    <header className="game-page-toolbar editor-toolbar">
      <Tooltip><TooltipTrigger asChild><GameButton size="icon-lg" aria-label={text('退出编辑器', 'Exit editor')} onClick={leaveEditor}><ArrowLeft /></GameButton></TooltipTrigger><TooltipContent side="bottom">{text('退出编辑器', 'Exit editor')}</TooltipContent></Tooltip>
      <h1><i aria-hidden /><span>{chart.title || text('未命名谱面', 'Untitled')}</span></h1>
      <GameButton className="primary" onClick={() => setOpenSheet('playtest')}><Gamepad2 />{text('谱面试玩', 'Playtest')}</GameButton>
      <div role="group" className="editor-utility-actions" data-scroll-region aria-label={text('编辑器工具栏', 'Editor toolbar')}>
        <Tooltip><TooltipTrigger asChild><GameButton size="icon-lg" onClick={() => { editorRef.current?.flushSeek(); setNoteImportOpen(true) }} aria-label={text(noteImportTitle.zh, noteImportTitle.en)}><FileUp /></GameButton></TooltipTrigger><TooltipContent side="bottom" sideOffset={9}>{text(noteImportTitle.zh, noteImportTitle.en)}</TooltipContent></Tooltip>
        <Tooltip><TooltipTrigger asChild><GameButton size="icon-lg" onClick={() => { editorRef.current?.flushSeek(); setAiOpen(true) }} aria-label={text(aiChartCopy.title.zh, aiChartCopy.title.en)}><FileJson /></GameButton></TooltipTrigger><TooltipContent side="bottom" sideOffset={9}>{text(aiChartCopy.title.zh, aiChartCopy.title.en)}</TooltipContent></Tooltip>
        <Tooltip><TooltipTrigger asChild><GameButton size="icon-lg" onClick={() => setOpenSheet('info')} aria-label={text('谱面信息', 'Chart info')}><BookOpen /></GameButton></TooltipTrigger><TooltipContent side="bottom" sideOffset={9}>{text('谱面信息', 'Chart info')}</TooltipContent></Tooltip>
        <Tooltip><TooltipTrigger asChild><GameButton size="icon-lg" onClick={() => setOpenSheet('tempo')} aria-label={text('BPM 变化', 'BPM changes')}><Gauge /></GameButton></TooltipTrigger><TooltipContent side="bottom" sideOffset={9}>{text('BPM 变化', 'BPM changes')}</TooltipContent></Tooltip>
        <Tooltip><TooltipTrigger asChild><GameButton size="icon-lg" onClick={() => effectsEditor.setOpen(true)} aria-label={text(editorEffects.title.zh, editorEffects.title.en)}><Sparkles /></GameButton></TooltipTrigger><TooltipContent side="bottom" sideOffset={9}>{text(editorEffects.title.zh, editorEffects.title.en)}</TooltipContent></Tooltip>
        <Tooltip><TooltipTrigger asChild><GameButton size="icon-lg" onClick={() => setOpenSheet('settings')} aria-label={text('谱面设置', 'Chart settings')}><SlidersHorizontal /></GameButton></TooltipTrigger><TooltipContent side="bottom" sideOffset={9}>{text('谱面设置', 'Chart settings')}</TooltipContent></Tooltip>
      </div>
    </header>
    <div className="editor-workspace">
      <aside className="editor-action-rail editor-action-rail-left" data-scroll-region aria-label={text('常用编辑操作', 'Common editing actions')}>
        <GameButton className="editor-action primary" onClick={() => void toggleEditorPlay()}>{isPlaying ? <Pause /> : <Play />}<b>{isPlaying ? text('暂停', 'Pause') : text('播放', 'Play')}</b></GameButton>
        <GameButton className="editor-action" aria-pressed={tool === 'region'} onClick={() => toggleActionTool('region')}><ScanSearch /><b>{text('区域', 'Region')}</b></GameButton>
        {propertiesInDrawer && <SheetTrigger asChild><GameButton className="editor-action" disabled={!selectedNotes.length}>
          <SlidersHorizontal /><b>{text(...notePropertiesCopy.title)}</b>
        </GameButton></SheetTrigger>}
        <GameButton className="editor-action danger" aria-pressed={tool === 'delete'} onClick={() => toggleActionTool('delete')}><Trash2 /><b>{text('删除', 'Delete')}</b></GameButton>
        <div className="editor-compact-actions">
          <Tooltip><TooltipTrigger asChild><span><GameButton size="icon-lg" disabled={!canCopy} onClick={copySelection} aria-label={text('复制选中内容', 'Copy selection')}><Copy /></GameButton></span></TooltipTrigger><TooltipContent side="top" sideOffset={9}>{canCopy ? text('复制选中内容', 'Copy selection') : text('请选择要复制的音符或变速区域', 'Select notes or a region containing speed effects')}</TooltipContent></Tooltip>
          <Tooltip><TooltipTrigger asChild><span><GameButton size="icon-lg" disabled={!clipboard} onClick={pasteAtCurrentBeat} aria-label={text('粘贴到当前判定线', 'Paste at the current judgment line')}><ClipboardPaste /></GameButton></span></TooltipTrigger><TooltipContent side="top" sideOffset={9}>{clipboard ? text('粘贴到当前判定线', 'Paste at the current judgment line') : text('复制选中内容后可粘贴', 'Copy a selection before pasting')}</TooltipContent></Tooltip>
          <Tooltip><TooltipTrigger asChild><span><GameButton size="icon-lg" disabled={!selectedNotes.length} onClick={mirrorSelection} aria-label={text('镜像选中音符', 'Mirror selected notes')}><FlipHorizontal2 /></GameButton></span></TooltipTrigger><TooltipContent side="top" sideOffset={9}>{selectedNotes.length ? text(`镜像选中的 ${selectedNotes.length} 个音符`, `Mirror ${selectedNotes.length} selected notes`) : text('请选择要镜像的音符', 'Select notes to mirror')}</TooltipContent></Tooltip>
        </div>
        <div className="editor-compact-actions">
          <Tooltip><TooltipTrigger asChild><span><GameButton size="icon-lg" disabled={!historyLength} onClick={undo} aria-label={text('撤回', 'Undo')}><Undo2 /></GameButton></span></TooltipTrigger><TooltipContent side="top" sideOffset={9}>{text('撤回', 'Undo')}</TooltipContent></Tooltip>
          <Tooltip><TooltipTrigger asChild><span><GameButton size="icon-lg" disabled={!futureLength} onClick={redo} aria-label={text('重做', 'Redo')}><Redo2 /></GameButton></span></TooltipTrigger><TooltipContent side="top" sideOffset={9}>{text('重做', 'Redo')}</TooltipContent></Tooltip>
        </div>
        <div className="playback-rate">{PLAYBACK_RATES.map((rate) => <GameButton key={rate} size="sm" aria-pressed={playbackRate === rate} onClick={() => { editorRef.current?.flushSeek(); setPlaybackRate(rate) }}>{rate}×</GameButton>)}</div>
      </aside>
      <div className="editor-stage-layout">
        <div className="editor-canvas">
          <ChartEditor
            ref={editorRef}
            laneWidthPercent={laneWidth}
            chart={chart} currentTime={currentTime} subdivision={subdivision} tool={tool} redMode={redMode} holdStart={holdStart}
            selectedIds={selectedIds} region={region} isPlaying={isPlaying} onSeek={setCurrentTime}
            onNotesChange={commitNotes} onHoldStart={setHoldStart} onSelectionChange={selectNotes}
            onRegionLine={chooseRegionLine} onTempoLine={chooseTempoLine} onEffectLine={effectsEditor.onLine} onEffectEdit={effectsEditor.edit}
            onRegionMove={(delta) => setRegion((current) => current && current.end !== null ? { start: current.start + delta, end: current.end + delta } : current)}
            onZoomChange={(editorZoom) => setChart((current) => ({ ...current, settings: { ...current.settings, editorZoom } }))}
            onSubdivisionChange={changeSubdivision}
          />
          {regionStatus && <div key={actionFeedback?.id} className="region-workflow-status" role="status" data-tone={regionStatus.tone} data-feedback={Boolean(actionFeedback)}><span><ScanSearch /></span><div><strong>{regionStatus.title}</strong><small>{regionStatus.detail}</small></div></div>}
        </div>
        {videoPreviewChartId === activeChartId && chart.backgroundType === 'video' && backgroundUrl && (
          <BackgroundVideoPreview
            key={backgroundUrl} src={backgroundUrl} audioRef={audioRef} hasAudio={Boolean(audioUrl)}
            currentTime={currentTime} duration={chart.duration} startTime={chart.backgroundVideoStartTime} isPlaying={isPlaying}
            onTogglePlay={() => void toggleEditorPlay()}
            onSeek={(time) => { editorRef.current?.flushSeek(); setCurrentTime(time) }}
            onClose={() => setVideoPreviewChartId(null)}
          />
        )}
      </div>
      <aside className={`editor-action-rail editor-action-rail-right${redMode ? ' red-placement' : ''}`} data-scroll-region aria-label={text('音符工具', 'Note tools')}>
        <GameButton className="editor-action red-mode-toggle" aria-label={text(redZoneCopy.mode.zh, redZoneCopy.mode.en)} aria-pressed={redMode} onClick={() => { setRedMode((value) => !value); resetToolContext(tool === 'hold' ? 'hold' : 'note'); setSelectedIds(new Set()); setRegion(null) }}><Sparkles /><b>{text(redZoneCopy.mode.zh, redZoneCopy.mode.en)}</b></GameButton>
        <GameButton className="editor-action" aria-pressed={tool === 'note'} onClick={() => resetToolContext('note')}><span className="note-glyph tap" /><b>NOTE</b></GameButton>
        <GameButton className="editor-action" aria-pressed={tool === 'hold'} onClick={() => resetToolContext('hold')}><span className="note-glyph hold" /><b>HOLD</b></GameButton>
      </aside>
      {!propertiesInDrawer && <aside className="note-properties note-inspector" aria-labelledby="note-inspector-title" tabIndex={-1} onKeyDown={onPropertiesKeyDown}>
        <header className="note-properties-header">
          <div className="note-properties-header-summary">
            <h2 id="note-inspector-title">{text(...notePropertiesCopy.inspector)}</h2>
            <p className="note-properties-description">{propertiesDescription}</p>
            {selectedNoteId}
          </div>
        </header>
        {propertiesPanel}
      </aside>}
    </div>

    {propertiesInDrawer && <SheetContent side="bottom" showCloseButton={false} overlayClassName="note-properties-overlay"
      className="note-properties note-properties-drawer data-[side=bottom]:data-open:slide-in-from-bottom-full data-[side=bottom]:data-closed:slide-out-to-bottom-full"
      onKeyDown={onPropertiesKeyDown}
      onEscapeKeyDown={event => {
        if (event.target instanceof HTMLInputElement && event.target.hasAttribute('data-draft')) event.preventDefault()
      }}>
      <SheetHeader className="note-properties-header">
        <div className="note-properties-header-summary">
          <SheetTitle>{text(...notePropertiesCopy.title)}</SheetTitle>
          <SheetDescription className="note-properties-description">{propertiesDescription}</SheetDescription>
          {selectedNoteId}
        </div>
        <div className="note-properties-header-actions">
          <Button variant="ghost" size="icon-sm" disabled={!historyLength} onClick={undo} aria-label={text('撤回', 'Undo')} title={text('撤回', 'Undo')}><Undo2 /></Button>
          <Button variant="ghost" size="icon-sm" disabled={!futureLength} onClick={redo} aria-label={text('重做', 'Redo')} title={text('重做', 'Redo')}><Redo2 /></Button>
          <SheetClose asChild><Button variant="ghost" size="icon-sm" aria-label={text(...notePropertiesCopy.close)}><X /></Button></SheetClose>
        </div>
      </SheetHeader>
      {propertiesPanel}
    </SheetContent>}

    <EffectsModule editor={effectsEditor} />
    {noteImportOpen && <Suspense fallback={null}><NoteImportDialog key={activeChartId} onClose={() => setNoteImportOpen(false)} onApplied={() => { setSelectedIds(new Set()); setHoldStart(null); setRegion(null); setTool('note') }} /></Suspense>}
    {aiOpen && <Suspense fallback={null}><AiChartDialog key={activeChartId} onClose={() => setAiOpen(false)} onApplied={() => { setSelectedIds(new Set()); setHoldStart(null); setRegion(null); setTool('note') }} subdivision={subdivision} initialRange={region?.end != null ? { start: region.start, end: region.end } : null} /></Suspense>}

    <Sheet open={openSheet === 'info'} onOpenChange={(open) => setOpenSheet(open ? 'info' : null)}>
      <SheetContent className="editor-sheet">
        <SheetHeader><SheetTitle>{text('谱面信息', 'Chart info')} · {tiers[libraryMetadata(chart.library).tier]}</SheetTitle><SheetDescription>{storageStatus === 'saving' ? text('正在保存到内部谱面库', 'Saving to the local chart library') : storageStatus === 'error' ? text('内部保存失败', 'Local save failed') : text('已自动保存到内部谱面库', 'Autosaved to the local chart library')}</SheetDescription></SheetHeader>
        <div className="editor-sheet-scroll" data-scroll-region>
          <section className="sheet-section">
            <div className="sheet-section-heading"><span><Music2 /></span><div><h3>{text('歌曲信息', 'Song info')}</h3><p>{text('修改初始 BPM 时会保持音符相对节拍位置。', 'Changing the initial BPM preserves each note’s relative beat position.')}</p></div></div>
            <div className="config-form">
              <label><span>{text('歌曲标题', 'Song title')}</span><Input value={chart.title} onChange={(event) => setChart((current) => ({ ...current, title: event.target.value }))} /></label>
              <label><span>{text('艺术家', 'Artist')}</span><Input value={chart.artist} placeholder="Unknown artist" onChange={(event) => setChart((current) => ({ ...current, artist: event.target.value }))} /></label>
              <label><span>{text('初始 BPM', 'Initial BPM')}</span><Input inputMode="decimal" value={bpmDraft} onChange={(event) => { const raw = event.target.value; setBpmDraft(raw) }} onBlur={() => { const value = Number(bpmDraft); if (bpmDraft === '' || !Number.isFinite(value) || value < BPM_MIN || value > BPM_MAX) { showToast(text(`BPM 需在 ${BPM_MIN}–${BPM_MAX} 之间`, `BPM must be between ${BPM_MIN} and ${BPM_MAX}`)); setBpmDraft(String(chart.bpm)) } else applyBpm(value) }} /></label>
              <label><span>{text('谱面偏移（ms）', 'Chart offset (ms)')}</span><Input inputMode="numeric" value={offsetDraft} onChange={(event) => { const raw = event.target.value; setOffsetDraft(raw) }} onBlur={() => { if (offsetDraft === '' || !Number.isFinite(Number(offsetDraft))) { showToast(text('偏移值必须是有效毫秒数', 'Offset must be a valid millisecond value')); setOffsetDraft(String(chart.offset)) } else applyOffset(Number(offsetDraft)) }} /></label>
            </div>
            <DifficultyLevelFields levels={libraryMetadata(chart.library).levels} onCommit={(tier, level) => {
              setChart(current => {
                const meta = libraryMetadata(current.library)
                if (meta.levels[tier] === level) return current
                return { ...current, library: { ...meta, levels: meta.levels.map((value, index) => index === tier ? level : value) } }
              })
            }} />
            <div className="chart-media-card">
              <button type="button" className="chart-media-picker" onClick={() => void chooseAudio()}>
                <span className="audio-icon"><Upload /></span>
                <span><strong>{chart.audioName || text('上传音频文件', 'Upload audio file')}</strong><small>{text('MP3、WAV、OGG、M4A 或 FLAC', 'MP3, WAV, OGG, M4A, or FLAC')}</small></span>
                <b>{chart.audioName ? text('替换', 'Replace') : text('上传', 'Upload')}</b>
              </button>
            </div>
            <div className="chart-media-card">
              <button type="button" className="chart-media-picker" onClick={() => void chooseBackground()}>
                <span className="audio-icon"><ImagePlus /></span>
                <span><strong>{chart.backgroundName || text('上传试玩背景', 'Upload playtest background')}</strong><small>{text('图片或 MP4 / WebM 视频', 'Image or MP4 / WebM video')}</small></span>
                <b>{chart.backgroundName ? text('替换', 'Replace') : text('上传', 'Upload')}</b>
              </button>
              {chart.backgroundName && <Button type="button" variant="outline" size="icon" title={text('移除背景', 'Remove background')} onClick={() => void removeBackground()}><X /></Button>}
            </div>
            {chart.backgroundType === 'video' && (
              <div className="video-preview-setting">
                <label className="video-start-setting"><span><strong>{text('视频起始偏移（ms）', 'Video start offset (ms)')}</strong><small>{text('正数延后开始，负数提前播放', 'Positive values delay playback; negative values start early')}</small></span><Input inputMode="numeric" value={backgroundVideoStartDraft} onChange={(event) => setBackgroundVideoStartDraft(event.target.value)} onBlur={() => { const value = Number(backgroundVideoStartDraft); if (!Number.isFinite(value)) { showToast(text('视频起始偏移必须是有效毫秒数', 'Video start offset must be a valid millisecond value')); setBackgroundVideoStartDraft(String(chart.backgroundVideoStartTime)); return } const backgroundVideoStartTime = Math.round(value); setBackgroundVideoStartDraft(String(backgroundVideoStartTime)); setChart((current) => ({ ...current, backgroundVideoStartTime })) }} /></label>
                <Button type="button" variant="outline" disabled={!backgroundUrl} onClick={() => {
                  editorRef.current?.flushSeek()
                  setVideoPreviewChartId(activeChartId)
                  setOpenSheet(null)
                }}><Play />{text(backgroundVideoPreviewCopy.title.zh, backgroundVideoPreviewCopy.title.en)}</Button>
              </div>
            )}
            <div className="chart-media-card">
              <button type="button" className="chart-media-picker" onClick={() => void chooseCover()}>
                <span className="audio-icon cover-preview">{coverUrl ? <img src={coverUrl} alt="" /> : <ImagePlus />}</span>
                <span><strong>{chart.coverName || text('上传曲目封面', 'Upload cover art')}</strong><small>{text('PNG、JPG、WebP 或 AVIF', 'PNG, JPG, WebP, or AVIF')}</small></span>
                <b>{chart.coverName ? text('替换', 'Replace') : text('上传', 'Upload')}</b>
              </button>
              {chart.coverName && <Button type="button" variant="outline" size="icon" title={text('移除封面', 'Remove cover')} onClick={() => void removeCover()}><X /></Button>}
            </div>
          </section>
        </div>
      </SheetContent>
    </Sheet>

    <Sheet open={openSheet === 'tempo'} onOpenChange={(open) => setOpenSheet(open ? 'tempo' : null)}>
      <SheetContent className="editor-sheet">
        <SheetHeader><SheetTitle>{text('BPM 变化', 'BPM changes')}</SheetTitle><SheetDescription>{text('在任意节拍线上设置从该位置开始生效的 BPM。', 'Set a BPM on any beat line that takes effect from that point.')}</SheetDescription></SheetHeader>
        <div className="editor-sheet-scroll" data-scroll-region>
          <section className="sheet-section">
            <div className="sheet-section-heading"><span><Gauge /></span><div><h3>{text('BPM 时间轴', 'Tempo timeline')}</h3><p>{chart.bpmChanges.length ? text(`已有 ${chart.bpmChanges.length} 个 BPM 变化点`, `${chart.bpmChanges.length} BPM changes`) : text('当前谱面使用固定 BPM', 'This chart uses a fixed BPM')}</p></div></div>
            <Button className="tempo-add-button" onClick={() => { setOpenSheet(null); resetToolContext('tempo') }}><Plus />{text('选择节拍线添加 BPM 变化', 'Choose a beat line to add a BPM change')}</Button>
            <div className="tempo-change-list" data-scroll-region>{chart.bpmChanges.length ? chart.bpmChanges.map((change) => <div key={change.time}><button onClick={() => { setCurrentTime(change.time); setOpenSheet(null); chooseTempoLine(change.time) }}><time>{formatTime(change.time)}</time><strong>{change.bpm} BPM</strong></button><Button variant="ghost" size="icon-sm" title={text('删除 BPM 变化点', 'Delete BPM change')} onClick={() => deleteTempoChange(change.time)}><Trash2 /></Button></div>) : <p>{text('点击上方按钮，再选择轨道中的目标节拍线。', 'Click the button above, then choose the target beat line in the lanes.')}</p>}</div>
          </section>
        </div>
      </SheetContent>
    </Sheet>

    <Sheet open={openSheet === 'settings'} onOpenChange={(open) => {
      if (!open) setLaneWidthPreview(null)
      setOpenSheet(open ? 'settings' : null)
    }}>
      <SheetContent className="editor-sheet">
        <SheetHeader><SheetTitle>{text('谱面设置', 'Chart settings')}</SheetTitle><SheetDescription>{text('调整当前编辑器的时间轴显示与操作偏好。', 'Adjust the current editor timeline and interaction preferences.')}</SheetDescription></SheetHeader>
        <div className="editor-sheet-scroll" data-scroll-region>
          <section className="sheet-section">
            <div className="sheet-section-heading"><span><SlidersHorizontal /></span><div><h3>{text('时间轴布局', 'Timeline layout')}</h3><p>{text('只影响编辑区域，不改变谱面内容与试玩画面。', 'Only affects the editor and does not change chart content or playtesting.')}</p></div></div>
            <label className="slider-setting"><span><strong>{text('判定线高度', 'Judgment line height')}</strong><small>{text('判定线距离编辑区域底部的位置', 'Distance of the judgment line from the bottom of the editor')}</small></span><div><Slider min={100} max={360} step={10} value={[preferences.judgmentLineHeight]} onValueChange={([judgmentLineHeight]) => setPreferences((current) => ({ ...current, judgmentLineHeight }))} /><output>{preferences.judgmentLineHeight}px</output></div></label>
            <label className="slider-setting"><span><strong>{text('时间轴缩放', 'Timeline zoom')}</strong><small>{text('也可以按住 Ctrl 并滚动轨道', 'You can also hold Ctrl and scroll over the lanes')}</small></span><div><Slider min={90} max={1320} step={10} value={[chart.settings.editorZoom]} onValueChange={([editorZoom]) => setChart((current) => ({ ...current, settings: { ...current.settings, editorZoom } }))} /><output>{Math.round(chart.settings.editorZoom / 2.3)}%</output></div></label>
            <div className="slider-setting">
              <span><strong>{text('轨道宽度', 'Lane width')}</strong></span>
              <div>
                <Slider
                  thumbLabel={text('轨道宽度', 'Lane width')}
                  min={EDITOR_LANE_WIDTH.min}
                  max={EDITOR_LANE_WIDTH.max}
                  step={EDITOR_LANE_WIDTH.step}
                  value={[laneWidth]}
                  onValueChange={([width]) => setLaneWidthPreview(width)}
                  onValueCommit={([editorLaneWidthPercent]) => {
                    setChart((current) => current.settings.editorLaneWidthPercent === editorLaneWidthPercent
                      ? current
                      : { ...current, settings: { ...current.settings, editorLaneWidthPercent } })
                  }}
                />
                <output>{laneWidth}%</output>
              </div>
            </div>
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
        <div className="playtest-entry-options editor-sheet-scroll" data-scroll-region>
          <button onClick={() => void startPlaytest(false, true)}><span><Sparkles /></span><div><strong>{text(improvisationCopy.title.zh, improvisationCopy.title.en)}</strong><small>{text(improvisationCopy.entry.zh, improvisationCopy.entry.en)}</small></div></button>
          <button onClick={() => void startPlaytest(false)}><span><Play /></span><div><strong>{text('从当前位置开始', 'Start at current position')}</strong><small>{formatTime(currentTime)} · {text('跳过此前音符', 'Skip earlier notes')}</small></div></button>
          <button onClick={() => void startPlaytest(true)}><span><Gamepad2 /></span><div><strong>{text('从头开始', 'Start from beginning')}</strong><small>00:00.000 · {text('完整试玩整份谱面', 'Play the full chart')}</small></div></button>
        </div>
      </SheetContent>
    </Sheet>

    <Dialog open={tempoTime !== null} onOpenChange={(open) => { if (!open) setTempoTime(null) }}>
      <DialogContent className="tempo-dialog">
        <DialogHeader><DialogTitle>{text('设置 BPM 变化', 'Set BPM change')}</DialogTitle><DialogDescription>{tempoTime === null ? '' : text(`从 ${formatTime(tempoTime)} 的节拍线开始使用新 BPM。`, `Use the new BPM from the beat line at ${formatTime(tempoTime)}.`)}</DialogDescription></DialogHeader>
        <label><span>BPM</span><Input autoFocus={!isTouchWeb()} inputMode="decimal" value={tempoDraft} onChange={(event) => setTempoDraft(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') saveTempoChange() }} /></label>
        <DialogFooter>{tempoTime !== null && chart.bpmChanges.some((change) => Math.abs(change.time - tempoTime) < 0.01) && <Button variant="destructive" onClick={() => deleteTempoChange(tempoTime)}>{text('删除 BPM 变化点', 'Delete BPM change')}</Button>}<Button variant="outline" onClick={() => setTempoTime(null)}>{text('取消', 'Cancel')}</Button><Button onClick={saveTempoChange}>{text('保存', 'Save')}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </div></Sheet>
}
