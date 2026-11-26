import { readEncodedAudio } from '../chart/detectBpm'

const MAX_DURATION_SECONDS = 180
const MAX_DECODED_BYTES = 72 * 1024 * 1024
const READY_WAIT_MS = 500
const MAX_OUTPUT_INTERPOLATION_SECONDS = 0.025

export const canBufferDuration = (duration: number) => Number.isFinite(duration) && duration > 0 && duration <= MAX_DURATION_SECONDS

// AudioBufferSourceNode gives mobile play an output clock independent of
// HTMLMediaElement.currentTime. Each start creates a fresh one-shot source.
export class BufferedPlaytestAudio extends EventTarget {
  private context?: AudioContext
  private preparation?: Promise<boolean>
  private preparationSignal?: AbortSignal
  private resuming?: Promise<void>
  private buffer?: AudioBuffer
  private source?: AudioBufferSourceNode
  private position = 0
  private startedAt = 0
  private lastPosition = 0
  private endTimer = 0
  private finished = false
  active = false
  readonly playbackRate = 1
  readonly seeking = false

  get paused() { return !this.source }
  get ended() { return this.finished }
  get readyState() { return this.context?.state === 'running' ? 4 : 0 }

  get currentTime() {
    const context = this.context
    if (!this.source || !context || context.state !== 'running') return this.lastPosition
    const stamp = context.getOutputTimestamp?.()
    if (stamp && !stamp.performanceTime && context.currentTime - this.startedAt < 0.1) return this.lastPosition
    const output = stamp?.contextTime !== undefined && stamp.performanceTime
      ? Math.min(context.currentTime, stamp.contextTime + Math.min(MAX_OUTPUT_INTERPOLATION_SECONDS, Math.max(0, (performance.now() - stamp.performanceTime) / 1000)))
      : context.currentTime - (context.baseLatency || 0) - (context.outputLatency || 0)
    const position = this.position + output - this.startedAt
    this.lastPosition = Math.min(this.buffer!.duration, Math.max(this.lastPosition, position))
    return this.lastPosition
  }

  set currentTime(position: number) {
    this.pause()
    this.position = this.lastPosition = Math.max(0, Math.min(this.buffer?.duration ?? Infinity, position))
    this.finished = false
  }

  prepare(url: string, duration: number, signal: AbortSignal): Promise<boolean> {
    if (signal.aborted || !canBufferDuration(duration)) return Promise.resolve(false)
    if (this.buffer) return Promise.resolve(true)
    if (this.preparation) {
      return this.preparationSignal?.aborted
        ? this.preparation.then(() => this.prepare(url, duration, signal))
        : this.preparation
    }
    this.preparationSignal = signal
    this.preparation = (async () => {
      const data = await readEncodedAudio(url, signal)
      signal.throwIfAborted()
      const buffer = await new OfflineAudioContext(2, 1, 48_000).decodeAudioData(data)
      signal.throwIfAborted()
      if (buffer.duration <= MAX_DURATION_SECONDS && buffer.length * buffer.numberOfChannels * 4 <= MAX_DECODED_BYTES) this.buffer = buffer
      return Boolean(this.buffer)
    })().catch(() => false).finally(() => {
      this.preparation = undefined
      this.preparationSignal = undefined
    })
    return this.preparation
  }

  unlock() {
    try {
      this.context ??= new AudioContext({ latencyHint: 'interactive' })
      if (this.context.state !== 'running') this.resuming = this.context.resume().catch(() => undefined)
    } catch { /* The media element remains available. */ }
  }

  async waitForOutput() {
    if (this.context?.state !== 'running' && this.resuming) {
      let timeout: number | undefined
      try {
        await Promise.race([
          this.resuming,
          new Promise<void>((resolve) => { timeout = window.setTimeout(resolve, READY_WAIT_MS) }),
        ])
      } finally {
        clearTimeout(timeout)
      }
    }
    return Boolean(this.buffer && this.context?.state === 'running')
  }

  playFrom(position: number) {
    const context = this.context
    const buffer = this.buffer
    if (!context || context.state !== 'running' || !buffer || position >= buffer.duration) return false
    this.currentTime = position
    const source = context.createBufferSource()
    source.buffer = buffer
    source.connect(context.destination)
    source.onended = () => {
      const finishAtOutput = () => {
        if (this.source !== source) return
        const remaining = buffer.duration - this.currentTime
        if (remaining > 0.001) {
          this.endTimer = window.setTimeout(finishAtOutput, Math.max(8, remaining * 1000))
          return
        }
        this.source = undefined
        this.position = this.lastPosition = buffer.duration
        this.finished = true
        source.disconnect()
        this.dispatchEvent(new Event('ended'))
      }
      finishAtOutput()
    }
    this.startedAt = context.currentTime
    try {
      source.start(this.startedAt, this.position)
    } catch {
      source.disconnect()
      return false
    }
    this.source = source
    this.active = true
    this.dispatchEvent(new Event('playing'))
    return true
  }

  pause() {
    const source = this.source
    if (!source) return
    this.position = this.currentTime
    this.source = undefined
    window.clearTimeout(this.endTimer)
    source.onended = null
    source.stop()
    source.disconnect()
    this.dispatchEvent(new Event('pause'))
  }

  dispose() {
    this.pause()
    this.active = false
    this.buffer = undefined
    if (this.context) void this.context.close().catch(() => undefined)
    this.context = undefined
    this.resuming = undefined
  }
}
