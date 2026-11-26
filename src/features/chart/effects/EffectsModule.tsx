import { effectLabel } from './labels'
import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, Crosshair, Pause, Plus, Trash2 } from 'lucide-react'
import { useI18n } from '@/app/i18n'
import { isTouchWeb } from '@/app/mobileBack'
import { editorEffects } from '@/config/app'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog'
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select'
import { useChart } from '../ChartProvider'
import type { ToolMode } from '../types'
import { normalizeEffects, scrollSpeedMap, type ChartEffect } from './scrollSpeed'
import { validBezier, type BezierPoints, type CurveName } from './curves'
import { CurveEditor } from './CurveEditor'

const formatTime = (time: number) => `${(time / 1000).toFixed(3)}s`

export interface EffectDraft { id: string; time: number; multiplier: string; transition: 'instant' | 'linear'; endTime?: number; curve?: CurveName; bezier?: BezierPoints; startText?: string; endText?: string; controlTexts?: string[] }
type Draft = EffectDraft

const draftFingerprint = (draft: Draft) => JSON.stringify({
  id: draft.id, time: draft.time,
  multiplier: draft.multiplier.trim() && Number.isFinite(Number(draft.multiplier)) ? Number(draft.multiplier) : draft.multiplier,
  transition: draft.transition,
  ...(draft.transition === 'linear' ? { endTime: draft.endTime, curve: draft.curve ?? 'linear', ...(draft.curve === 'custom' ? { bezier: draft.bezier } : {}) } : {}),
})

export function useEffectsEditor(tool: ToolMode, setTool: (tool: ToolMode) => void) {
  const { chart, activeChartId, commitEdit, setCurrentTime } = useChart()
  const { text } = useI18n()
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [picking, setPicking] = useState<'start' | 'end' | null>(null)
  const [error, setError] = useState('')
  const [pending, setPending] = useState<null | { event?: ChartEffect }>(null)
  const baseline = useRef('')
  const beforePick = useRef<Draft | null>(null)
  const dirty = !!draft && draftFingerprint(draft) !== baseline.current
  const cancel = () => { setDraft(null); setPicking(null); setError(''); setTool('note') }
  const edit = (event: ChartEffect) => {
    const next = { ...event, multiplier: String(event.multiplier) }
    baseline.current = draftFingerprint(next)
    setCurrentTime(event.time); setOpen(false); setError(''); setPicking(null); setTool('note'); setDraft(next)
  }
  const requestClose = () => { if (dirty) setPending({}); else cancel() }
  const navigate = (event: ChartEffect) => { if (dirty) setPending({ event }); else edit(event) }
  const pick = (point: 'start' | 'end') => { beforePick.current = draft; setError(''); setPicking(point); setTool('effect') }
  useEffect(() => { setOpen(false); setDraft(null); setPicking(null); setError(''); setPending(null) }, [activeChartId])
  useEffect(() => {
    if (!picking) return
    const keydown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      if (beforePick.current) { setDraft(beforePick.current); setPicking(null); setError(''); setTool('note') }
      else cancel()
    }
    window.addEventListener('keydown', keydown)
    return () => window.removeEventListener('keydown', keydown)
  })
  useEffect(() => {
    if (picking && tool !== 'effect') { setPicking(null); setDraft(null); setError('') }
  }, [tool, picking])
  const onLine = (time: number) => {
    setError('')
    if (picking === 'end' && draft) {
      if (time <= draft.time) { setError(text('终点必须晚于起点', 'End must follow start')); return }
      setDraft({ ...draft, endTime: time, endText: undefined })
    } else if (picking === 'start' && draft) {
      if (draft.transition === 'linear' && draft.endTime !== undefined && time >= draft.endTime) {
        setError(text('起点必须早于终点', 'Start must precede end')); return
      }
      setDraft({ ...draft, time, startText: undefined })
    } else {
      const next: Draft = { id: crypto.randomUUID(), time, multiplier: '1', transition: 'instant' }
      baseline.current = ''
      setDraft(next)
    }
    setPicking(null); setTool('note')
  }
  const save = () => {
    if (!draft || !dirty) return
    const multiplier = Number(draft.multiplier)
    if (!draft.multiplier.trim() || !Number.isFinite(multiplier) || multiplier < 0 || multiplier > 10) {
      setError(text('倍率需在 0–10 之间', 'Multiplier must be between 0 and 10')); return
    }
    if (!Number.isFinite(draft.time) || draft.time < 0 || draft.time > chart.duration || (draft.transition === 'linear' && (!Number.isFinite(draft.endTime) || draft.endTime === undefined || draft.endTime <= draft.time || draft.endTime > chart.duration))) {
      setError(text('请选择谱面内有效的起止位置', 'Choose valid start and end positions within the chart')); return
    }
    if (draft.transition === 'linear' && draft.curve === 'custom' && (!validBezier(draft.bezier) || draft.controlTexts?.some((v) => !v.trim()))) {
      setError(text(editorEffects.invalidCurve.zh, editorEffects.invalidCurve.en)); return
    }
    const event: ChartEffect = { id: draft.id, type: 'scrollSpeed', time: draft.time, multiplier, transition: draft.transition,
      ...(draft.transition === 'linear' ? { endTime: draft.endTime, ...(draft.curve ? { curve: draft.curve } : {}), ...(draft.curve === 'custom' ? { bezier: draft.bezier } : {}) } : {}) }
    const candidates = [...chart.effects.filter((e) => e.id !== draft.id), event]
    const effects = normalizeEffects(candidates)
    if (effects.length !== candidates.length) { setError(text('变速位置重复或与渐变区间重叠', 'Duplicate position or overlapping speed transition')); return }
    commitEdit((chart) => ({ ...chart, effects })); cancel()
  }
  return { open, setOpen, draft, setDraft: (next: Draft) => { setDraft(next); setError('') }, picking, error, cancel, requestClose, dirty, pending, navigate, onLine, save,
    dismissPending: () => setPending(null),
    discardPending: () => { const next = pending?.event; setPending(null); if (next) edit(next); else cancel() },
    add: () => { beforePick.current = null; setOpen(false); setDraft(null); setError(''); setPicking('start'); setTool('effect') },
    pickStart: () => pick('start'),
    pickEnd: () => pick('end'),
    edit,
    remove: (id: string) => { commitEdit((chart) => ({ ...chart, effects: chart.effects.filter((e) => e.id !== id) })); if (draft?.id === id) cancel() },
    status: picking ? { tone: 'action', title: picking === 'start' ? text('选择变速起点', 'Choose speed effect start') : text('选择渐变终点', 'Choose transition end'),
      detail: error || (draft ? text(editorEffects.back.zh, editorEffects.back.en) : text('点击目标节拍线 · Esc 取消', 'Choose a beat line · Esc to cancel')) } : null,
  }
}

