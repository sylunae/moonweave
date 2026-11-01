import type { BpmChange, Chart } from './types'

export interface TempoSource {
  bpm: number
  offset: number
  duration: number
  bpmChanges: BpmChange[]
}

export interface BeatLine {
  time: number
  beat: number
  index: number
  major: boolean
}

const EPSILON = 0.000_001
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))

interface TempoIndex {
  times: number[]
  bpms: number[]
  beatsAtChange: number[]
  offsetBeat: number
}

const indexCache = new WeakMap<object, TempoIndex>()

const upperBound = (values: number[], target: number) => {
  let low = 0
  let high = values.length
  while (low < high) {
    const middle = (low + high) >>> 1
    if (values[middle] <= target + EPSILON) low = middle + 1
    else high = middle
  }
  return low
}

const absoluteBeatAtTime = (source: TempoSource, index: TempoIndex, time: number) => {
  const segment = upperBound(index.times, time) - 1
  if (segment < 0) return time * source.bpm / 60_000
  return index.beatsAtChange[segment] + (time - index.times[segment]) * index.bpms[segment] / 60_000
}

function tempoIndex(source: TempoSource) {
  const cached = indexCache.get(source)
  if (cached) return cached
  const times: number[] = []
  const bpms: number[] = []
  const beatsAtChange: number[] = []
  let previousTime = 0
  let previousBpm = source.bpm
  let beats = 0
  for (const change of source.bpmChanges) {
    beats += (change.time - previousTime) * previousBpm / 60_000
    times.push(change.time)
    bpms.push(change.bpm)
    beatsAtChange.push(beats)
    previousTime = change.time
    previousBpm = change.bpm
  }
  const index: TempoIndex = { times, bpms, beatsAtChange, offsetBeat: 0 }
  index.offsetBeat = absoluteBeatAtTime(source, index, source.offset)
  indexCache.set(source, index)
  return index
}

export function bpmAtTime(source: TempoSource, time: number) {
  const index = tempoIndex(source)
  const segment = upperBound(index.times, time) - 1
  return segment < 0 ? source.bpm : index.bpms[segment]
}

export function beatAtTime(source: TempoSource, time: number) {
  const index = tempoIndex(source)
  return absoluteBeatAtTime(source, index, time) - index.offsetBeat
}

export function timeAtBeat(source: TempoSource, beat: number, min = 0, max = source.duration) {
  const index = tempoIndex(source)
  const target = beat + index.offsetBeat
  const segment = upperBound(index.beatsAtChange, target) - 1
  const time = segment < 0
    ? target * 60_000 / source.bpm
    : index.times[segment] + (target - index.beatsAtChange[segment]) * 60_000 / index.bpms[segment]
  return clamp(time, min, max)
}

/** Stable editor distance: one virtual millisecond per audio millisecond. */
export function scrollPositionAtTime(source: TempoSource, time: number) {
  return time - source.offset
}

export function timeAtScrollPosition(source: TempoSource, position: number, min = 0, max = source.duration) {
  return clamp(position + source.offset, min, max)
}

export function snapToBeatLine(source: TempoSource, time: number, subdivision: number) {
  const targetBeat = Math.round(beatAtTime(source, time) * subdivision) / subdivision
  return clamp(timeAtBeat(source, targetBeat), 0, source.duration)
}

export function adjacentBeatLine(source: TempoSource, time: number, subdivision: number, direction: -1 | 1) {
  const position = beatAtTime(source, time) * subdivision
  const index = direction > 0 ? Math.floor(position + EPSILON) + 1 : Math.ceil(position - EPSILON) - 1
  return clamp(timeAtBeat(source, index / subdivision), 0, source.duration)
}

export function beatLinesInRange(source: TempoSource, from: number, to: number, subdivision: number): BeatLine[] {
  const boundedFrom = clamp(from, 0, source.duration)
  const boundedTo = clamp(to, 0, source.duration)
  const first = Math.ceil(beatAtTime(source, boundedFrom) * subdivision - EPSILON)
  const last = Math.floor(beatAtTime(source, boundedTo) * subdivision + EPSILON)
  const result: BeatLine[] = []
  for (let index = first; index <= last; index += 1) {
    const time = timeAtBeat(source, index / subdivision, boundedFrom, boundedTo)
    result.push({ time, beat: index / subdivision, index, major: index % subdivision === 0 })
  }
  return result
}

export function holdTickTimes(source: TempoSource, start: number, end: number) {
  const startBeat = beatAtTime(source, start)
  const endBeat = beatAtTime(source, end)
  const result: number[] = []
  for (let beat = startBeat + 0.5; beat + 0.5 < endBeat - EPSILON; beat += 0.5) {
    result.push(timeAtBeat(source, beat, start, end))
  }
  return result
}

/** Changes the initial BPM while keeping every note and tempo event on its musical beat. */
export function retimeInitialBpm(chart: Chart, bpm: number): Chart {
  if (bpm === chart.bpm) return chart
  const eventBeats = chart.bpmChanges.map((change) => beatAtTime(chart, change.time))
  const bpmChanges: BpmChange[] = []
  let previousTime = chart.offset
  let previousBeat = 0
  let previousBpm = bpm
  chart.bpmChanges.forEach((change, index) => {
    const time = previousTime + (eventBeats[index] - previousBeat) * 60_000 / previousBpm
    bpmChanges.push({ time, bpm: change.bpm })
    previousTime = time
    previousBeat = eventBeats[index]
    previousBpm = change.bpm
  })
  const next = { ...chart, bpm, bpmChanges }
  const retime = (time: number) => timeAtBeat(next, beatAtTime(chart, time), Math.min(0, chart.offset), Math.max(chart.duration * 2, time * 2 + 1))
  return {
    ...next,
    effects: chart.effects.map((effect) => ({ ...effect, time: retime(effect.time), ...(effect.endTime === undefined ? {} : { endTime: retime(effect.endTime) }) })),
    notes: chart.notes.map((note) => ({ ...note, time: retime(note.time), endTime: note.endTime === undefined ? undefined : retime(note.endTime) })),
  }
}
