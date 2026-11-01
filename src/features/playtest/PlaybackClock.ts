const HARD_RESYNC_MS = 96
const CORRECTION_RATIO = 0.12
const MAX_CORRECTION_MS = 1
const SAMPLE_EPSILON_MS = 0.01
const MAX_EXTRAPOLATION_MS = 50

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))

/**
 * Produces a continuous render timeline while keeping it aligned to the media
 * element's authoritative clock. HTMLMediaElement.currentTime can advance in
 * coarse steps on Chromium, which otherwise makes high-refresh-rate animation
 * repeat positions and then jump forward.
 */
export class PlaybackClock {
  private anchorMediaMs = 0
  private anchorPerformanceMs = 0
  private lastMediaSampleMs = 0
  private lastOutputMs = 0
  private playbackRate = 1
  private running = false

  reset(mediaMs: number, performanceMs = performance.now()) {
    this.anchorMediaMs = mediaMs
    this.anchorPerformanceMs = performanceMs
    this.lastMediaSampleMs = mediaMs
    this.lastOutputMs = mediaMs
    this.running = false
  }

  start(mediaMs: number, performanceMs = performance.now(), playbackRate = 1) {
    this.reset(mediaMs, performanceMs)
    this.playbackRate = playbackRate
    this.running = true
  }

  stop(mediaMs: number, performanceMs = performance.now()) {
    this.reset(mediaMs, performanceMs)
  }

  setRate(mediaMs: number, performanceMs: number, playbackRate: number) {
    if (playbackRate === this.playbackRate) return
    // Preserve the interpolated position when the media sample is coarse.
    const position = this.getTime(mediaMs, performanceMs)
    this.anchorMediaMs = position
    this.anchorPerformanceMs = performanceMs
    this.playbackRate = playbackRate
  }

  getTime(mediaMs: number, performanceMs = performance.now()) {
    if (!this.running || !Number.isFinite(mediaMs)) {
      this.lastOutputMs = mediaMs
      return mediaMs
    }

    let predicted = this.anchorMediaMs + (performanceMs - this.anchorPerformanceMs) * this.playbackRate
    if (Math.abs(mediaMs - this.lastMediaSampleMs) > SAMPLE_EPSILON_MS) {
      const drift = mediaMs - predicted
      if (Math.abs(drift) >= HARD_RESYNC_MS) {
        this.anchorMediaMs = mediaMs
        this.anchorPerformanceMs = performanceMs
        predicted = mediaMs
        // A real seek may go backwards. Do not keep the old monotonic floor.
        this.lastOutputMs = mediaMs
      } else {
        this.anchorMediaMs += clamp(drift * CORRECTION_RATIO, -MAX_CORRECTION_MS, MAX_CORRECTION_MS)
        predicted = this.anchorMediaMs + (performanceMs - this.anchorPerformanceMs) * this.playbackRate
      }
      this.lastMediaSampleMs = mediaMs
    }

    // Small clock corrections must never make falling notes move backwards.
    predicted = Math.min(Math.max(this.lastOutputMs, predicted), mediaMs + MAX_EXTRAPOLATION_MS)
    this.lastOutputMs = predicted
    return predicted
  }
}