export function EffectsModule({ editor }: { editor: ReturnType<typeof useEffectsEditor> }) {
  const { chart } = useChart()
  const { text } = useI18n()
  const [page, setPage] = useState(0)
  const pageCount = Math.max(1, Math.ceil(chart.effects.length / 30))
  const currentPage = Math.min(page, pageCount - 1)
  const draft = editor.draft
  const index = chart.effects.findIndex((event) => event.id === draft?.id)
  const from = useMemo(() => draft && Number.isFinite(draft.time) ? scrollSpeedMap(chart.effects.filter((event) => event.id !== draft.id)).speedBefore(draft.time) : 1, [chart.effects, draft?.id, draft?.time])
  const copy = (key: Exclude<keyof typeof editorEffects, 'curves'>) => text(editorEffects[key].zh, editorEffects[key].en)
  return <>
    <Sheet open={editor.open} onOpenChange={editor.setOpen}>
      <SheetContent className="editor-sheet">
        <SheetHeader><SheetTitle>{text(editorEffects.title.zh, editorEffects.title.en)}</SheetTitle><SheetDescription>{text('谱面视觉特效', 'Chart visual effects')}</SheetDescription></SheetHeader>
        <div className="editor-sheet-scroll" data-scroll-region>
          <section className="sheet-section effects-section">
            <Select value="scrollSpeed"><SelectTrigger aria-label={text('特效类型', 'Effect type')}><SelectValue /></SelectTrigger><SelectContent><SelectItem value="scrollSpeed">{text(editorEffects.scrollSpeed.zh, editorEffects.scrollSpeed.en)}</SelectItem></SelectContent></Select>
            <Button onClick={editor.add}><Plus />{text('添加变速', 'Add speed effect')}</Button>
            <div className="tempo-change-list" data-scroll-region>{chart.effects.slice(currentPage * 30, (currentPage + 1) * 30).map((event) => <div key={event.id}>
              <button onClick={() => editor.edit(event)}><span className="effect-list-description"><time>{formatTime(event.time)}{event.endTime !== undefined && ` – ${formatTime(event.endTime)}`}</time><span>{event.transition === 'instant' ? text('瞬时', 'Instant') : text(editorEffects.curves[event.curve ?? 'linear'].zh, editorEffects.curves[event.curve ?? 'linear'].en)}</span></span><strong>{event.multiplier === 0 && <Pause aria-label={text('停速', 'Stop')} />}{effectLabel(event, chart.effects)}</strong></button>
              <Button size="icon-sm" variant="ghost" aria-label={text('删除特效', 'Delete effect')} onClick={() => editor.remove(event.id)}><Trash2 /></Button>
            </div>)}{!chart.effects.length && <p>{text('暂无变速特效', 'No speed effects')}</p>}</div>
            {pageCount > 1 && <div className="effects-pagination"><Button variant="outline" disabled={!currentPage} onClick={() => setPage(currentPage - 1)}>{text('上一页', 'Previous')}</Button><span>{currentPage + 1} / {pageCount}</span><Button variant="outline" disabled={currentPage + 1 >= pageCount} onClick={() => setPage(currentPage + 1)}>{text('下一页', 'Next')}</Button></div>}
          </section>
        </div>
      </SheetContent>
    </Sheet>
    <Dialog open={draft !== null && editor.picking === null} onOpenChange={(open) => { if (!open) editor.requestClose() }}>
      <DialogContent className="tempo-dialog effects-dialog" onKeyDown={(event) => {
        if ((event.ctrlKey || event.metaKey) && (event.key === 'Enter' || event.key.toLowerCase() === 's')) { event.preventDefault(); event.stopPropagation(); if (editor.dirty && !editor.pending) editor.save() }
      }}>
        <DialogHeader><DialogTitle>{text('设置变速', 'Set scroll speed')}</DialogTitle><DialogDescription>{draft && Number.isFinite(draft.time) ? formatTime(draft.time) : '—'}{editor.dirty ? ` · ${copy('changed')}` : ''}</DialogDescription></DialogHeader>
        {draft && <div className="effect-edit-fields">
          {index >= 0 && <div className="effect-navigation"><Button variant="ghost" disabled={index === 0} onClick={() => editor.navigate(chart.effects[index - 1])}><ChevronLeft />{copy('previous')}</Button><span>{index + 1} / {chart.effects.length}</span><Button variant="ghost" disabled={index + 1 === chart.effects.length} onClick={() => editor.navigate(chart.effects[index + 1])}>{copy('next')}<ChevronRight /></Button></div>}
          <div className="effect-position-fields">
            <label><span>{copy('start')} (ms)</span><div><Input aria-label={`${copy('start')} (ms)`} inputMode="decimal" value={draft.startText ?? String(draft.time)} onChange={(e) => editor.setDraft({ ...draft, startText: e.target.value, time: e.target.value.trim() ? Number(e.target.value) : NaN })} /><Button variant="outline" aria-label={`${copy('start')} · ${copy('pick')}`} onClick={editor.pickStart}><Crosshair />{copy('pick')}</Button></div></label>
            {draft.transition === 'linear' && <label><span>{copy('end')} (ms)</span><div><Input aria-label={`${copy('end')} (ms)`} inputMode="decimal" placeholder="—" value={draft.endText ?? (draft.endTime === undefined ? '' : String(draft.endTime))} onChange={(e) => editor.setDraft({ ...draft, endText: e.target.value, endTime: e.target.value.trim() ? Number(e.target.value) : undefined })} /><Button variant="outline" aria-label={`${copy('end')} · ${copy('pick')}`} onClick={editor.pickEnd}><Crosshair />{copy('pick')}</Button></div></label>}
          </div>
          <label><span>{text('目标倍率（0 为停速）', 'Target multiplier (0 stops movement)')}</span><Input autoFocus={!isTouchWeb()} inputMode="decimal" value={draft.multiplier} onChange={(e) => editor.setDraft({ ...draft, multiplier: e.target.value })} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); editor.save() } }} /></label>
          <div className="effect-multiplier-presets">{[0, 0.5, 1, 2, 4].map((value) => <Button key={value} size="sm" variant={draft.multiplier === String(value) ? 'default' : 'outline'} aria-pressed={draft.multiplier === String(value)} onClick={() => editor.setDraft({ ...draft, multiplier: String(value) })}>{value === 0 ? <Pause /> : null}×{value}</Button>)}</div>
          <label><span>{text('变化方式', 'Transition')}</span><Select value={draft.transition} onValueChange={(transition: 'instant' | 'linear') => editor.setDraft({ ...draft, transition })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="instant">{text('瞬时切换', 'Instant')}</SelectItem><SelectItem value="linear">{text('渐变', 'Gradual')}</SelectItem></SelectContent></Select></label>
          {draft.transition === 'linear' && <CurveEditor draft={draft} from={from} onChange={editor.setDraft} />}
          {editor.error && <p role="alert" className="effects-error">{editor.error}</p>}
        </div>}
        <DialogFooter><div>{index >= 0 && draft && <Button variant="destructive" onClick={() => editor.remove(draft.id)}><Trash2 />{copy('remove')}</Button>}</div><Button variant="outline" onClick={editor.requestClose}>{text('取消', 'Cancel')}</Button><Button disabled={!editor.dirty} onClick={editor.save}>{text('保存', 'Save')}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
    <Dialog open={editor.pending !== null} onOpenChange={(open) => { if (!open) editor.dismissPending() }}>
      <DialogContent><DialogHeader><DialogTitle>{copy('discardTitle')}</DialogTitle><DialogDescription>{copy('discardDescription')}</DialogDescription></DialogHeader><DialogFooter><Button variant="outline" onClick={editor.dismissPending}>{copy('keepEditing')}</Button><Button variant="destructive" onClick={editor.discardPending}>{copy('discard')}</Button></DialogFooter></DialogContent>
    </Dialog>
  </>
}
