import type { Chart } from './types'

export type EditSnapshot = Pick<Chart, 'notes' | 'bpm' | 'bpmChanges' | 'effects' | 'offset'>
export const editSnapshot = ({ notes, bpm, bpmChanges, effects, offset }: Chart): EditSnapshot => ({ notes, bpm, bpmChanges, effects, offset })
export const restoreEdit = (chart: Chart, snapshot: EditSnapshot): Chart => ({ ...chart, ...snapshot })

export function shiftChartOffset(chart: Chart, offset: number): Chart {
  const delta = offset - chart.offset
  if (!delta) return chart
  const times = [...chart.notes.flatMap((n) => [n.time, ...(n.endTime === undefined ? [] : [n.endTime])]),
    ...chart.bpmChanges.map((c) => c.time), ...chart.effects.flatMap((e) => [e.time, ...(e.endTime === undefined ? [] : [e.endTime])])]
  if (times.some((time) => time + delta < 0)) throw new Error('Offset would move chart events before zero')
  return { ...chart, offset,
    notes: chart.notes.map((n) => ({ ...n, time: n.time + delta, ...(n.endTime === undefined ? {} : { endTime: n.endTime + delta }) })),
    bpmChanges: chart.bpmChanges.map((c) => ({ ...c, time: c.time + delta })),
    effects: chart.effects.map((e) => ({ ...e, time: e.time + delta, ...(e.endTime === undefined ? {} : { endTime: e.endTime + delta }) })),
  }
}
