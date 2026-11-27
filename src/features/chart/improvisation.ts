import type { ChartNote } from './types'

// Compare the prepared recording (after correction). Allow 1 ms of timestamp precision.
export function recordingConflicts(existing: ChartNote[], recorded: ChartNote[]) {
  const lanes = Array.from({ length: 8 }, (_, group) => {
    const notes = recorded.filter((note) => !note.visualOnly && !note.disabled && note.lane + (note.red ? 4 : 0) === group).sort((a, b) => a.time - b.time)
    let end = -Infinity
    const ends = notes.map((note) => (end = Math.max(end, note.endTime ?? note.time)))
    return { notes, ends }
  })
  return new Set(existing.filter((note) => {
    if (note.visualOnly || note.disabled) return false
    const { notes, ends } = lanes[note.lane + (note.red ? 4 : 0)]
    let low = 0, high = notes.length
    while (low < high) {
      const mid = (low + high) >>> 1
      if (notes[mid].time <= (note.endTime ?? note.time) + 1) low = mid + 1
      else high = mid
    }
    return low > 0 && ends[low - 1] >= note.time - 1
  }).map((note) => note.id))
}

export function mergeRecording(existing: ChartNote[], recorded: ChartNote[], overwrite: boolean) {
  const conflicts = recordingConflicts(existing, recorded)
  // Keeping existing notes skips only conflicting taps, including taps inside holds.
  const blocked = overwrite ? new Set<string>() : recordingConflicts(recorded, existing)
  const additions = recorded.filter((tap) => !blocked.has(tap.id))
  return [...existing.filter((note) => !overwrite || !conflicts.has(note.id)), ...additions].sort((a, b) => a.time - b.time)
}
