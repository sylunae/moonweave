import { beatAtTime, timeAtBeat, type TempoSource } from './tempoMap'
import type { ChartNote } from './types'

const EPSILON = 1e-9
const MAX_SHIFT_BEATS = 1 / 8
const CHORD_WINDOW_MS = 25
const CHORD_WINDOW_BEATS = 0.04
const INTERVAL_WEIGHT = 0.35
const RAW_COST = 4

interface Onset {
  notes: ChartNote[]
  firstBeat: number
  firstTime: number
  beat: number
}

interface Candidate {
  beat: number
  firstBeat: number
  lastBeat: number
  time: number
  raw: boolean
  cost: number
  total: number
  previous: number
}

function groupOnsets(source: TempoSource, notes: ChartNote[]) {
  const groups: Onset[] = []
  for (const note of notes) {
    const beat = beatAtTime(source, note.time)
    const last = groups.at(-1)
    // Anchor to the first tap, rather than chaining nearby taps into a long chord.
    if (last && note.time - last.firstTime <= CHORD_WINDOW_MS && beat - last.firstBeat <= CHORD_WINDOW_BEATS
      && !last.notes.some((item) => item.lane === note.lane)) {
      last.beat = (last.beat * last.notes.length + beat) / (last.notes.length + 1)
      last.notes.push(note)
    } else groups.push({ notes: [note], firstBeat: beat, firstTime: note.time, beat })
  }
  return groups
}

function candidatesFor(source: TempoSource, groups: Onset[], index: number): Candidate[] {
  const beat = groups[index].beat
  const gap = Math.min(index ? beat - groups[index - 1].beat : Infinity,
    index + 1 < groups.length ? groups[index + 1].beat - beat : Infinity)
  // Nested grids: quarter-beat anchors remain valid inside eighth/sixteenth passages.
  const preferred = gap < 0.09 ? 16 : gap < 0.18 ? 8 : 4
  const finePenalty = preferred === 16 ? 0.02 : preferred === 8 ? 0.04 : 0.1
  const candidates: Candidate[] = []
  const first = Math.ceil((beat - MAX_SHIFT_BEATS - EPSILON) * 16)
  const last = Math.floor((beat + MAX_SHIFT_BEATS + EPSILON) * 16)
  for (let tick = first; tick <= last; tick++) {
    const target = tick / 16
    // Do not clamp an out-of-range beat onto the audio boundary: that is not a grid line.
    const time = timeAtBeat(source, target, -Infinity, Infinity)
    if (time < 0 || time > source.duration) continue
    const level = tick % 4 === 0 ? 0 : tick % 2 === 0 ? 1 : 2
    candidates.push({ beat: target, firstBeat: target, lastBeat: target, time, raw: false,
      cost: ((target - beat) * 4) ** 2 + level * finePenalty, total: Infinity, previous: -1 })
  }
  // An escape path protects taps faster than the supported grid instead of deleting them.
  const group = groups[index]
  const lastBeat = beatAtTime(source, group.notes[group.notes.length - 1].time)
  candidates.push({ beat, firstBeat: group.firstBeat, lastBeat, time: timeAtBeat(source, beat), raw: true,
    cost: RAW_COST, total: Infinity, previous: -1 })
  return candidates
}

/** Save-time correction only. Uses beat fractions (1/4, 1/8, 1/16), not note-value names. */
export function correctImprovisedNotes(source: TempoSource, recorded: ChartNote[]): ChartNote[] {
  // Audio playback and stored notes share absolute milliseconds. Offset belongs only
  // in beatAtTime/timeAtBeat; subtracting it here would move the take a second time.
  const taps = recorded.filter((note) => note.kind === 'note').sort((a, b) => a.time - b.time)
  if (!taps.length) return [...recorded]
  const groups = groupOnsets(source, taps)
  const layers: Candidate[][] = []
  groups.forEach((group, index) => {
    const candidates = candidatesFor(source, groups, index)
    for (const candidate of candidates) {
      if (!index) { candidate.total = candidate.cost; continue }
      const previousGroup = groups[index - 1]
      layers[index - 1].forEach((previous, previousIndex) => {
        const duplicateRaw = candidate.raw && previous.raw && candidate.firstBeat === previous.lastBeat
        if (candidate.firstBeat <= previous.lastBeat + EPSILON && !duplicateRaw) return
        const intervalError = (candidate.beat - previous.beat - (group.beat - previousGroup.beat)) * 4
        const total = previous.total + candidate.cost + INTERVAL_WEIGHT * intervalError ** 2
        if (total < candidate.total) { candidate.total = total; candidate.previous = previousIndex }
      })
    }
    layers.push(candidates)
  })

  const last = layers[layers.length - 1]
  let selected = last.reduce((best, candidate, index) => candidate.total < last[best].total ? index : best, 0)
  const corrected: ChartNote[] = recorded.filter((note) => note.kind !== 'note')
  for (let index = groups.length - 1; index >= 0; index--) {
    const candidate = layers[index][selected]
    for (const note of groups[index].notes) {
      // If no grid path fits, preserve each tap's own time, including chord timing.
      corrected.push({ ...note, time: candidate.raw ? note.time : candidate.time })
    }
    selected = candidate.previous
  }
  return corrected.sort((a, b) => a.time - b.time)
}
