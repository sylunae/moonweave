import { describe, expect, it } from 'vitest'
import { accuracyFromUnits, countNoteTicks, scoreFromUnits } from '@/features/playtest/scoring'

describe('playtest scoring', () => {
  it('counts tap and legacy-compatible hold ticks', () => {
    expect(countNoteTicks({ id: 'tap', lane: 0, time: 1000, kind: 'note' }, 250)).toBe(1)
    expect(countNoteTicks({ id: 'hold', lane: 1, time: 1000, endTime: 2000, kind: 'hold' }, 250)).toBe(3)
  })

  it('normalizes score and accuracy from half units', () => {
    expect(scoreFromUnits(4, 4)).toBe(5_000_000)
    expect(accuracyFromUnits(3, 2)).toBe(75)
  })
})
