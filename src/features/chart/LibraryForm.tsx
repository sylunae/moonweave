import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useI18n } from '@/app/i18n'
import { Dialog, DialogContent, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { GameButton } from '@/components/ui/game-controls'
import type { ChartInfoMedia } from '@/shared/electron'
import { DifficultyLevelFields } from './DifficultyLevelFields'
import { libraryMetadata } from './libraryMetadata'
import { retimeInitialBpm } from './tempoMap'
import { shiftChartOffset } from './editHistory'
import type { Chart } from './types'

const audioPattern = /\.(mp3|wav|ogg|m4a|flac)$/i
const coverPattern = /\.(png|jpe?g|webp|avif)$/i
const videoPattern = /\.(mp4|webm)$/i

function MediaPicker({ label, name, accept, onChoose }: {
  label: string
  name?: string
  accept: string
  onChoose(input: HTMLInputElement): void
}) {
  const { text } = useI18n()
  const input = useRef<HTMLInputElement>(null)
  return <div className="library-media-picker">
    <span>{label}</span>
    <Input ref={input} type="file" className="sr-only" tabIndex={-1} aria-label={label} accept={accept} onChange={event => onChoose(event.currentTarget)} />
    <GameButton type="button" aria-label={label} onClick={() => input.current?.click()}>{name ? text('替换文件', 'Replace file') : text('选择文件', 'Choose file')}</GameButton>
    {name && <small>{name}</small>}
  </div>
}

export function LibraryForm({ chart, coverUrl, creating, focusTier, onClose, onSave }: {
  chart: Chart
  coverUrl?: string
  creating: boolean
  focusTier?: number
  onClose(): void
  onSave(chart: Chart, media: ChartInfoMedia): Promise<boolean>
}) {
  const { text } = useI18n()
  const meta = libraryMetadata(chart.library)
  const [media, setMedia] = useState<ChartInfoMedia>({})
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [selectedCover, setSelectedCover] = useState('')
  useEffect(() => {
    const url = media.cover ? URL.createObjectURL(media.cover) : ''
    setSelectedCover(url)
    return () => { if (url) URL.revokeObjectURL(url) }
  }, [media.cover])
  const previewCover = media.cover === undefined ? coverUrl : selectedCover
  const showVideoOffset = media.background === undefined ? chart.backgroundType === 'video' : videoPattern.test(media.background?.name ?? '')
  const selectMedia = (key: keyof ChartInfoMedia, input: HTMLInputElement) => {
    const file = input.files?.[0]
    input.value = ''
    if (!file) return
    const supported = file.size > 0 && (key === 'audio' ? audioPattern.test(file.name) : coverPattern.test(file.name) || (key === 'background' && videoPattern.test(file.name)))
    if (!supported) {
      setError(text('请选择受支持的媒体文件。', 'Choose a supported media file.'))
      return
    }
    setMedia(current => ({ ...current, [key]: file }))
    setError('')
  }
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (saving) return
    const data = new FormData(event.currentTarget)
    const field = (name: string) => String(data.get(name) ?? '').trim()
    if (!field('title') || (creating && !media.audio)) {
      setError(text('请输入标题并选择音频文件。', 'Enter a title and select an audio file.'))
      return
    }
    let next: Chart
    try {
      next = shiftChartOffset(retimeInitialBpm(chart, Number(field('bpm'))), Number(field('offset')))
    } catch {
      setError(text('偏移不能将事件移到谱面起点之前。', 'Offset cannot move events before the chart start.'))
      return
    }
    const levels = creating ? meta.levels : meta.levels.map((level, index) => Number(field(`level-${index}`)) || level)
    setSaving(true)
    setError('')
    try {
      if (await onSave({
        ...next, title: field('title'), artist: field('artist'),
        duration: field('duration') ? Number(field('duration')) * 1000 : chart.duration,
        backgroundVideoStartTime: showVideoOffset ? Number(field('videoStart')) : 0,
        library: { ...meta, levels, charter: field('charter') },
      }, media)) onClose()
    } finally { setSaving(false) }
  }
  return <Dialog open onOpenChange={open => { if (!open && !saving) onClose() }}><DialogContent size="lg" className="library-dialog" aria-describedby={undefined}>
    <DialogTitle>{creating ? text('新建谱面', 'New chart') : text('编辑谱面信息', 'Edit chart information')}</DialogTitle>
    <form onSubmit={submit}><fieldset disabled={saving} className="library-fields" data-scroll-region>
      <label className="wide">{text('标题', 'Title')}<Input name="title" required maxLength={100} defaultValue={creating ? '' : chart.title} autoFocus={focusTier === undefined} /></label>
      <label>{text('曲师', 'Artist')}<Input name="artist" defaultValue={chart.artist} /></label>
      <label>{text('制谱人', 'Charter')}<Input name="charter" defaultValue={meta.charter} /></label>
      <label>{text('初始 BPM', 'Initial BPM')}<Input type="number" name="bpm" min="20" max="400" step="any" defaultValue={chart.bpm} required /></label>
      <label>{text('谱面偏移（ms）', 'Chart offset (ms)')}<Input type="number" name="offset" step="any" defaultValue={chart.offset} required /></label>
      {!creating && !media.audio && <label className="wide">{text('时长（秒）', 'Duration (seconds)')}<Input name="duration" type="number" min=".001" step="any" defaultValue={chart.duration / 1000} required readOnly={!!chart.audioPath} /></label>}
      <div className="wide"><MediaPicker label={creating ? text('音频文件（必选）', 'Audio file (required)') : text('音频文件', 'Audio file')}
        name={media.audio?.name || chart.audioName} accept=".mp3,.wav,.ogg,.m4a,.flac" onChoose={input => selectMedia('audio', input)} /></div>
      <div className="wide managed-media-row">
        {previewCover && <span className="audio-icon cover-preview"><img src={previewCover} alt="" /></span>}
        <MediaPicker label={text('曲目封面', 'Cover art')} name={media.cover === undefined ? chart.coverName : media.cover?.name}
          accept=".png,.jpg,.jpeg,.webp,.avif" onChoose={input => selectMedia('cover', input)} />
        {(media.cover || (media.cover === undefined && chart.coverName)) && <GameButton type="button" onClick={() => setMedia(current => ({ ...current, cover: null }))}>{text('移除封面', 'Remove cover')}</GameButton>}
      </div>
      <div className="wide managed-media-row">
        <MediaPicker label={text('试玩背景', 'Playtest background')} name={media.background === undefined ? chart.backgroundName : media.background?.name}
          accept=".png,.jpg,.jpeg,.webp,.avif,.mp4,.webm" onChoose={input => selectMedia('background', input)} />
        {(media.background || (media.background === undefined && chart.backgroundName)) && <GameButton type="button" onClick={() => setMedia(current => ({ ...current, background: null }))}>{text('移除背景', 'Remove background')}</GameButton>}
      </div>
      {showVideoOffset && <label className="wide">{text('视频起始偏移（ms）', 'Video start offset (ms)')}<Input type="number" name="videoStart" step={1} defaultValue={media.background ? 0 : chart.backgroundVideoStartTime} required /></label>}
      {!creating && <DifficultyLevelFields levels={meta.levels} focusTier={focusTier} />}
      {error && <p className="wide" role="alert">{error}</p>}
    </fieldset><DialogFooter><GameButton type="button" disabled={saving} onClick={onClose}>{text('取消','Cancel')}</GameButton><GameButton type="submit" className="primary" disabled={saving}>{creating ? text('创建','Create') : text('保存','Save')}</GameButton></DialogFooter></form>
  </DialogContent></Dialog>
}
