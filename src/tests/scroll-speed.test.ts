import { describe, expect, it } from 'vitest'
import { normalizeEffects, scrollSpeedMap, type ChartEffect } from '@/features/chart/effects/scrollSpeed'
import { normalizeChart } from '@/features/chart/types'
import { beatAtTime, holdTickTimes, retimeInitialBpm, scrollPositionAtTime } from '@/features/chart/tempoMap'
import { editSnapshot, restoreEdit, shiftChartOffset } from '@/features/chart/editHistory'
import { createSpeedGeometry } from '@/features/playtest/speedGeometry'
import { createChartPackage, readChartPackage } from '@/features/chart/chartPackage'

const instant = (id: string, time: number, multiplier: number): ChartEffect => ({ id, type: 'scrollSpeed', time, multiplier, transition: 'instant' })
const ramp = (id: string, time: number, endTime: number, multiplier: number): ChartEffect => ({ ...instant(id, time, multiplier), transition: 'linear', endTime })

describe('scroll speed effects', () => {
  it('defaults legacy charts to no effects without synthesizing BPM speed', () => {
    const chart = normalizeChart({ bpm: 120, bpmChanges: [{ time: 2000, bpm: 240 }] })
    expect(chart.effects).toEqual([])
    expect(beatAtTime(chart, 3000)).toBe(8)
    expect(scrollPositionAtTime(chart, 3000)).toBe(3000)
    expect(scrollSpeedMap(chart.effects).positionAt(3000)).toBe(3000)
  })
  it('sorts, rejects invalid values, duplicate ids, duplicate starts and overlapping ramps', () => {
    expect(normalizeEffects([instant('resume', 4000, 1), ramp('ramp', 1000, 3000, 0), instant('inside', 2000, 2),
      instant('duplicate-time', 1000, 2), instant('ramp', 5000, 2), instant('negative', 0, -1), instant('large', 0, 11),
      instant('nan', 0, NaN), ramp('bad-end', 0, 0, 2), { type: 'unknown' }, null]))
      .toEqual([ramp('ramp', 1000, 3000, 0), instant('resume', 4000, 1)])
  })
  it('integrates speed continuously through instant, ramp, stop and resume boundaries', () => {
    const effects = [instant('fast', 1000, 2), ramp('slow', 2000, 4000, 0), instant('resume', 5000, 1)]
    const map = scrollSpeedMap(effects)
    expect(scrollSpeedMap(effects)).toBe(map)
    expect(map.positionAt(1000)).toBe(1000)
    expect(map.positionAt(2000)).toBe(3000)
    expect(map.speedAt(3000)).toBe(1)
    expect(map.positionAt(3000)).toBe(4500)
    expect(map.positionAt(4000)).toBe(5000)
    expect(map.positionAt(4500)).toBe(5000)
    expect(map.positionAt(6000)).toBe(6000)
    expect(map.speedAt(4500)).toBe(0)
    expect(map.speedAt(5000)).toBe(1)
    expect(map.speedBefore(5000)).toBe(0)
  })
  it('supports ramps starting at zero and adjacent ramps without discontinuities', () => {
    const map = scrollSpeedMap([ramp('a', 0, 1000, 3), ramp('b', 1000, 2000, 1)])
    expect(map.speedBefore(0)).toBe(1)
    expect(map.speedBefore(1000)).toBe(3)
    expect(map.positionAt(1000)).toBe(2000)
    expect(map.positionAt(2000)).toBe(4000)
    expect(map.positionAt(3000)).toBe(5000)
  })
  it('leaves timing and hold ticks independent of visual stops', () => {
    const chart = normalizeChart({ bpm: 120, notes: [{ id: 'hold', lane: 0, kind: 'hold', time: 1000, endTime: 4000 }] })
    const stopped = { ...chart, effects: [instant('stop', 1000, 0)] }
    expect(holdTickTimes(stopped, 1000, 4000)).toEqual(holdTickTimes(chart, 1000, 4000))
    expect(stopped.notes).toBe(chart.notes)
    expect(scrollSpeedMap(stopped.effects).positionAt(4000)).toBe(1000)
  })
  it('keeps all stacked notes visible on a stop plateau, including its endpoints', () => {
    const notes = [1000, 2000, 3000, 4000].map((time, i) => ({ id: String(i), lane: i, kind: 'note' as const, time }))
    const geometry = createSpeedGeometry(notes, [instant('stop', 1000, 0), instant('resume', 4000, 1)])
    expect(geometry.visible(1000, 1000).map((p) => p.sourceId)).toEqual(['0', '1', '2', '3'])
    expect(geometry.visible(1001, 2000)).toEqual([])
  })
  it('splits crossing holds into speed segments and retains zero-distance caps', () => {
    const geometry = createSpeedGeometry([{ id: 'hold', lane: 0, kind: 'hold', time: 500, endTime: 5000 }],
      [ramp('ramp', 1000, 2000, 0), instant('resume', 4000, 2)])
    expect(geometry.pieces.map((p) => [p.time, p.endTime, p.kind])).toEqual([
      [500, 1000, 'hold'], [1000, 1500, 'hold'], [1500, 1500, 'note'], [1500, 3500, 'hold'],
    ])
    expect(geometry.visible(1800, 2000)).toHaveLength(1)
    expect(geometry.visible(1500, 1500)).toHaveLength(3)
  })
  it('retimes both effect endpoints with initial BPM and shifts them with offset', () => {
    const chart = normalizeChart({ bpm: 120, effects: [ramp('ramp', 2000, 4000, 0)], notes: [{ id: 'n', lane: 0, kind: 'note', time: 2000 }] })
    const faster = retimeInitialBpm(chart, 240)
    expect(faster.effects[0]).toMatchObject({ time: 1000, endTime: 2000 })
    expect(faster.notes[0].time).toBe(1000)
    const shifted = shiftChartOffset(faster, 500)
    expect(shifted.effects[0]).toMatchObject({ time: 1500, endTime: 2500 })
    expect(shifted.notes[0].time).toBe(1500)
    expect(() => shiftChartOffset(chart, -3000)).toThrow()
  })
  it('restores linked edits atomically without reverting media or metadata', () => {
    const before = normalizeChart({ effects: [ramp('ramp', 2000, 4000, 0)] })
    const after = { ...retimeInitialBpm(before, 240), title: 'New title', audioPath: 'new.ogg' }
    const undone = restoreEdit(after, editSnapshot(before))
    expect(undone.effects).toEqual(before.effects)
    expect(undone.bpm).toBe(120)
    expect(undone.title).toBe('New title')
    expect(undone.audioPath).toBe('new.ogg')
    expect(restoreEdit(undone, editSnapshot(after)).effects).toEqual(after.effects)
  })
  it('round-trips effects through JSON and mwchart with unchanged timing', async () => {
    const chart = normalizeChart({ effects: [ramp('ramp', 1000, 3000, 0), instant('resume', 4000, 1)] })
    expect(normalizeChart(JSON.parse(JSON.stringify(chart)))).toEqual(chart)
    const restored = normalizeChart((await readChartPackage(await createChartPackage(chart, {}))).chart)
    expect(restored).toEqual(chart)
  })
})
