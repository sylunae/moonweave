import { useState, type FormEvent } from 'react'
import { useI18n } from '@/app/i18n'
import { Dialog, DialogContent, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { GameSelect } from '@/components/ui/game-select'
import { GameButton } from '@/components/ui/game-controls'
import { chooseDifficulty, libraryMetadata, tiers, type Visibility } from './libraryMetadata'
import type { Chart } from './types'

export function LibraryForm({ chart, creating, onClose, onSave }: { chart: Chart; creating: boolean; onClose(): void; onSave(chart: Chart, chooseAudio: boolean): Promise<boolean> }) {
  const { text } = useI18n()
  const meta = libraryMetadata(chart.library)
  const [levels, setLevels] = useState(meta.levels)
  const [hue, setHue] = useState(meta.hue)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    const field = (name: string) => String(data.get(name) ?? '').trim()
    if (!field('title') || !levels.some(Boolean)) { setError(text('请输入标题并设置至少一个难度。', 'Enter a title and enable at least one difficulty.')); return }
    const tier = levels[meta.tier] ? meta.tier : levels.findIndex(Boolean)
    const next = chooseDifficulty({ ...chart, library: { ...meta, levels: levels.map((v, i) => i === meta.tier ? v || 1 : v) } }, tier)
    setSaving(true)
    try {
      if (await onSave({ ...next, title: field('title'), artist: field('artist'), bpm: Number(field('bpm')), duration: Number(field('duration')) * 1000,
        library: { tier, levels, hue, charter: field('charter'), description: field('description'), status: field('status') as Visibility, tags: field('tags').split(/[,，]/).map(s => s.trim()).filter(Boolean) } }, data.has('audio'))) onClose()
    } finally { setSaving(false) }
  }
  return <Dialog open onOpenChange={open => { if (!open && !saving) onClose() }}><DialogContent size="lg" className="library-dialog" aria-describedby={undefined}>
    <DialogTitle>{creating ? text('新建谱面', 'New chart') : text('编辑谱面信息', 'Edit chart information')}</DialogTitle>
    <form onSubmit={submit}><div className="library-fields" data-scroll-region>
      <label className="wide">{text('标题', 'Title')}<Input name="title" required maxLength={100} defaultValue={creating ? '' : chart.title} autoFocus /></label>
      <label>{text('曲师', 'Artist')}<Input name="artist" defaultValue={chart.artist} /></label>
      <label>{text('制谱人', 'Charter')}<Input name="charter" defaultValue={meta.charter} /></label>
      <label>BPM<Input type="number" name="bpm" min="20" max="400" step="any" defaultValue={chart.bpm} required /></label>
      <label>{text('时长（秒）', 'Duration (seconds)')}<Input name="duration" type="number" min=".001" step="any" defaultValue={chart.duration / 1000} required readOnly={!!chart.audioPath} /></label>
      <label className="wide audio-choice"><input type="checkbox" name="audio" />{text('保存后选择音频', 'Choose audio after saving')}{chart.audioName && <small>{chart.audioName}</small>}</label>
      <fieldset className="wide"><legend>{text('难度等级', 'Difficulty levels')}</legend><div className="level-inputs">{tiers.map((name,i) => <label key={name}>{name}<output>{levels[i] || '—'}</output><input type="range" aria-label={name} min={0} max={20} value={levels[i]} onChange={e => setLevels(levels.map((v,k) => k === i ? +e.target.value : v))} /></label>)}</div></fieldset>
      <fieldset className="wide"><legend>{text('封面色调', 'Cover hue')}</legend><div className="hue-picker">{[0,30,60,120,160,190,230,275,320].map(h => <button type="button" key={h} aria-label={String(h)} aria-pressed={hue === h} style={{backgroundColor: `hsl(${h} 62% 55%)`}} onClick={() => setHue(h)} />)}</div></fieldset>
      <label>{text('状态', 'Status')}<GameSelect name="status" label={text('状态','Status')} defaultValue={meta.status} options={[
        ['draft',text('草稿','Draft')], ['private',text('仅自己','Private')], ['published',text('已发布','Published')],
      ]} /></label>
      <label>{text('标签（逗号分隔）', 'Tags (comma separated)')}<Input name="tags" defaultValue={meta.tags.join(', ')} /></label>
      <label className="wide">{text('简介', 'Description')}<Textarea name="description" maxLength={500} defaultValue={meta.description} /></label>
      {error && <p role="alert">{error}</p>}
    </div><DialogFooter><GameButton type="button" disabled={saving} onClick={onClose}>{text('取消','Cancel')}</GameButton><GameButton type="submit" className="primary" disabled={saving}>{text('保存','Save')}</GameButton></DialogFooter></form>
  </DialogContent></Dialog>
}
