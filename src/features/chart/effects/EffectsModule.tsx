import { effectLabel } from './labels'
import { useEffect, useState } from 'react'
import { Pause, Plus, Trash2 } from 'lucide-react'
import { useI18n } from '@/app/i18n'
import { editorEffects } from '@/config/app'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog'
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select'
import { useChart } from '../ChartProvider'
import type { ToolMode } from '../types'
import { normalizeEffects, type ChartEffect } from './scrollSpeed'

const formatTime = (time: number) => `${(time / 1000).toFixed(3)}s`

interface Draft { id: string; time: number; multiplier: string; transition: 'instant' | 'linear'; endTime?: number }

export function useEffectsEditor(tool: ToolMode, setTool: (tool: ToolMode) => void) {
  const { chart, activeChartId, commitEdit, setCurrentTime } = useChart()
  const { text } = useI18n()
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [picking, setPicking] = useState<'start' | 'end' | null>(null)
  const [error, setError] = useState('')
  const cancel = () => { setDraft(null); setPicking(null); setError(''); setTool('note') }
  useEffect(() => { setOpen(false); setDraft(null); setPicking(null); setError('') }, [activeChartId])
  useEffect(() => {
    if (!picking) return
    const keydown = (event: KeyboardEvent) => { if (event.key === 'Escape') cancel() }
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
      setDraft({ ...draft, endTime: time })
    } else setDraft({ id: crypto.randomUUID(), time, multiplier: '1', transition: 'instant' })
    setPicking(null); setTool('note')
  }
  const save = () => {
    if (!draft) return
    const multiplier = Number(draft.multiplier)
    if (!draft.multiplier.trim() || !Number.isFinite(multiplier) || multiplier < 0 || multiplier > 10) {
      setError(text('倍率需在 0–10 之间', 'Multiplier must be between 0 and 10')); return
    }
    if (draft.time > chart.duration || (draft.transition === 'linear' && (draft.endTime === undefined || draft.endTime <= draft.time || draft.endTime > chart.duration))) {
      setError(text('请选择谱面内有效的起止位置', 'Choose valid start and end positions within the chart')); return
    }
    const event: ChartEffect = { id: draft.id, type: 'scrollSpeed', time: draft.time, multiplier, transition: draft.transition,
      ...(draft.transition === 'linear' ? { endTime: draft.endTime } : {}) }
    const candidates = [...chart.effects.filter((e) => e.id !== draft.id), event]
    const effects = normalizeEffects(candidates)
    if (effects.length !== candidates.length) { setError(text('变速位置重复或与渐变区间重叠', 'Duplicate position or overlapping speed transition')); return }
    commitEdit((chart) => ({ ...chart, effects })); cancel()
  }
  return { open, setOpen, draft, setDraft, picking, error, cancel, onLine, save,
    add: () => { setOpen(false); setDraft(null); setError(''); setPicking('start'); setTool('effect') },
    pickEnd: () => { setPicking('end'); setTool('effect') },
    edit: (event: ChartEffect) => { setCurrentTime(event.time); setOpen(false); setError(''); setPicking(null); setTool('note'); setDraft({ ...event, multiplier: String(event.multiplier) }) },
    remove: (id: string) => commitEdit((chart) => ({ ...chart, effects: chart.effects.filter((e) => e.id !== id) })),
    status: picking ? { tone: 'action', title: picking === 'start' ? text('选择变速起点', 'Choose speed effect start') : text('选择渐变终点', 'Choose transition end'),
      detail: error || text('点击目标节拍线 · Esc 取消', 'Choose a beat line · Esc to cancel') } : null,
  }
}

