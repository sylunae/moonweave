import { useEffect, useRef, useState, type RefObject } from 'react'
import { Pause, Play, VolumeX, X } from 'lucide-react'
import { useI18n } from '@/app/i18n'
import { Button } from '@/components/ui/button'
import { Slider } from '@/components/ui/slider'
import { backgroundVideoPreviewCopy as copy } from '@/config/app'
import { canPlayBackgroundVideo, syncBackgroundVideoTime } from '@/features/playtest/backgroundVideo'

type Props = {
  src: string
  audioRef: RefObject<HTMLAudioElement | null>
  hasAudio: boolean
  currentTime: number
  duration: number
  startTime: number
  isPlaying: boolean
  onTogglePlay: () => void
  onSeek: (time: number) => void
  onClose: () => void
}

export function BackgroundVideoPreview({
  src, audioRef, hasAudio, currentTime, duration, startTime, isPlaying, onTogglePlay, onSeek, onClose,
}: Props) {
  const { text } = useI18n()
  const videoRef = useRef<HTMLVideoElement>(null)
  const [failed, setFailed] = useState(false)
  const [seekDraft, setSeekDraft] = useState<number | null>(null)
  const reachedVideoStart = currentTime >= startTime
  const maxTime = Math.max(1, Math.round(duration))

  useEffect(() => {
    const video = videoRef.current
    const audio = audioRef.current
    if (!audio || !video || failed) return
    let frame = 0
    let disposed = false
    let needsAlignment = true

    function sync() {
      if (!audio || !video || video.error) return
      const chartTime = audio.currentTime * 1000
      const playing = canPlayBackgroundVideo(audio, chartTime, startTime)
      const align = needsAlignment && video.readyState > 0 && !video.seeking
      if (align) needsAlignment = false
      syncBackgroundVideoTime(video, chartTime, startTime, audio.playbackRate, align || !playing ? 0.01 : undefined)
      if (!playing) {
        if (!video.paused) video.pause()
      } else if (video.paused && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && !video.seeking) {
        void video.play().catch((error: unknown) => {
          if (!disposed && !(error instanceof DOMException && error.name === 'AbortError')) setFailed(true)
        })
      }
      if (!frame && !audio.paused && !audio.ended) {
        frame = requestAnimationFrame(() => { frame = 0; sync() })
      }
    }

    const handleSeek = () => { needsAlignment = true; sync() }
    const audioEvents = ['playing', 'pause', 'waiting', 'timeupdate', 'seeking', 'ratechange', 'ended'] as const
    const videoEvents = ['loadedmetadata', 'canplay', 'seeked'] as const
    for (const event of audioEvents) audio.addEventListener(event, sync)
    for (const event of videoEvents) video.addEventListener(event, sync)
    audio.addEventListener('seeked', handleSeek)
    document.addEventListener('visibilitychange', sync)
    sync()
    return () => {
      disposed = true
      cancelAnimationFrame(frame)
      for (const event of audioEvents) audio.removeEventListener(event, sync)
      for (const event of videoEvents) video.removeEventListener(event, sync)
      audio.removeEventListener('seeked', handleSeek)
      document.removeEventListener('visibilitychange', sync)
      if (!video.paused) video.pause()
    }
  }, [audioRef, failed, src, startTime])

  const title = text(copy.title.zh, copy.title.en)
  const playLabel = isPlaying ? text('暂停', 'Pause') : text('播放', 'Play')
  return (
    <section className="video-preview" aria-label={title}>
      <header>
        <strong>{title}</strong>
        <span title={text(copy.muted.zh, copy.muted.en)}><VolumeX aria-label={text(copy.muted.zh, copy.muted.en)} /></span>
        <Button type="button" variant="ghost" size="icon-sm" aria-label={text(copy.close.zh, copy.close.en)} onClick={onClose}><X /></Button>
      </header>
      <div className="video-preview-frame">
        <video ref={videoRef} src={src} muted loop playsInline preload="metadata" disablePictureInPicture
          data-active={reachedVideoStart && !failed} onError={() => setFailed(true)} />
        {failed && <span role="status">{text(copy.videoError.zh, copy.videoError.en)}</span>}
        {!failed && !reachedVideoStart && <span>{text(copy.waiting.zh, copy.waiting.en)}</span>}
      </div>
      {hasAudio ? (
        <div className="video-preview-transport">
          <Button type="button" variant="outline" size="icon" aria-label={playLabel} title={playLabel} onClick={onTogglePlay}>{isPlaying ? <Pause /> : <Play />}</Button>
          <Slider thumbLabel={text(copy.position.zh, copy.position.en)} max={maxTime} step={1}
            value={[Math.min(maxTime, Math.round(seekDraft ?? currentTime))]}
            onValueChange={([time]) => setSeekDraft(time)}
            onValueCommit={([time]) => { setSeekDraft(null); onSeek(time) }} />
        </div>
      ) : <small>{text(copy.audioRequired.zh, copy.audioRequired.en)}</small>}
    </section>
  )
}
