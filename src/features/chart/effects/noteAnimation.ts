export const motionChannels = ['speed', 'offset', 'opacity', 'hitOffset', 'hitOpacity'] as const
export type MotionChannel = typeof motionChannels[number]
export type Interpolation = 'step' | 'linear' | 'smooth'
export interface MotionKey {
  /** Zero-based chart beat, or milliseconds since a successful hit for hit channels. */
  at: number
  value: number
  curve: Interpolation
}
export interface NoteAnimation {
  speed: number
  keys: Partial<Record<MotionChannel, MotionKey[]>>
}
export const defaultNoteAnimation: NoteAnimation = { speed: 1, keys: {} }
export const isHitChannel = (channel: MotionChannel) => channel === 'hitOffset' || channel === 'hitOpacity'
export const motionPresets = ['slow', 'brake', 'stop', 'reverse', 'reveal', 'glitch', 'rebound'] as const
export type MotionPreset = typeof motionPresets[number]

/** Presets expand into ordinary editable channels. Chart cues precede the first selected head. */
export function motionPreset(preset: MotionPreset, beat: number): NoteAnimation {
  const key = (at: number, value: number, curve: Interpolation = 'step'): MotionKey => ({ at, value, curve })
  switch (preset) {
    case 'slow': return { speed: 0.4, keys: {} }
    case 'brake': return { speed: 1.5, keys: { speed: [key(beat - 3, 1.5, 'smooth'), key(beat - 1, 0.35)] } }
    case 'stop':
    case 'reverse': return { speed: 1, keys: { speed: [key(beat - 2, preset === 'stop' ? 0 : -0.5), key(beat - 1, 1)] } }
    case 'reveal': return { speed: 1, keys: { opacity: [key(beat - 8, 0), key(beat - 0.5, 100)] } }
    case 'glitch': return { speed: 1, keys: { offset: [3, -3, 3, -3, 0].map((v, i) => key(beat - 0.75 + i / 8, v)) } }
    case 'rebound': return { speed: 1, keys: { hitOffset: [key(0, 0, 'smooth'), key(240, 15)], hitOpacity: [key(0, 100, 'linear'), key(240, 0)] } }
  }
}
export const motionLimits: Record<MotionChannel, readonly [number, number]> = {
  speed: [-10, 10], offset: [-200, 200], opacity: [0, 100], hitOffset: [-200, 200], hitOpacity: [0, 100],
}
export function validMotionValue(channel: MotionChannel, value: number) {
  const [min, max] = motionLimits[channel]
  return Number.isFinite(value) && value >= min && value <= max
}
export function normalizeNoteAnimation(input: unknown): NoteAnimation | undefined {
  if (!input || typeof input !== 'object') return
  const animation = input as Partial<NoteAnimation>
  if (typeof animation.speed !== 'number' || !validMotionValue('speed', animation.speed)) return
  const keys: NoteAnimation['keys'] = {}
  for (const channel of motionChannels) {
    const frames = animation.keys?.[channel]
    if (!Array.isArray(frames)) continue
    const byTime = new Map<number, MotionKey>()
    for (const frame of frames) {
      if (!frame || !Number.isFinite(frame.at) || (isHitChannel(channel) && frame.at < 0)
        || !validMotionValue(channel, frame.value) || !['step', 'linear', 'smooth'].includes(frame.curve)) continue
      byTime.set(frame.at, { at: frame.at, value: frame.value, curve: frame.curve })
    }
    if (byTime.size) keys[channel] = [...byTime.values()].sort((a, b) => a.at - b.at)
  }
  return { speed: animation.speed, keys }
}

/** A key's curve controls the interval leading to the following key. */
export function motionValue(keys: MotionKey[] | undefined, at: number, fallback: number) {
  if (!keys?.length || at < keys[0].at) return fallback
  let lo = 0, hi = keys.length
  while (lo < hi) {
    const mid = (lo + hi) >>> 1
    if (keys[mid].at <= at) lo = mid + 1
    else hi = mid
  }
  const left = keys[lo - 1], right = keys[lo]
  if (!right || left.curve === 'step') return left.value
  const t = (at - left.at) / (right.at - left.at)
  return left.value + (right.value - left.value) * (left.curve === 'smooth' ? t * t * (3 - 2 * t) : t)
}