export function EffectsModule({ editor }: { editor: ReturnType<typeof useEffectsEditor> }) {
  const { chart } = useChart()
  const { text } = useI18n()
  const [page, setPage] = useState(0)
  const pageCount = Math.max(1, Math.ceil(chart.effects.length / 30))
  const currentPage = Math.min(page, pageCount - 1)
  const draft = editor.draft
  return <>
    <Sheet open={editor.open} onOpenChange={editor.setOpen}>
      <SheetContent className="editor-sheet">
        <SheetHeader><SheetTitle>{text(editorEffects.title.zh, editorEffects.title.en)}</SheetTitle><SheetDescription>{text('谱面视觉特效', 'Chart visual effects')}</SheetDescription></SheetHeader>
        <div className="editor-sheet-scroll" data-scroll-region>
          <section className="sheet-section effects-section">
            <Select value="scrollSpeed"><SelectTrigger aria-label={text('特效类型', 'Effect type')}><SelectValue /></SelectTrigger><SelectContent><SelectItem value="scrollSpeed">{text(editorEffects.scrollSpeed.zh, editorEffects.scrollSpeed.en)}</SelectItem></SelectContent></Select>
            <Button onClick={editor.add}><Plus />{text('添加变速', 'Add speed effect')}</Button>
            <div className="tempo-change-list" data-scroll-region>{chart.effects.slice(currentPage * 30, (currentPage + 1) * 30).map((event) => <div key={event.id}>
              <button onClick={() => editor.edit(event)}><time>{formatTime(event.time)}{event.endTime !== undefined && ` – ${formatTime(event.endTime)}`}</time><strong>{event.multiplier === 0 && <Pause aria-label={text('停速', 'Stop')} />}{effectLabel(event, chart.effects)}</strong></button>
              <Button size="icon-sm" variant="ghost" aria-label={text('删除特效', 'Delete effect')} onClick={() => editor.remove(event.id)}><Trash2 /></Button>
            </div>)}{!chart.effects.length && <p>{text('暂无变速特效', 'No speed effects')}</p>}</div>
            {pageCount > 1 && <div className="effects-pagination"><Button variant="outline" disabled={!currentPage} onClick={() => setPage(currentPage - 1)}>{text('上一页', 'Previous')}</Button><span>{currentPage + 1} / {pageCount}</span><Button variant="outline" disabled={currentPage + 1 >= pageCount} onClick={() => setPage(currentPage + 1)}>{text('下一页', 'Next')}</Button></div>}
          </section>
        </div>
      </SheetContent>
    </Sheet>
    <Dialog open={draft !== null && editor.picking === null} onOpenChange={(open) => { if (!open) editor.cancel() }}>
      <DialogContent className="tempo-dialog effects-dialog">
        <DialogHeader><DialogTitle>{text('设置变速', 'Set scroll speed')}</DialogTitle><DialogDescription>{draft ? formatTime(draft.time) : ''}</DialogDescription></DialogHeader>
        {draft && <>
          <label><span>{text('目标倍率（0 为停速）', 'Target multiplier (0 stops movement)')}</span><Input autoFocus inputMode="decimal" value={draft.multiplier} onChange={(e) => editor.setDraft({ ...draft, multiplier: e.target.value })} /></label>
          <label><span>{text('变化方式', 'Transition')}</span><Select value={draft.transition} onValueChange={(transition: 'instant' | 'linear') => editor.setDraft({ ...draft, transition })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="instant">{text('瞬时切换', 'Instant')}</SelectItem><SelectItem value="linear">{text('线性渐变', 'Linear')}</SelectItem></SelectContent></Select></label>
          {draft.transition === 'linear' && <Button variant="outline" onClick={editor.pickEnd}>{draft.endTime === undefined ? text('选择结束节拍线', 'Choose end beat line') : `${text('结束', 'End')} · ${formatTime(draft.endTime)}`}</Button>}
          {editor.error && <p role="alert" className="effects-error">{editor.error}</p>}
        </>}
        <DialogFooter><Button variant="outline" onClick={editor.cancel}>{text('取消', 'Cancel')}</Button><Button onClick={editor.save}>{text('保存', 'Save')}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </>
}
