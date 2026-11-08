import { useEffect, useMemo, useRef, useState } from 'react'
import { Download, FileJson } from 'lucide-react'
import { useI18n } from '@/app/i18n'
import { aiChartCopy } from '@/config/app'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Checkbox } from '@/components/ui/checkbox'
import { useChart } from '../ChartProvider'
import { beatAtTime, bpmAtTime } from '../tempoMap'
import { AI_MAX_BYTES, AiChartError, aiChartBase, createAiContext, parseAiJson, prepareAiImport, prepareChartTransfer, type AiIssue, type AiPlan } from './aiChart'

export default function AiChartDialog({ onClose, onApplied, subdivision, initialRange }: {
  onClose(): void
  onApplied(): void
  subdivision: number
  initialRange: { start: number; end: number } | null
}) {
  const { chart, activeChartId, currentTime, isPlaying, applyAiImport, showToast } = useChart()
  const { text } = useI18n()
  const copy = (key: Exclude<keyof typeof aiChartCopy, 'errors'>) => text(aiChartCopy[key].zh, aiChartCopy[key].en)
  const [start, setStart] = useState(String(initialRange?.start ?? 0))
  const [end, setEnd] = useState(String(initialRange?.end ?? chart.duration))
  const [source, setSource] = useState('')
  const [transfer, setTransfer] = useState(true)
  const [issues, setIssues] = useState<AiIssue[]>([])
  const [generalError, setGeneralError] = useState('')
  const [plan, setPlan] = useState<AiPlan | null>(null)
  const [busy, setBusy] = useState(false)
  const sequence = useRef(0)
  const fileRef = useRef<HTMLInputElement>(null)
  useEffect(() => () => { sequence.current += 1 }, [])
  const base = useMemo(() => aiChartBase(chart), [chart.title, chart.artist, chart.audioName, chart.audioPath, chart.duration, chart.bpm, chart.offset, chart.bpmChanges, chart.notes, chart.effects, chart.aiImportHistory])
  const stale = plan !== null && (plan.chartId !== activeChartId || plan.base !== base)
  const report = (error: unknown) => {
    setPlan(null)
    if (error instanceof AiChartError) { setIssues(error.issues); setGeneralError('') }
    else { setIssues([]); setGeneralError(copy('failed')) }
  }
  const reset = () => { sequence.current += 1; setBusy(false); setPlan(null); setIssues([]); setGeneralError('') }
  const validate = async () => {
    const ticket = ++sequence.current
    setBusy(true); setPlan(null); setIssues([]); setGeneralError('')
    try {
      const next = await (transfer ? prepareChartTransfer : prepareAiImport)(chart, activeChartId, parseAiJson(source))
      if (ticket === sequence.current) setPlan(next)
    } catch (error) { if (ticket === sequence.current) report(error) }
    finally { if (ticket === sequence.current) setBusy(false) }
  }
  const readFile = async (file: File) => {
    reset()
    const ticket = ++sequence.current
    setBusy(true)
    try {
      if (file.size > AI_MAX_BYTES) throw new AiChartError([{ code: 'size', path: '$' }])
      const content = await file.text()
      if (ticket === sequence.current) setSource(content)
    } catch (error) { if (ticket === sequence.current) report(error) }
    finally { if (ticket === sequence.current) setBusy(false) }
  }
  const exportContext = async () => {
    const ticket = ++sequence.current
    setBusy(true); setIssues([]); setGeneralError('')
    try {
      if (!chart.audioName) { setGeneralError(copy('noAudio')); return }
      if (!start.trim() || !end.trim()) throw new AiChartError([{ code: 'range', path: 'range' }])
      const context = await createAiContext(chart, activeChartId, currentTime, subdivision, { start: Number(start), end: Number(end) }, isPlaying)
      if (ticket !== sequence.current) return
      const url = URL.createObjectURL(new Blob([JSON.stringify(context, null, 2)], { type: 'application/json' }))
      const anchor = document.createElement('a')
      anchor.href = url; anchor.download = 'moonweave-ai-context.json'; anchor.click()
      window.setTimeout(() => URL.revokeObjectURL(url), 1000)
      showToast(copy('exported'))
    } catch (error) { if (ticket === sequence.current) report(error) }
    finally { if (ticket === sequence.current) setBusy(false) }
  }
  const apply = async () => {
    if (!plan || stale) return
    const ticket = ++sequence.current
    setBusy(true)
    try {
      const saved = await applyAiImport(plan)
      if (ticket !== sequence.current) return
      setPlan(null); setSource('')
      onApplied()
      if (saved) { showToast(copy('applied')); onClose() }
      else setGeneralError(copy('saveFailed'))
    } catch (error) { if (ticket === sequence.current) report(error) }
    finally { if (ticket === sequence.current) setBusy(false) }
  }
  return <Dialog open onOpenChange={(open) => { if (!open && !busy) onClose() }}>
    <DialogContent size="lg" className="ai-chart-dialog" showCloseButton={!busy} onKeyDown={(event) => event.stopPropagation()} onInteractOutside={(event) => { if (busy) event.preventDefault() }}>
      <DialogHeader><DialogTitle>{copy('title')}</DialogTitle><DialogDescription>{copy('description')}</DialogDescription></DialogHeader>
      <div className="ai-chart-body" data-scroll-region>
        <p className="ai-chart-position">{chart.title} · {copy('position')} {(currentTime / 1000).toFixed(3)}s · {beatAtTime(chart, currentTime).toFixed(3)} {copy('beat')} · {bpmAtTime(chart, currentTime)} BPM · 1/{subdivision}</p>
        <div className="ai-chart-range">
          <label><span>{copy('start')}</span><Input inputMode="decimal" value={start} disabled={busy} onChange={(event) => setStart(event.target.value)} /></label>
          <label><span>{copy('end')}</span><Input inputMode="decimal" value={end} disabled={busy} onChange={(event) => setEnd(event.target.value)} /></label>
        </div>
        <div className="ai-chart-actions">
          <Button variant="outline" disabled={busy || !chart.audioName} onClick={() => void exportContext()}><Download />{copy('export')}</Button>
          <Button variant="outline" disabled={busy} onClick={() => fileRef.current?.click()}><FileJson />{copy('import')}</Button>
          <input ref={fileRef} type="file" accept=".json,application/json" hidden onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void readFile(file) }} />
        </div>
        <label className="flex items-center gap-2 text-sm"><Checkbox checked={transfer} disabled={busy} onCheckedChange={(value) => { reset(); setTransfer(value === true) }} />{copy('transfer')}</label>
        {!transfer && !chart.audioName && <p className="ai-chart-error">{copy('noAudio')}</p>}
        <label className="ai-chart-source"><span>{copy('source')}</span><Textarea value={source} disabled={busy} spellCheck={false} placeholder={copy('placeholder')} onChange={(event) => { reset(); setSource(event.target.value) }} /></label>
        {generalError && <p role="alert" className="ai-chart-error">{generalError}</p>}
        {issues.length > 0 && <div role="alert" className="ai-chart-issues" data-scroll-region aria-label={copy('issues')}>{issues.map((issue, index) => <p key={index}><code>{issue.path}</code><span>{text(aiChartCopy.errors[issue.code].zh, aiChartCopy.errors[issue.code].en)}</span></p>)}</div>}
        {plan && <div className="ai-chart-preview" role="status">
          <strong>{stale ? copy('stalePreview') : copy('ready')}</strong>
          <p>{copy(plan.mode)}</p>
          <p>{copy('appliedRange')}：{plan.range.start} – {plan.range.end}</p>
          <dl>{(['added', 'updated', 'deleted', 'holds'] as const).map((key) => <div key={key}><dt>{copy(key)}</dt><dd>{plan.summary[key]}</dd></div>)}</dl>
          <p>{copy('timing')}：{plan.next.bpm} / {plan.next.offset}</p>
        </div>}
      </div>
      <DialogFooter>
        <Button variant="outline" disabled={busy} onClick={onClose}>{copy('close')}</Button>
        <Button variant="outline" disabled={busy || !source.trim() || (!transfer && !chart.audioName)} onClick={() => void validate()}>{copy('validate')}</Button>
        <Button disabled={busy || !plan || stale} onClick={() => void apply()}>{busy ? copy('busy') : copy('apply')}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
}
