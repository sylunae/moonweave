import { useEffect, useRef, type RefObject } from 'react'
import { useI18n } from '@/app/i18n'
import { useChart } from './ChartProvider'
import { beatAtTime, timeAtBeat } from './tempoMap'
import { clockTime } from './LibraryCards'
import type { Chart } from './types'

export function LibraryPreview({ id, chart, fraction, playhead, elapsed, onClose, muted }: {
  id: string; chart: Chart; fraction: number; playhead: RefObject<HTMLSpanElement | null>
  elapsed: RefObject<HTMLSpanElement | null>
  onClose(): void; muted: boolean
}) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const audio = useRef<HTMLAudioElement>(null)
  const { inspectAudio, showToast } = useChart()
  const { text } = useI18n()
  const failure = text('无法播放歌曲音频', 'Could not play song audio')
  const silent = text('此谱面未添加歌曲音频', 'This chart has no song audio')
  useEffect(() => {
    const surface = canvas.current!
    const ctx = surface.getContext('2d')
    const player = audio.current!
    let live = true
    let ownedUrl = ''
    let frame = 0
    const fail = () => { if (live) { showToast(failure); onClose() } }
    const start = Math.max(0, timeAtBeat(chart, Math.floor(beatAtTime(chart, chart.duration * fraction) / 4) * 4))
    const notes = chart.notes.filter(note => (note.endTime ?? note.time) >= start)
      .sort((a, b) => a.time - b.time)
    const visible = new Set<Chart['notes'][number]>()
    let next = 0
    const style = getComputedStyle(surface)
    const accent = style.color
    const white = style.getPropertyValue('--preview-note').trim()
    const red = style.getPropertyValue('--red-zone').trim()
    let width = 1
    const resize = () => {
      width = Math.max(1, surface.clientWidth)
      const pixels = Math.round(width * Math.min(window.devicePixelRatio || 1, 2))
      surface.width = surface.height = pixels
      ctx?.setTransform(pixels / width, 0, 0, pixels / width, 0, 0)
    }
    resize()
    const observer = new ResizeObserver(resize)
    observer.observe(surface)
    let origin = 0
    let withAudio = false
    let lastSecond = -1
    const draw = () => {
      if (!live) return
      const now = withAudio ? player.currentTime * 1000 : start + performance.now() - origin
      if (!withAudio && now >= chart.duration) { onClose(); return }
      if (elapsed.current && lastSecond !== Math.floor(now / 1000)) {
        elapsed.current.textContent = clockTime(now)
        lastSecond = Math.floor(now / 1000)
      }
      if (playhead.current) playhead.current.style.left = Math.min(100, now / chart.duration * 100) + '%'
      if (ctx) {
        const beat = beatAtTime(chart, now)
        const horizon = timeAtBeat(chart, beat + 3, 0, Infinity)
        while (next < notes.length && notes[next].time <= horizon) visible.add(notes[next++])
        const line = width * .84
        const lane = width / 4
        const y = (noteBeat: number) => line - Math.max(0, noteBeat - beat) * line / 3
        ctx.clearRect(0, 0, width, width)
        ctx.fillStyle = white
        ctx.globalAlpha = .14
        for (let i = 1; i < 4; i++) ctx.fillRect(i * lane, 0, 1, width)
        ctx.globalAlpha = 1
        ctx.fillStyle = ctx.shadowColor = accent
        ctx.shadowBlur = 14
        ctx.fillRect(0, line, width, 2)
        for (const note of visible) {
          const head = beatAtTime(chart, note.time)
          const tail = note.endTime === undefined ? head : beatAtTime(chart, note.endTime)
          if (beat - tail >= .55) { visible.delete(note); continue }
          const x = note.lane * lane
          const ink = note.red ? red : white
          if (tail > head && beat < tail) {
            ctx.fillStyle = ink
            ctx.globalAlpha = .45
            ctx.fillRect(x + lane * .28, y(tail), lane * .44, y(head) - y(tail))
            ctx.globalAlpha = 1
          }
          if (beat < head || beat < tail) {
            ctx.fillStyle = ink
            ctx.fillRect(x + 5, y(head) - 4, lane - 10, 7)
          }
          if (beat >= head) {
            const fade = Math.max(0, beat - tail) / .55
            ctx.shadowBlur = 0
            ctx.fillStyle = accent
            ctx.globalAlpha = (1 - fade) * .25
            ctx.fillRect(x, 0, lane, width)
            const hitAge = beat >= tail ? beat - tail : beat - head
            if (hitAge < .55) {
              const progress = hitAge / .55
              const size = 8 + progress * 28
              ctx.save()
              ctx.translate(x + lane / 2, line)
              ctx.rotate(Math.PI / 4)
              ctx.strokeStyle = ink
              ctx.shadowBlur = 14
              ctx.lineWidth = 2
              ctx.globalAlpha = 1 - progress
              ctx.strokeRect(-size / 2, -size / 2, size, size)
              ctx.restore()
            }
            ctx.globalAlpha = 1
            ctx.shadowBlur = 14
          }
        }
        ctx.shadowBlur = 0
      }
      frame = requestAnimationFrame(draw)
    }
    player.addEventListener('ended', onClose)
    player.addEventListener('error', fail)
    void (async () => {
      const source = await inspectAudio(id)
      if (!live) return
      if (source) {
        player.src = typeof source === 'string' ? source : (ownedUrl = URL.createObjectURL(source))
        player.currentTime = start / 1000
        withAudio = true
        await player.play()
        if (!live) return
        if (player.duration * 1000 <= start) { fail(); return }
      } else showToast(silent)
      origin = performance.now()
      draw()
    })().catch(fail)
    return () => {
      live = false
      cancelAnimationFrame(frame)
      observer.disconnect()
      player.removeEventListener('ended', onClose)
      player.removeEventListener('error', fail)
      player.pause()
      player.removeAttribute('src')
      player.load()
      if (ownedUrl) URL.revokeObjectURL(ownedUrl)
    }
  }, [id, chart, fraction, playhead, elapsed, onClose, inspectAudio, showToast, failure, silent])
  return <><canvas ref={canvas} className="library-preview" width={320} height={320} aria-hidden/><audio ref={audio} muted={muted}/></>
}
