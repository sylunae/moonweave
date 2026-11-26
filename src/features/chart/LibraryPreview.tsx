import { useEffect, useRef, type RefObject } from 'react'
import { useI18n } from '@/app/i18n'
import { useChart } from './ChartProvider'
import { beatAtTime, timeAtBeat } from './tempoMap'
import { clockTime } from './LibraryCards'
import type { Chart } from './types'

const GLOW = 14
const GLOW_PADDING = GLOW * 2
const HIT_SIZES = 15

function paintSprite(width: number, height: number, scale: number, paint: (ctx: CanvasRenderingContext2D) => void) {
  const image = document.createElement('canvas')
  image.width = Math.ceil(width * scale)
  image.height = Math.ceil(height * scale)
  const ctx = image.getContext('2d')!
  ctx.scale(image.width / width, image.height / height)
  paint(ctx)
  return image
}

function createPreviewSprites(width: number, scale: number, accent: string, white: string, red: string) {
  const lane = width / 4
  const lineHeight = 2 + 2 * GLOW_PADDING
  const headWidth = Math.max(0, lane - 10) + 2 * GLOW_PADDING
  const headHeight = 7 + 2 * GLOW_PADDING
  const line = paintSprite(width, lineHeight, scale, ctx => {
    ctx.fillStyle = ctx.shadowColor = accent
    ctx.shadowBlur = GLOW
    ctx.fillRect(0, GLOW_PADDING, width, 2)
  })
  const heads = [white, red].map(ink => paintSprite(headWidth, headHeight, scale, ctx => {
    ctx.fillStyle = ink
    ctx.shadowColor = accent
    ctx.shadowBlur = GLOW
    ctx.fillRect(GLOW_PADDING, GLOW_PADDING, Math.max(0, lane - 10), 7)
  }))
  const hitSize = Math.ceil(38 * Math.SQRT2) + 2 * GLOW_PADDING
  const hits = [white, red].map(ink => Array.from({ length: HIT_SIZES }, (_, i) =>
    paintSprite(hitSize, hitSize, scale, ctx => {
      const size = 8 + i * 2
      ctx.translate(hitSize / 2, hitSize / 2)
      ctx.rotate(Math.PI / 4)
      ctx.strokeStyle = ink
      ctx.shadowColor = accent
      ctx.shadowBlur = GLOW
      ctx.lineWidth = 2
      ctx.strokeRect(-size / 2, -size / 2, size, size)
    }),
  ))
  return { line, lineHeight, heads, headWidth, headHeight, hits, hitSize }
}

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
    const notes = chart.notes.filter(note => (note.endTime ?? note.time) >= start).map(note => {
      const head = beatAtTime(chart, note.time)
      return { head, tail: note.endTime === undefined ? head : beatAtTime(chart, note.endTime), lane: note.lane, red: note.red }
    }).sort((a, b) => a.head - b.head)
    const visible = new Set<(typeof notes)[number]>()
    let next = 0
    const style = getComputedStyle(surface)
    const accent = style.color
    const white = style.getPropertyValue('--preview-note').trim()
    const red = style.getPropertyValue('--red-zone').trim()
    let width = 0
    let graphWidth = 0
    let sprites: ReturnType<typeof createPreviewSprites> | undefined
    const graph = playhead.current?.parentElement
    const resize = () => {
      graphWidth = graph?.clientWidth ?? 0
      const nextWidth = Math.max(1, surface.clientWidth)
      const pixels = Math.round(nextWidth * Math.min(window.devicePixelRatio || 1, 2))
      if (nextWidth === width && surface.width === pixels) return
      width = nextWidth
      surface.width = surface.height = pixels
      if (ctx) {
        const scale = pixels / width
        ctx.setTransform(scale, 0, 0, scale, 0, 0)
        sprites = createPreviewSprites(width, scale, accent, white, red)
      }
    }
    resize()
    const observer = new ResizeObserver(resize)
    observer.observe(surface)
    if (graph) observer.observe(graph)
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
      if (playhead.current) playhead.current.style.transform = `translateX(${Math.min(1, now / chart.duration) * graphWidth}px)`
      if (ctx && sprites) {
        const beat = beatAtTime(chart, now)
        while (next < notes.length && notes[next].head <= beat + 3) {
          const note = notes[next++]
          if (beat - note.tail < .55) visible.add(note)
        }
        const line = width * .84
        const lane = width / 4
        const y = (noteBeat: number) => line - Math.max(0, noteBeat - beat) * line / 3
        ctx.clearRect(0, 0, width, width)
        ctx.fillStyle = white
        ctx.globalAlpha = .14
        for (let i = 1; i < 4; i++) ctx.fillRect(i * lane, 0, 1, width)
        ctx.globalAlpha = 1
        ctx.drawImage(sprites.line, 0, line - GLOW_PADDING, width, sprites.lineHeight)
        for (const note of visible) {
          const { head, tail } = note
          if (beat - tail >= .55) { visible.delete(note); continue }
          const x = note.lane * lane
          const ink = note.red ? 1 : 0
          if (tail > head && beat < tail) {
            ctx.fillStyle = note.red ? red : white
            ctx.globalAlpha = .45
            ctx.fillRect(x + lane * .28, y(tail), lane * .44, y(head) - y(tail))
            ctx.globalAlpha = 1
          }
          if (beat < head || beat < tail) {
            ctx.drawImage(sprites.heads[ink], x + 5 - GLOW_PADDING, y(head) - 4 - GLOW_PADDING, sprites.headWidth, sprites.headHeight)
          }
          if (beat >= head) {
            const fade = Math.max(0, beat - tail) / .55
            ctx.fillStyle = accent
            ctx.globalAlpha = (1 - fade) * .25
            ctx.fillRect(x, 0, lane, width)
            const hitAge = beat >= tail ? beat - tail : beat - head
            if (hitAge < .55) {
              const progress = hitAge / .55
              const ring = sprites.hits[ink][Math.round(progress * (HIT_SIZES - 1))]
              const size = sprites.hitSize
              ctx.globalAlpha = 1 - progress
              ctx.drawImage(ring, x + (lane - size) / 2, line - size / 2, size, size)
            }
            ctx.globalAlpha = 1
          }
        }
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
