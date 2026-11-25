import { describe, expect, it } from 'vitest'
import { chooseDifficulty, libraryMetadata } from '@/features/chart/libraryMetadata'
import { normalizeChart } from '@/features/chart/types'

describe('library difficulty tracks', () => {
  it('keeps a legacy chart playable and restores its notes after a difficulty change and reload', () => {
    const chart = normalizeChart({ notes: [{ id: 'old', lane: 1, time: 500, kind: 'note' }] })
    const original = { ...chart, library: { ...libraryMetadata(chart.library), levels: [0, 1, 9, 0] } }
    const hard = chooseDifficulty(original, 2)
    expect(hard.notes).toEqual([])
    hard.notes = [{ id: 'hard', lane: 2, time: 750, kind: 'note' }]
    const normal = chooseDifficulty(normalizeChart(JSON.parse(JSON.stringify(hard))), 1)
    expect(normal.notes).toEqual(original.notes)
    expect(chooseDifficulty(normal, 2).notes).toEqual(hard.notes)
  })

  it('sanitizes inactive tracks and invalid metadata imported from a package', () => {
    const chart = normalizeChart({ library: { levels: [2,0,6,0], tier: 30, tags: [null,'pop'] }, tracks: { 2: { notes: ['bad'], effects: null, title: 'wrong' } } })
    expect(chart.library?.tier).toBe(0)
    expect(chart.library?.tags).toEqual(['pop'])
    expect(chooseDifficulty(chart, 2)).toMatchObject({ title: chart.title, notes: [], effects: [] })
  })
})
