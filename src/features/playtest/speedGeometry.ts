import { createEditorNoteIndex, visibleEditorNotes } from '../chart/editorTimeline'
import { scrollSpeedMap, type ChartEffect } from '../chart/effects/scrollSpeed'
import type { ChartNote } from '../chart/types'

export interface VisualNote extends ChartNote {
  sourceId: string
  sourceTime: number
  sourceEndTime: number
}

/** Build once per chart. Holds are split at speed boundaries; zero-length pieces keep a cap. */
export function createSpeedGeometry(notes: ChartNote[], effects: ChartEffect[]) {
  const map = scrollSpeedMap(effects)
  const pieces: VisualNote[] = []
  for (const note of notes) {
    const end = note.endTime ?? note.time
    const cuts = [note.time]
    if (note.kind === 'hold') {
      // Binary search skips speed segments before this hold.
      let lo = 0, hi = map.segments.length
      while (lo < hi) {
        const mid = (lo + hi) >>> 1
        if (map.segments[mid].time <= note.time) lo = mid + 1
        else hi = mid
      }
      for (let i = lo; i < map.segments.length && map.segments[i].time < end; i++) cuts.push(map.segments[i].time)
    }
    cuts.push(end)
    for (let i = 0; i < cuts.length - 1; i++) {
      const time = map.positionAt(cuts[i]), endTime = map.positionAt(cuts[i + 1])
      pieces.push({ ...note, id: `${note.id}:${i}`, sourceId: note.id, sourceTime: cuts[i], sourceEndTime: cuts[i + 1],
        time, endTime, kind: note.kind === 'hold' && endTime > time ? 'hold' : 'note' })
    }
  }
  const index = createEditorNoteIndex(pieces)
  return { map, pieces, visible: (from: number, to: number) => visibleEditorNotes(index, from, to) as VisualNote[] }
}
