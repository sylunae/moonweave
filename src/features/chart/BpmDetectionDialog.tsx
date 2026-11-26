import { useEffect, useState } from 'react'
import { useI18n } from '@/app/i18n'
import { isTouchWeb } from '@/app/mobileBack'
import { bpmDetectionCopy } from '@/config/app'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { detectBpm, type BpmFailureReason } from './detectBpm'
import type { BpmEstimate } from './bpmAnalysis'

export function BpmDetectionDialog({ url, onApply, onUnavailable }: {
  url: string
  onApply(bpm: number): void
  onUnavailable(reason: BpmFailureReason): void
}) {
  const { text } = useI18n()
  const copy = (key: keyof typeof bpmDetectionCopy) => text(bpmDetectionCopy[key].zh, bpmDetectionCopy[key].en)
  const [estimate, setEstimate] = useState<BpmEstimate | null>(null)
  const [draft, setDraft] = useState('')
  const [open, setOpen] = useState(false)
  useEffect(() => {
    const controller = new AbortController()
    let active = true
    const timer = window.setTimeout(() => { controller.abort(); if (active) onUnavailable('failed') }, 45_000)
    void detectBpm(url, controller.signal).then((result) => {
      if (!active || controller.signal.aborted) return
      if (!result) { onUnavailable('unavailable'); return }
      setEstimate(result); setDraft(String(result.bpm)); setOpen(true)
    }).catch((error) => { if (active && !controller.signal.aborted) onUnavailable(error instanceof RangeError ? 'unsupported' : 'failed') }).finally(() => window.clearTimeout(timer))
    return () => { active = false; window.clearTimeout(timer); controller.abort() }
  }, [url, onUnavailable])
  const bpm = Number(draft)
  const valid = draft !== '' && Number.isFinite(bpm) && bpm >= 20 && bpm <= 400
  const apply = () => { if (valid) { onApply(bpm); setOpen(false) } }
  const scale = (factor: number) => setDraft(String(Math.round(bpm * factor * 10) / 10))
  return <Dialog open={open} onOpenChange={setOpen}>
    <DialogContent className="tempo-dialog">
      <DialogHeader>
        <DialogTitle>{copy(estimate?.reliable ? 'title' : 'uncertainTitle')}</DialogTitle>
        <DialogDescription>{!estimate?.reliable && <>{copy('uncertain')}<br /></>}{copy('description')}</DialogDescription>
      </DialogHeader>
      <label><span>{copy('label')}</span><Input autoFocus={!isTouchWeb()} inputMode="decimal" value={draft} aria-invalid={!valid} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') apply() }} /></label>
      <div className="flex gap-2">
        <Button variant="outline" disabled={!valid || bpm / 2 < 20} onClick={() => scale(0.5)}>÷2 {copy('half')}</Button>
        <Button variant="outline" disabled={!valid || bpm * 2 > 400} onClick={() => scale(2)}>×2 {copy('double')}</Button>
      </div>
      <DialogFooter><Button variant="outline" onClick={() => setOpen(false)}>{copy('ignore')}</Button><Button disabled={!valid} onClick={apply}>{copy('apply')}</Button></DialogFooter>
    </DialogContent>
  </Dialog>
}
