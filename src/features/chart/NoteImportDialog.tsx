import { useEffect, useMemo, useRef, useState } from 'react'
import { FileUp } from 'lucide-react'
import { useI18n } from '@/app/i18n'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { GameSelect } from '@/components/ui/game-select'
import { noteImportTitle } from '@/config/app'
import { useChart } from './ChartProvider'
import { libraryMetadata, tiers } from './libraryMetadata'
import { noteImportIssue, readNoteSource } from './noteImport'
import type { Chart } from './types'

export default function NoteImportDialog({ onClose, onApplied }: { onClose(): void; onApplied(): void }) {
  const { text } = useI18n()
  const { chart, activeChartId, importNotes, showToast } = useChart()
  const targetTier = libraryMetadata(chart.library).tier
  const [file, setFile] = useState<{ name: string; chart: Chart } | null>(null)
  const [selection, setSelection] = useState<number>()
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const mounted = useRef(false)
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])

  const source = file?.chart ?? chart
  const meta = libraryMetadata(source.library)
  const sources = tiers.flatMap((name, tier) => {
    if (!meta.levels[tier] || (!file && tier === targetTier)) return []
    const notes = tier === meta.tier ? source.notes : source.tracks?.[tier]?.notes ?? []
    return [{ tier, name, notes }]
  })
  const selected = sources.find(option => option.tier === selection)
    ?? sources.find(option => option.tier === (file ? meta.tier : 1) && option.notes.length > 0)
    ?? sources.find(option => option.notes.length > 0)
    ?? sources[0]
  const notes = selected?.notes
  const issue = useMemo(() => notes ? noteImportIssue(notes, chart.duration) : null, [notes, chart.duration])
  const issueText = (code: 'duration' | 'duplicate' | 'stale') => ({
    duration: text('有音符超出当前谱面的时长。', 'Some notes fall outside the current chart duration.'),
    duplicate: text('来源含有缺失或重复的音符 ID。', 'The source has missing or duplicate note IDs.'),
    stale: text('目标难度已变化，请重新打开导入。', 'The target difficulty changed. Reopen the import dialog.'),
  }[code])

  const load = async (selectedFile: File) => {
    setBusy(true)
    setError('')
    try {
      const imported = await readNoteSource(selectedFile)
      if (mounted.current) {
        setFile({ name: selectedFile.name, chart: imported })
        setSelection(undefined)
      }
    } catch (reason) {
      if (mounted.current) setError(reason instanceof RangeError
        ? text('文件超出大小限制。请使用不超过 8 MB 的谱面 JSON，或不超过 128 MB 的谱面包。', 'Use a chart JSON up to 8 MB or a chart package up to 128 MB.')
        : text('无法读取谱面。请选择有效的 Moonweave 谱面包或原生 JSON。', 'Choose a valid Moonweave chart package or native JSON.'))
    } finally { if (mounted.current) setBusy(false) }
  }

  const apply = async () => {
    if (busy || error || !notes?.length || issue) return
    setBusy(true)
    try {
      const result = await importNotes(notes, activeChartId, targetTier)
      if (!mounted.current) return
      if (result === 'saved' || result === 'unsaved') {
        onApplied()
        if (result === 'saved') showToast(text('音符已导入，可撤销', 'Notes imported. You can undo this edit.'))
        else showToast(text('音符已导入，保存失败。可重试保存或撤销。', 'Notes were imported but saving failed. Retry saving or undo the edit.'))
        onClose()
      } else setError(issueText(result))
    } finally { if (mounted.current) setBusy(false) }
  }

  return <Dialog open onOpenChange={open => { if (!open && !busy) onClose() }}>
    <DialogContent showCloseButton={!busy}>
      <DialogHeader>
        <DialogTitle>{text(noteImportTitle.zh, noteImportTitle.en)} · {tiers[targetTier]}</DialogTitle>
        <DialogDescription>{text('导入将替换当前难度的音符，保留原有时间位置。', 'Import replaces the current difficulty’s notes using their original timestamps.')}</DialogDescription>
      </DialogHeader>
      <div className="flex flex-col gap-3 text-sm">
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" disabled={busy} onClick={() => input.current?.click()}><FileUp />{text('选择谱面文件', 'Choose chart file')}</Button>
          {(file || error) && <Button variant="ghost" disabled={busy} onClick={() => { setFile(null); setSelection(undefined); setError('') }}>{text('使用本谱面', 'Use this chart')}</Button>}
          <input ref={input} type="file" accept=".mwchart,.json" hidden onChange={event => {
            const selectedFile = event.currentTarget.files?.[0]
            event.currentTarget.value = ''
            if (selectedFile) void load(selectedFile)
          }} />
        </div>
        {file && <p className="break-all">{file.name}</p>}
        {selected ? <GameSelect label={text('来源难度', 'Source difficulty')} disabled={busy} value={String(selected.tier)}
          options={sources.map(option => [String(option.tier), `${option.name} · ${text(`${option.notes.length} 个音符`, `${option.notes.length} notes`)}`])}
          onValueChange={value => { setSelection(Number(value)); setError('') }} />
          : <p>{text('本谱面暂无其他难度。', 'This chart has no other difficulties.')}</p>}
        {selected && !notes?.length && <p>{text('所选难度没有音符。', 'The selected difficulty has no notes.')}</p>}
        {(error || issue) && <p role="alert" className="text-destructive">{error || (issue && issueText(issue))}</p>}
      </div>
      <DialogFooter>
        <Button variant="outline" disabled={busy} onClick={onClose}>{text('取消', 'Cancel')}</Button>
        <Button disabled={busy || !!error || !notes?.length || !!issue} onClick={() => void apply()}>
          {chart.notes.length ? text(`替换 ${chart.notes.length} 个音符`, `Replace ${chart.notes.length} notes`) : text('导入', 'Import')}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
}
