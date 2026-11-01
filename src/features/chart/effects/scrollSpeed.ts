export interface ScrollSpeedEffect {
  id: string
  type: 'scrollSpeed'
  time: number
  multiplier: number
  transition: 'instant' | 'linear'
  endTime?: number
}

export type ChartEffect = ScrollSpeedEffect

/** Shared by import, editor validation, and the runtime. Earlier valid events win. */
export function normalizeEffects(input: unknown): ChartEffect[] {
  if (!Array.isArray(input)) return []
  const candidates: ChartEffect[] = []
  for (const value of input) {
    if (!value || typeof value !== 'object') continue
    const e = value as Partial<ScrollSpeedEffect>
    if (e.type !== 'scrollSpeed' || typeof e.id !== 'string' || !e.id
      || !Number.isFinite(e.time) || e.time! < 0
      || !Number.isFinite(e.multiplier) || e.multiplier! < 0 || e.multiplier! > 10
      || (e.transition !== 'instant' && e.transition !== 'linear')
      || (e.transition === 'linear' && (!Number.isFinite(e.endTime) || e.endTime! <= e.time!))) continue
    candidates.push({ id: e.id, type: e.type, time: e.time!, multiplier: e.multiplier!, transition: e.transition,
      ...(e.transition === 'linear' ? { endTime: e.endTime! } : {}) })
  }
  candidates.sort((a, b) => a.time - b.time)
  const result: ChartEffect[] = []
  const ids = new Set<string>()
  for (const event of candidates) {
    const previous = result.at(-1)
    if (ids.has(event.id) || (previous && (event.time === previous.time || event.time < (previous.endTime ?? previous.time)))) continue
    result.push(event); ids.add(event.id)
  }
  return result
}

export interface SpeedSegment {
  time: number
  endTime: number
  position: number
  speed: number
  slope: number
}

const caches = new WeakMap<ChartEffect[], ScrollSpeedMap>()

/** Nonnegative speed makes distance monotonic, but stops make its inverse non-unique. */
export class ScrollSpeedMap {
  readonly segments: SpeedSegment[] = []
  constructor(effects: ChartEffect[]) {
    let time = 0, position = 0, speed = 1
    const append = (endTime: number, slope = 0) => {
      this.segments.push({ time, endTime, position, speed, slope })
      const length = endTime - time
      position += length * speed + slope * length * length / 2
      speed += slope * length
      time = endTime
    }
    for (const event of normalizeEffects(effects)) {
      if (event.time > time) append(event.time)
      if (event.transition === 'linear') append(event.endTime!, (event.multiplier - speed) / (event.endTime! - event.time))
      speed = event.multiplier
    }
    this.segments.push({ time, endTime: Infinity, position, speed, slope: 0 })
  }
  private segment(time: number) {
    let lo = 0, hi = this.segments.length
    while (lo < hi) {
      const mid = (lo + hi) >>> 1
      if (this.segments[mid].time <= time) lo = mid + 1
      else hi = mid
    }
    return this.segments[Math.max(0, lo - 1)]
  }
  positionAt(time: number) {
    if (time < 0) return time
    const segment = this.segment(time), delta = time - segment.time
    return segment.position + delta * segment.speed + segment.slope * delta * delta / 2
  }
  speedAt(time: number) {
    if (time < 0) return 1
    const segment = this.segment(time)
    return Math.max(0, segment.speed + segment.slope * (time - segment.time))
  }
  /** Start a ramp with the preceding event's target, including at a shared boundary. */
  speedBefore(time: number) {
    if (time <= 0) return 1
    let lo = 0, hi = this.segments.length
    while (lo < hi) {
      const mid = (lo + hi) >>> 1
      if (this.segments[mid].time < time) lo = mid + 1
      else hi = mid
    }
    const segment = this.segments[Math.max(0, lo - 1)]
    return Math.max(0, segment.speed + segment.slope * (time - segment.time))
  }
}

export function scrollSpeedMap(effects: ChartEffect[]) {
  let map = caches.get(effects)
  if (!map) { map = new ScrollSpeedMap(effects); caches.set(effects, map) }
  return map
}
