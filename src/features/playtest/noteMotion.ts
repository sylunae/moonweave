import { motionValue, type NoteAnimation } from '../chart/effects/noteAnimation'
import type { ScrollSpeedMap } from '../chart/effects/scrollSpeed'
import { beatAtTime, timeAtBeat, type TempoSource } from '../chart/tempoMap'
import { createEditorNoteIndex, visibleEditorNotes } from '../chart/editorTimeline'
import type { ChartNote } from '../chart/types'
import type { VisualNote } from './speedGeometry'

/** Integrate signed note speed × global speed. Cache the prefix at each discontinuity. */
export function compileMotion(animation: NoteAnimation, global: ScrollSpeedMap, tempo: TempoSource) {
  const keys = animation.keys.speed ?? []
  const toTime = (beat: number) => timeAtBeat(tempo, beat, -Infinity, Infinity)
  const boundaries = new Set<number>([0])
  const turns = keys.map(key => toTime(key.at))
  for (let i = 1; i < keys.length; i++) {
    const left = keys[i - 1], right = keys[i]
    if (left.curve === 'step' || left.value * right.value >= 0) continue
    let lo = left.at, hi = right.at
    for (let n = 0; n < 48; n++) {
      const mid = (lo + hi) / 2
      if (motionValue(keys, mid, animation.speed) * left.value > 0) lo = mid
      else hi = mid
    }
    turns.push(toTime((lo + hi) / 2))
  }
  turns.sort((a, b) => a - b)
  if (keys.length) {
    for (const turn of turns) boundaries.add(turn)
    for (const segment of global.segments) boundaries.add(segment.time)
    for (const change of tempo.bpmChanges) boundaries.add(change.time)
  }
  const times = [...boundaries].sort((a, b) => a - b)
  const positions = [0]
  const speed = (t: number) => global.speedAt(t) * motionValue(keys, beatAtTime(tempo, t), animation.speed)
  // Three interior Gauss points exactly integrate the quartic product on each interval,
  // including smoothstep and BPM changes, without sampling across a step boundary.
  const integral = (a: number, b: number) => {
    const half = (b - a) / 2, mid = a + half, delta = half * Math.sqrt(3 / 5)
    return half * (5 * speed(mid - delta) + 8 * speed(mid) + 5 * speed(mid + delta)) / 9
  }
  for (let i = 1; i < times.length; i++) positions.push(positions[i - 1] + integral(times[i - 1], times[i]))
  const positionAt = (time: number) => {
    if (!keys.length) return global.positionAt(time) * animation.speed
    const i = Math.max(0, upperBound(times, time) - 1)
    return positions[i] + integral(times[i], time)
  }
  const bounds = (start: number, end: number) => {
    const head = positionAt(start), tail = positionAt(end)
    let low = Math.min(head, tail), high = Math.max(head, tail)
    for (let i = upperBound(turns, start); i < turns.length && turns[i] < end; i++) {
      const p = positionAt(turns[i])
      low = Math.min(low, p); high = Math.max(high, p)
    }
    return { head, low, high }
  }
  return { positionAt, bounds }
}

function upperBound(values: number[], at: number) {
  let low = 0, high = values.length
  while (low < high) {
    const mid = (low + high) >>> 1
    if (values[mid] <= at) low = mid + 1
    else high = mid
  }
  return low
}

export class MotionGeometry {
  readonly motion: ReturnType<typeof compileMotion>
  private readonly index: ReturnType<typeof createEditorNoteIndex>
  private readonly opacityBeforeFirstKey: number
  private readonly scratch: VisualNote[] = []
  constructor(readonly animation: NoteAnimation, notes: ChartNote[], global: ScrollSpeedMap, tempo: TempoSource) {
    this.motion = compileMotion(animation, global, tempo)
    const firstOpacity = animation.keys.opacity?.[0]
    // Carry an initial hide key back through the countdown before the song.
    this.opacityBeforeFirstKey = firstOpacity?.value === 0 && firstOpacity.at <= beatAtTime(tempo, 0) ? 0 : 100
    this.index = createEditorNoteIndex(notes.map((note): VisualNote => {
      const end = note.endTime ?? note.time
      const { head, low, high } = this.motion.bounds(note.time, end)
      return { ...note, sourceId: note.id, sourceTime: note.time, sourceEndTime: end,
        time: low, endTime: high, head }
    }))
  }
  append(output: VisualNote[], time: number, beat: number, horizon: number, globalPosition: number, from: number, to: number) {
    const opacity = motionValue(this.animation.keys.opacity, beat, this.opacityBeforeFirstKey) / 100
    if (opacity <= 0) return
    const offset = motionValue(this.animation.keys.offset, beat, 0) * horizon / 100
    const shift = globalPosition - this.motion.positionAt(time) + offset
    visibleEditorNotes(this.index, from - shift, to - shift, this.scratch)
    for (const note of this.scratch) {
      note.shift = shift
      note.opacity = opacity
      output.push(note)
    }
  }
}
