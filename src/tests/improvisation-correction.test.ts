import { describe, expect, it } from 'vitest'
import { correctImprovisedNotes } from '@/features/chart/improvisationCorrection'
import { beatAtTime, timeAtBeat } from '@/features/chart/tempoMap'
import { DEFAULT_CHART, type ChartNote } from '@/features/chart/types'

const chart = { ...DEFAULT_CHART, duration: 10000 }
const tap = (time: number, index = 0, lane = index % 4): ChartNote => ({ id: `tap-${index}`, kind: 'note', lane, time })

describe('adaptive improvisation correction', () => {
  it('does not move the take half a beat early when chart offset equals half a beat', () => {
    const source = { ...chart, bpm: 60000 / 360, offset: 180 }
    const input = [tap(904), tap(1264, 1), tap(1624, 2)]
    const result = correctImprovisedNotes(source, input)
    expect(result.map((note) => note.time)).toEqual([900, 1260, 1620])
    expect(result[0].time).not.toBe(720)
  })
  it.each([180, -140, 0, 315])('aligns playback timestamps to the current chart grid at offset %s without subtracting it again', (offset) => {
    const source = { ...chart, offset, bpmChanges: [{ time: 2000, bpm: 240 }] }
    const ideal = [2, 2.25, 2.5, 4.5, 4.75, 5].map((beat) => timeAtBeat(source, beat))
    const raw = ideal.map((time, index) => tap(time + (index % 2 ? -3 : 3), index))
    const original = structuredClone(raw)
    const prepared = correctImprovisedNotes(source, raw)
    prepared.forEach((note, index) => expect(note.time).toBeCloseTo(ideal[index], 6))
    expect(raw).toEqual(original)
    expect(source.offset).toBe(offset)
  })

  it.each([400, -400])('keeps aligned notes inside the audio at offset %s', (offset) => {
    const source = { ...chart, offset, duration: 2000 }
    const raw = [tap(20, 0, 0), tap(1980, 1, 1)]
    const prepared = correctImprovisedNotes(source, raw)
    expect(prepared).toHaveLength(2)
    expect(prepared.every((note) => Number.isFinite(note.time) && note.time >= 0 && note.time <= source.duration)).toBe(true)
  })

  it.each([
    { subdivision: 4, jitter: [-12, 16, -9, 8] },
    { subdivision: 8, jitter: [5, -4, 6, -3] },
    { subdivision: 16, jitter: [2, -2, 3, -1] },
  ])('recovers a noisy 1/$subdivision-beat pattern', ({ subdivision, jitter }) => {
    const ideal = Array.from({ length: 24 }, (_, index) => 500 + index * 500 / subdivision)
    const input = ideal.map((time, index) => tap(time + jitter[index % jitter.length], index))
    expect(correctImprovisedNotes(chart, input).map((note) => note.time)).toEqual(ideal)
  })

  it('keeps sparse jitter on quarter-beat lines instead of always choosing a finer grid', () => {
    const input = [1008, 1523, 1990, 2517].map((time, index) => tap(time, index))
    expect(correctImprovisedNotes(chart, input).map((note) => note.time)).toEqual([1000, 1500, 2000, 2500])
  })

  it('adapts within one take without making distant sparse passages use the dense grid', () => {
    const ideal = [500, 625, 750, ...Array.from({ length: 16 }, (_, index) => 2000 + index * 31.25), 5000, 5125, 5250]
    const input = ideal.map((time, index) => tap(time + (index % 2 ? -3 : 3), index))
    expect(correctImprovisedNotes(chart, input).map((note) => note.time)).toEqual(ideal)
  })

  it('aligns a jittered chord without interpreting its individual lanes as a dense run', () => {
    const input = [tap(1007, 0, 0), tap(1018, 1, 1), tap(1509, 2, 2), tap(1520, 3, 3)]
    expect(correctImprovisedNotes(chart, input).map((note) => note.time)).toEqual([1000, 1000, 1500, 1500])
  })

  it('preserves same-lane rapid taps and the raw input when the pattern exceeds the grid resolution', () => {
    const input = Array.from({ length: 30 }, (_, index) => tap(1000 + index, index, 0))
    const original = structuredClone(input)
    const result = correctImprovisedNotes(chart, input)
    expect(result).toHaveLength(input.length)
    expect(new Set(result.map((note) => note.id)).size).toBe(input.length)
    expect(result.every((note, index) => !index || note.time > result[index - 1].time)).toBe(true)
    expect(result.some((note) => note.time === input.find((item) => item.id === note.id)!.time)).toBe(true)
    expect(input).toEqual(original)
  })

  it('does not drop duplicate timestamps even when there are too many to fit distinct grid lines', () => {
    const input = Array.from({ length: 30 }, (_, index) => tap(1000, index, 0))
    const result = correctImprovisedNotes(chart, input)
    expect(result).toHaveLength(30)
    expect(result.every((note) => Number.isFinite(note.time))).toBe(true)
  })

  it('uses the chart offset and continuous tempo map across BPM changes', () => {
    const tempo = { ...chart, offset: 75, bpmChanges: [{ time: 2000, bpm: 240 }, { time: 4000, bpm: 90 }] }
    const beats = [0, 0.25, 0.5, 3.5, 3.75, 4, 4.25, 4.5, 11.5, 11.75, 12, 12.25]
    const ideal = beats.map((beat) => timeAtBeat(tempo, beat))
    const input = ideal.map((time, index) => tap(time + (index % 2 ? -2 : 3), index))
    const result = correctImprovisedNotes(tempo, input)
    result.forEach((note, index) => {
      expect(note.time).toBeCloseTo(ideal[index], 6)
      expect(beatAtTime(tempo, note.time)).toBeCloseTo(beats[index], 6)
    })
  })

  it('stays within the audio, uses real grid lines at boundaries, and limits movement', () => {
    const tempo = { ...chart, offset: 75, duration: 2021 }
    const input = [0, 7, 2008, 2021].map((time, index) => tap(time, index, 0))
    const result = correctImprovisedNotes(tempo, input)
    result.forEach((note) => {
      const original = input.find((item) => item.id === note.id)!
      expect(note.time).toBeGreaterThanOrEqual(0)
      expect(note.time).toBeLessThanOrEqual(tempo.duration)
      expect(Math.abs(beatAtTime(tempo, note.time) - beatAtTime(tempo, original.time))).toBeLessThanOrEqual(0.125 + 1e-8)
      if (note.time !== original.time) expect(beatAtTime(tempo, note.time) * 16).toBeCloseTo(Math.round(beatAtTime(tempo, note.time) * 16), 6)
    })
    expect(new Set(result.map((note) => note.time)).size).toBe(input.length)
  })

  it('leaves holds unchanged and accepts an empty take', () => {
    const hold: ChartNote = { id: 'hold', kind: 'hold', lane: 0, time: 1007, endTime: 2009 }
    expect(correctImprovisedNotes(chart, [hold])).toEqual([hold])
    expect(correctImprovisedNotes(chart, [])).toEqual([])
  })
})
