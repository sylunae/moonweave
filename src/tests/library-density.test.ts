import { describe, expect, it } from 'vitest'
import { noteDensityBins } from '@/features/chart/LibraryCards'

describe('library note density', () => {
  it('counts note heads in time order, including a hold and a note at the end', () => {
    const bins = noteDensityBins({ duration: 64000, notes: [
      { id: 'a', kind: 'note', lane: 0, time: 0 },
      { id: 'b', kind: 'hold', lane: 1, time: 32000, endTime: 40000 },
      { id: 'c', kind: 'note', lane: 3, time: 32500 },
      { id: 'd', kind: 'note', lane: 2, time: 64000 },
    ] })
    expect(bins).toHaveLength(64)
    expect([bins[0], bins[32], bins[63]]).toEqual([1, 2, 1])
    expect(bins.reduce((a, b) => a + b)).toBe(4)
  })

  it('keeps empty and pending charts at zero density', () => {
    expect(noteDensityBins()).toEqual(Array(64).fill(0))
    expect(noteDensityBins({ duration: 120000, notes: [] })).toEqual(Array(64).fill(0))
  })
})
