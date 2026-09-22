import { describe, expect, it } from 'vitest'
import { createEditorNoteIndex, visibleEditorNotes } from '@/features/chart/editorTimeline'
import type { ChartNote } from '@/features/chart/types'

const note = (id: string, time: number, endTime?: number): ChartNote => ({
  id,
  lane: 0,
  time,
  endTime,
  kind: endTime === undefined ? 'note' : 'hold',
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
