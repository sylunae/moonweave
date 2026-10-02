import { describe, expect, it } from 'vitest'
import { adjacentBeatLine, beatAtTime, beatLinesInRange, bpmAtTime, holdTickTimes, scrollPositionAtTime, snapToBeatLine, timeAtScrollPosition } from '@/features/chart/tempoMap'
import { normalizeChart } from '@/features/chart/types'

const chart = normalizeChart({
  bpm: 120,
  offset: 0,
  duration: 10_000,
  bpmChanges: [{ time: 2_000, bpm: 240 }, { time: 4_000, bpm: 60 }],
  notes: [],
})

describe('tempo map', () => {
  it('normalizes, sorts, and deduplicates valid BPM changes', () => {
    const normalized = normalizeChart({
      bpmChanges: [{ time: 3000, bpm: 90 }, { time: 1000, bpm: 150 }, { time: 1000, bpm: 180 }, { time: -1, bpm: 120 }, { time: 2000, bpm: 800 }],
    })
    expect(normalized.bpmChanges).toEqual([{ time: 1000, bpm: 180 }, { time: 3000, bpm: 90 }])
  })

  it('integrates beats continuously through many tempo segments', () => {
    expect(bpmAtTime(chart, 1_999)).toBe(120)
    expect(bpmAtTime(chart, 2_000)).toBe(240)
    expect(beatAtTime(chart, 2_000)).toBeCloseTo(4)
    expect(beatAtTime(chart, 4_000)).toBeCloseTo(12)
    expect(beatAtTime(chart, 5_000)).toBeCloseTo(13)
  })

  it('generates and navigates beat lines using the local BPM', () => {
    const lines = beatLinesInRange(chart, 1_500, 2_750, 1)
    expect(lines.map((line) => Math.round(line.time))).toEqual([1500, 2000, 2250, 2500, 2750])
    expect(snapToBeatLine(chart, 2_390, 1)).toBeCloseTo(2_500)
    expect(adjacentBeatLine(chart, 2_500, 1, 1)).toBeCloseTo(2_750)
  })

  it('keeps adjacent navigation aligned when changing subdivisions', () => {
    const triplet = adjacentBeatLine(chart, 2_000, 3, 1)
    expect(triplet).toBeCloseTo(2_000 + 60_000 / 240 / 3)
    expect(adjacentBeatLine(chart, triplet, 16, 1)).toBeCloseTo(2_000 + 60_000 / 240 * 0.375)
  })

  it('uses tempo-aware half-beats for hold ticks', () => {
    expect(holdTickTimes(chart, 1_500, 2_750).map(Math.round)).toEqual([1750, 2000, 2125, 2250, 2375, 2500])
  })

  it('accelerates visual distance after entering a higher BPM segment', () => {
    expect(scrollPositionAtTime(chart, 2_000)).toBeCloseTo(2_000)
    expect(scrollPositionAtTime(chart, 2_500)).toBeCloseTo(3_000)
    expect(timeAtScrollPosition(chart, 3_000)).toBeCloseTo(2_500)
  })
})
