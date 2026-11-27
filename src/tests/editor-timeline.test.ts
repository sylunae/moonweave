import { describe, expect, it } from 'vitest'
import { createEditorNoteIndex, findEditorNoteOverlaps, visibleEditorNotes } from '@/features/chart/editorTimeline'
import type { ChartNote } from '@/features/chart/types'

const note = (id: string, time: number, endTime?: number): ChartNote => ({
  id,
  lane: 0,
  time,
  endTime,
  kind: endTime === undefined ? 'note' : 'hold',
})

it('finds same-layer duplicate starts and notes inside holds while allowing intentional overlays', () => {
  const overlaps = findEditorNoteOverlaps([
    note('tap-in-hold', 750),
    note('tail', 1500),
    note('hold', 500, 1500),
    note('nested-hold', 600, 700),
    { ...note('other-lane', 750), lane: 1 },
    { ...note('visual', 750), visualOnly: true },
    { ...note('disabled', 750), disabled: true },
    { ...note('red-a', 1000), red: true },
    { ...note('red-b', 1000), red: true },
    note('tap-a', 2000),
    note('tap-b', 2000 + 1e-10),
  ])
  expect(overlaps.ids).toEqual(new Set(['hold', 'nested-hold', 'tap-in-hold', 'red-a', 'red-b', 'tap-a', 'tap-b']))
  expect(overlaps.times).toEqual([600, 750, 1000, 2000 + 1e-10])
})

describe('editor timeline visibility', () => {
  it('keeps point notes inside the viewport only', () => {
    const index = createEditorNoteIndex([note('late', 4_000), note('visible', 2_000), note('early', 500)])
    expect(visibleEditorNotes(index, 1_000, 3_000).map(({ id }) => id)).toEqual(['visible'])
  })

  it('keeps holds that cross into the viewport', () => {
    const index = createEditorNoteIndex([
      note('crossing', 200, 1_500),
      note('inside', 1_200, 1_800),
      note('ended', 100, 900),
      note('future', 2_100, 2_500),
    ])
    expect(visibleEditorNotes(index, 1_000, 2_000).map(({ id }) => id).sort()).toEqual(['crossing', 'inside'])
  })
})
