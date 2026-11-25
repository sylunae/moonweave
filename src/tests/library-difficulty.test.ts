import { describe, expect, it } from 'vitest'
import { chooseDifficulty } from '@/features/chart/libraryMetadata'
import { normalizeChart, normalizeManagedChart } from '@/features/chart/types'

describe('library difficulty tracks', () => {
  it('keeps a legacy chart playable and restores its notes after a difficulty change and reload', () => {
    const original = normalizeManagedChart({ notes: [{ id: 'old', lane: 1, time: 500, kind: 'note' }] })
    expect(original.library).toMatchObject({ levels: [1, 1, 1, 1], tier: 1 })
    expect(Object.keys(original.tracks!)).toEqual(['0', '2', '3'])
    const hard = chooseDifficulty(original, 2)
    expect(hard.notes).toEqual([])
    hard.notes = [{ id: 'hard', lane: 2, time: 750, kind: 'note' }]
    const reloaded = normalizeManagedChart(JSON.parse(JSON.stringify(hard)))
    expect(reloaded).toEqual(hard)
    const normal = chooseDifficulty(reloaded, 1)
    expect(normal.notes).toEqual(original.notes)
    expect(chooseDifficulty(normal, 2).notes).toEqual(hard.notes)
  })

  it('fills only missing levels and preserves notes in existing tracks', () => {
    const note = { id: 'existing', lane: 0, time: 500, kind: 'note' }
    const chart = normalizeManagedChart({ library: { levels: [0, 4, 8, 0], tier: 0 }, notes: [note], tracks: { 2: { notes: [note] } } })
    expect(chart.library).toMatchObject({ levels: [1, 4, 8, 1], tier: 1 })
    expect(chart.notes).toEqual([note])
    expect(chooseDifficulty(chart, 2).notes).toEqual([note])
    expect(chooseDifficulty(chart, 0).notes).toEqual([])
  })

  it('sanitizes inactive tracks and invalid metadata imported from a package', () => {
    const chart = normalizeChart({ library: { levels: [2,0,6,0], tier: 30, tags: [null,'pop'] }, tracks: { 2: { notes: ['bad'], effects: null, title: 'wrong' } } })
    expect(chart.library?.tier).toBe(0)
    expect(chart.library?.tags).toEqual(['pop'])
    expect(chooseDifficulty(chart, 2)).toMatchObject({ title: chart.title, notes: [], effects: [] })
  })
})
