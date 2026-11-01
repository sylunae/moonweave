import { describe, expect, it } from 'vitest'
import { mergeRecording, recordingConflicts } from '@/features/chart/improvisation'
import type { ChartNote } from '@/features/chart/types'

const tap = (id: string, time: number, lane = 0): ChartNote => ({ id, time, lane, kind: 'note' })

describe('improvised recording merge', () => {
  const existing: ChartNote[] = [tap('before', 100), tap('same', 1000), tap('other-lane', 1500, 1),
    { id: 'hold', time: 1200, endTime: 2000, lane: 0, kind: 'hold' }, tap('after', 2500)]
  const recorded = [tap('new-tap', 1000.5), tap('inside-hold', 1500), tap('free', 2300)]

  it('detects same-lane taps and hold interiors without touching other lanes', () => {
    expect([...recordingConflicts(existing, recorded)]).toEqual(['same', 'hold'])
    expect(recordingConflicts(existing, [tap('at-end', 2000)]).has('hold')).toBe(true)
    expect(recordingConflicts(existing, [tap('nearby', 1010)]).size).toBe(0)
  })

  it('overwrites only overlapping original notes, preserving all performed timestamps', () => {
    const result = mergeRecording(existing, recorded, true)
    expect(result.map((note) => note.id)).toEqual(['before', 'new-tap', 'other-lane', 'inside-hold', 'free', 'after'])
    expect(result.find((note) => note.id === 'new-tap')?.time).toBe(1000.5)
    expect(existing).toHaveLength(5)
    expect(recorded).toHaveLength(3)
  })

  it('keeps original notes and skips only conflicting new taps when overwrite is declined', () => {
    expect(mergeRecording(existing, recorded, false).map((note) => note.id))
      .toEqual(['before', 'same', 'hold', 'other-lane', 'free', 'after'])
  })

  it('preserves chords and merges an empty chart', () => {
    const chord = [tap('a', 1000), tap('b', 1000, 1)]
    expect(mergeRecording([], chord, false)).toEqual(chord)
    expect(mergeRecording(existing, [], true)).toEqual([...existing].sort((a, b) => a.time - b.time))
  })
})
