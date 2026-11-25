import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useI18n } from '@/app/i18n'
import { Dialog, DialogContent, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { GameButton } from '@/components/ui/game-controls'
import type { ChartInfoMedia, YoutubeChartImport } from '@/shared/electron'
import { DifficultyLevelFields } from './DifficultyLevelFields'
import { libraryMetadata } from './libraryMetadata'
import { retimeInitialBpm } from './tempoMap'
import { shiftChartOffset } from './editHistory'
import type { Chart } from './types'
import { YoutubeImportFields } from './YoutubeImportFields'

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
  const [title, setTitle] = useState(creating ? '' : chart.title)
  const [artist, setArtist] = useState(chart.artist)
  const [imported, setImported] = useState<YoutubeChartImport>()
  const [downloading, setDownloading] = useState(false)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [selectedCover, setSelectedCover] = useState('')
  const importedCover = media.cover === undefined ? imported?.cover : undefined
  useEffect(() => {
    const blob = media.cover || (importedCover && new Blob([importedCover.slice().buffer as ArrayBuffer], { type: 'image/jpeg' }))
    const url = blob ? URL.createObjectURL(blob) : ''
    setSelectedCover(url)
    return () => { if (url) URL.revokeObjectURL(url) }
  }, [importedCover, media.cover])
  const previewCover = media.cover === undefined && !importedCover ? coverUrl : selectedCover
  const audioName = media.audio?.name || imported?.audioName || chart.audioName
  const importedDuration = media.audio ? undefined : imported?.duration
  const showVideoOffset = media.background === undefined ? chart.backgroundType === 'video' : videoPattern.test(media.background?.name ?? '')
  const applyYoutubeImport = (id: string, result: YoutubeChartImport) => {
    setImported(result)
    setMedia(current => ({ ...current, audio: undefined, cover: result.cover ? undefined : current.cover, youtubeImportId: id }))
    setTitle(result.title)
    setArtist(result.artist)
    setError('')
  }
  const selectMedia = (key: 'audio' | 'background' | 'cover', input: HTMLInputElement) => {
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
    if (saving || downloading) return
    const data = new FormData(event.currentTarget)
    const field = (name: string) => String(data.get(name) ?? '').trim()
    if (!field('title') || (creating && !media.audio && !media.youtubeImportId)) {
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
        duration: importedDuration ?? (field('duration') ? Number(field('duration')) * 1000 : chart.duration),
        backgroundVideoStartTime: showVideoOffset ? Number(field('videoStart')) : 0,
        library: { ...meta, levels, charter: field('charter') },
      }, media)) onClose()
    } finally { setSaving(false) }
  }
  return <Dialog open onOpenChange={open => { if (!open && !saving) onClose() }}><DialogContent size="lg" className="library-dialog" aria-describedby={undefined}>
    <DialogTitle>{creating ? text('新建谱面', 'New chart') : text('编辑谱面信息', 'Edit chart information')}</DialogTitle>
    <form onSubmit={submit}><fieldset disabled={saving || downloading} className="library-fields" data-scroll-region>
      {creating && <YoutubeImportFields onImported={applyYoutubeImport} onDownloading={setDownloading} />}
      <label className="wide">{text('标题', 'Title')}<Input name="title" required maxLength={100} value={title} onChange={event => setTitle(event.target.value)} autoFocus={focusTier === undefined} /></label>
      <label>{text('曲师', 'Artist')}<Input name="artist" value={artist} onChange={event => setArtist(event.target.value)} /></label>
      <label>{text('制谱人', 'Charter')}<Input name="charter" defaultValue={meta.charter} /></label>
      <label>{text('初始 BPM', 'Initial BPM')}<Input type="number" name="bpm" min="20" max="400" step="any" defaultValue={chart.bpm} required /></label>
      <label>{text('谱面偏移（ms）', 'Chart offset (ms)')}<Input type="number" name="offset" step="any" defaultValue={chart.offset} required /></label>
      {!creating && !media.audio && <label className="wide">{text('时长（秒）', 'Duration (seconds)')}<Input name="duration" type="number" min=".001" step="any" defaultValue={chart.duration / 1000} required readOnly={!!chart.audioPath} /></label>}
      {importedDuration !== undefined && <label className="wide">{text('时长（秒）', 'Duration (seconds)')}<Input type="number" value={importedDuration / 1000} readOnly /></label>}
      <div className="wide"><MediaPicker label={creating ? text('音频文件（必选）', 'Audio file (required)') : text('音频文件', 'Audio file')}
        name={audioName} accept=".mp3,.wav,.ogg,.m4a,.flac" onChoose={input => selectMedia('audio', input)} /></div>
      <div className="wide managed-media-row">
        {previewCover && <span className="audio-icon cover-preview"><img src={previewCover} alt="" /></span>}
        <MediaPicker label={text('曲目封面', 'Cover art')} name={importedCover ? text('YouTube 缩略图', 'YouTube thumbnail') : media.cover === undefined ? chart.coverName : media.cover?.name}
          accept=".png,.jpg,.jpeg,.webp,.avif" onChoose={input => selectMedia('cover', input)} />
        {(importedCover || media.cover || (media.cover === undefined && chart.coverName)) && <GameButton type="button" onClick={() => setMedia(current => ({ ...current, cover: null }))}>{text('移除封面', 'Remove cover')}</GameButton>}
      </div>
      <div className="wide managed-media-row">
        <MediaPicker label={text('试玩背景', 'Playtest background')} name={media.background === undefined ? chart.backgroundName : media.background?.name}
          accept=".png,.jpg,.jpeg,.webp,.avif,.mp4,.webm" onChoose={input => selectMedia('background', input)} />
        {(media.background || (media.background === undefined && chart.backgroundName)) && <GameButton type="button" onClick={() => setMedia(current => ({ ...current, background: null }))}>{text('移除背景', 'Remove background')}</GameButton>}
      </div>
      {showVideoOffset && <label className="wide">{text('视频起始偏移（ms）', 'Video start offset (ms)')}<Input type="number" name="videoStart" step={1} defaultValue={media.background ? 0 : chart.backgroundVideoStartTime} required /></label>}
      {!creating && <DifficultyLevelFields levels={meta.levels} focusTier={focusTier} />}
      {error && <p className="wide" role="alert">{error}</p>}
    </fieldset><DialogFooter><GameButton type="button" disabled={saving} onClick={onClose}>{text('取消','Cancel')}</GameButton><GameButton type="submit" className="primary" disabled={saving || downloading}>{creating ? text('创建','Create') : text('保存','Save')}</GameButton></DialogFooter></form>
  </DialogContent></Dialog>
}
