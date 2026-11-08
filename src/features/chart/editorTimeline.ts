import type { ChartNote } from './types'

export interface EditorNoteIndex {
  points: ChartNote[]
  holdsByStart: ChartNote[]
  holdsByEnd: ChartNote[]
}

const lowerBound = (notes: ChartNote[], time: number, timeOf: (note: ChartNote) => number) => {
  let low = 0
  let high = notes.length
  while (low < high) {
    const middle = (low + high) >>> 1
    if (timeOf(notes[middle]) < time) low = middle + 1
    else high = middle
  }
  return low
}

const upperBound = (notes: ChartNote[], time: number, timeOf: (note: ChartNote) => number) => {
  let low = 0
  let high = notes.length
  while (low < high) {
    const middle = (low + high) >>> 1
    if (timeOf(notes[middle]) <= time) low = middle + 1
    else high = middle
  }
  return low
}

export function createEditorNoteIndex(notes: ChartNote[]): EditorNoteIndex {
  const points: ChartNote[] = []
  const holdsByEnd: ChartNote[] = []
  for (const note of notes) {
    if (note.kind === 'hold') holdsByEnd.push(note)
    else points.push(note)
  }
  points.sort((a, b) => a.time - b.time)
  const holdsByStart = [...holdsByEnd].sort((a, b) => a.time - b.time)
  holdsByEnd.sort((a, b) => (a.endTime ?? a.time) - (b.endTime ?? b.time))
  return { points, holdsByStart, holdsByEnd }
}

/** Returns only notes whose visible geometry intersects the editor viewport. */
export function visibleEditorNotes(index: EditorNoteIndex, from: number, to: number, visible: ChartNote[] = []) {
  visible.length = 0
  const pointStart = lowerBound(index.points, from, (note) => note.time)
  for (let cursor = pointStart; cursor < index.points.length; cursor += 1) {
    const note = index.points[cursor]
    if (note.time > to) break
    visible.push(note)
  }

  const firstEndingInView = lowerBound(index.holdsByEnd, from, (note) => note.endTime ?? note.time)
  const firstStartingAfterView = upperBound(index.holdsByStart, to, (note) => note.time)
  if (index.holdsByEnd.length - firstEndingInView <= firstStartingAfterView) {
    for (let cursor = firstEndingInView; cursor < index.holdsByEnd.length; cursor += 1) {
      const note = index.holdsByEnd[cursor]
      if (note.time <= to) visible.push(note)
    }
  } else {
    for (let cursor = 0; cursor < firstStartingAfterView; cursor += 1) {
      const note = index.holdsByStart[cursor]
      if ((note.endTime ?? note.time) >= from) visible.push(note)
    }
  }
  return visible
}
