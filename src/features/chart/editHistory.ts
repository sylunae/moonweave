import type { Chart } from './types'
import type { DifficultyTrack } from './libraryMetadata'

export type EditSnapshot = Pick<Chart, 'notes' | 'bpm' | 'bpmChanges' | 'effects' | 'offset' | 'aiImportHistory' | 'tracks'>
export const editSnapshot = ({ notes, bpm, bpmChanges, effects, offset, aiImportHistory, tracks }: Chart): EditSnapshot => ({
  notes, bpm, bpmChanges, effects, offset, aiImportHistory, ...(tracks && { tracks }),
})
export const restoreEdit = (chart: Chart, snapshot: EditSnapshot): Chart => ({ ...chart, ...snapshot })

export function shiftChartOffset(chart: Chart, offset: number): Chart {
  const delta = offset - chart.offset
  if (!delta) return chart
  const beforeStart = ({ time, endTime = time }: { time: number; endTime?: number }) => time + delta < 0 || endTime + delta < 0
  const shiftTrack = ({ notes, effects, aiImportHistory }: DifficultyTrack): DifficultyTrack => {
    if (notes.some(beforeStart) || effects.some(beforeStart)) throw new Error('Offset would move chart events before zero')
    return {
      aiImportHistory,
      notes: notes.map((n) => ({ ...n, time: n.time + delta, ...(n.endTime === undefined ? {} : { endTime: n.endTime + delta }) })),
      effects: effects.map((e) => ({ ...e, time: e.time + delta, ...(e.endTime === undefined ? {} : { endTime: e.endTime + delta }) })),
    }
  }
  if (chart.bpmChanges.some(beforeStart)) throw new Error('Offset would move chart events before zero')
  return { ...chart, offset,
    ...shiftTrack(chart),
    bpmChanges: chart.bpmChanges.map((c) => ({ ...c, time: c.time + delta })),
    ...(chart.tracks && { tracks: Object.fromEntries(Object.entries(chart.tracks).map(([tier, track]) => [tier, shiftTrack(track)])) }),
  }
}
