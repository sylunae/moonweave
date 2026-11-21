import { createEditorNoteIndex, visibleEditorNotes } from '../chart/editorTimeline'
import { scrollSpeedMap, type ChartEffect } from '../chart/effects/scrollSpeed'
import type { ChartNote } from '../chart/types'

export interface VisualNote extends ChartNote {
  sourceId: string
  sourceTime: number
  sourceEndTime: number
}

/** Build once per chart. A hold stays continuous across speed changes and stops. */
export function createSpeedGeometry(notes: ChartNote[], effects: ChartEffect[]) {
  const map = scrollSpeedMap(effects)
  const pieces: VisualNote[] = []
  for (const note of notes) {
    const end = note.endTime ?? note.time
    const time = map.positionAt(note.time), endTime = map.positionAt(end)
    // All speed multipliers are nonnegative, so the mapped endpoints cover the
    // entire body. Splitting it adds false caps (and white seams) at each cut.
    // A hold entirely inside a stop still needs a visible, zero-distance cap.
    pieces.push({ ...note, sourceId: note.id, sourceTime: note.time, sourceEndTime: end,
      time, endTime, kind: note.kind === 'hold' && endTime > time ? 'hold' : 'note' })
  }
  const index = createEditorNoteIndex(pieces)
  return { map, pieces, visible: (from: number, to: number, output?: VisualNote[]) => visibleEditorNotes(index, from, to, output) as VisualNote[] }
}
