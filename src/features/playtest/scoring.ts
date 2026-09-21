import type { ChartNote } from '@/features/chart/types'

export type Judgment = 'Perfect' | 'Good' | 'Miss'
export const MAX_SCORE = 10_000_000

export function countNoteTicks(note: ChartNote, holdTickMs: number) {
  if (note.kind !== 'hold' || !note.endTime) return 1
  let ticks = 1
  for (let next = note.time + holdTickMs; next + holdTickMs < note.endTime - 0.01; next += holdTickMs) ticks++
  return ticks
}

export function judgmentUnits(result: Judgment) {
  return result === 'Perfect' ? 2 : result === 'Good' ? 1 : 0
}

export function scoreFromUnits(units: number, totalTicks: number) {
  return totalTicks ? Math.round(MAX_SCORE * units / (totalTicks * 2)) : 0
}

export function accuracyFromUnits(units: number, judgedTicks: number) {
  return judgedTicks ? units / (judgedTicks * 2) * 100 : 100
}
