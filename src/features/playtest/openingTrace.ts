const TRACE_DURATION_MS = 15_000
const MAX_FRAMES = 2_500
const MAX_EVENTS = 150
const round = (value: number) => Math.round(value * 10) / 10

export class PlaytestOpeningTrace {
  private startedAt: number | null = null
  private frames: number[][] = []
  private events: { atMs: number; event: string; detail?: unknown }[] = []

  constructor(private readonly readAudio: () => Pick<HTMLMediaElement, 'currentTime'> | null) {}

  start(detail: { startMs: number; firstNoteMs: number | null; background: string | null; trackDimming: boolean }) {
    this.frames = []
    this.events = []
    this.startedAt = performance.now()
    this.mark('start', {
      ...detail, dpr: window.devicePixelRatio, width: window.innerWidth, height: window.innerHeight,
      fullscreen: Boolean(document.fullscreenElement),
    })
  }

  mark(event: string, detail?: unknown) {
    if (this.startedAt === null || this.events.length >= MAX_EVENTS) return
    const elapsed = performance.now() - this.startedAt
    if (elapsed <= TRACE_DURATION_MS) this.events.push({ atMs: round(elapsed), event, detail })
  }

  frame(timestamp: number, workStartedAt: number, chartTime: number, noteCount: number, scale: number) {
    if (this.startedAt === null || this.frames.length >= MAX_FRAMES) return
    const elapsed = timestamp - this.startedAt
    if (elapsed > TRACE_DURATION_MS) return
    this.frames.push([
      round(elapsed), round(performance.now() - workStartedAt), round(chartTime),
      round((this.readAudio()?.currentTime ?? 0) * 1000), noteCount, round(scale * 100),
    ])
  }

  download() {
    const body = JSON.stringify({
      version: 1,
      columns: ['atMs', 'renderCpuMs', 'chartMs', 'audioMs', 'noteInstances', 'scalePercent'],
      events: this.events,
      frames: this.frames,
    })
    const url = URL.createObjectURL(new Blob([body], { type: 'application/json' }))
    const link = document.createElement('a')
    link.href = url
    link.download = 'moonweave-opening-trace.json'
    link.click()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
}
