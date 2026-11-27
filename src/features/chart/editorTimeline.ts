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

export function findEditorNoteOverlaps(notes: ChartNote[]) {
  const lanes: ChartNote[][] = Array.from({ length: 8 }, () => [])
  for (const note of notes) {
    if (!note.disabled && !note.visualOnly) lanes[note.lane + (note.red ? 4 : 0)].push(note)
  }

  const ids = new Set<string>()
  const times = new Set<number>()
  const epsilon = 0.000_001 // Floating-point noise from snapping and moving groups.
  for (const lane of lanes) {
    lane.sort((a, b) => a.time - b.time)
    let previous: ChartNote | undefined
    for (const note of lane) {
      const end = note.kind === 'hold' ? note.endTime ?? note.time : note.time
      if (previous) {
        const previousEnd = previous.kind === 'hold' ? previous.endTime ?? previous.time : previous.time
        if (note.time - previous.time <= epsilon || note.time < previousEnd - epsilon) {
          ids.add(previous.id)
          ids.add(note.id)
          times.add(note.time)
        }
        if (previousEnd > end) continue
      }
      previous = note
    }
  }
  return { ids, times: [...times].sort((a, b) => a - b) }
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
