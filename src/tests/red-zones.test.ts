import { describe, expect, it } from 'vitest'
import { createRedZoneIndex, RedZoneTracker } from '@/features/playtest/redZones'
import { DEFAULT_CHART, normalizeChart, type ChartNote } from '@/features/chart/types'
import { createChartPackage, readChartPackage } from '@/features/chart/chartPackage'
import { mergeRecording } from '@/features/chart/improvisation'

const tap = (id: string, time: number, red = false, lane = 0): ChartNote => ({ id, time, lane, kind: 'note', ...(red ? { red: true } : {}) })
const hold = (id: string, time: number, endTime: number, lane = 0): ChartNote => ({ ...tap(id, time, true, lane), endTime, kind: 'hold' })

describe('red zone time index', () => {
  it('merges nested and touching zones, preserves gaps and isolates lanes', () => {
    const index = createRedZoneIndex([hold('outer', 100, 300), hold('inner', 150, 200), hold('next', 300, 400), tap('red', 500, true), tap('normal', 450), hold('other', 0, 900, 1)])
    expect(index.lanes[0]).toEqual([{ start: 100, end: 400 }, { start: 500, end: 500 }])
    for (const time of [100, 200, 300, 400, 500]) expect(index.contains(0, time)).toBe(true)
    for (const time of [99, 401, 450, 499, 501]) expect(index.contains(0, time)).toBe(false)
    expect(index.contains(1, 450)).toBe(true)
    expect(index.contains(2, 200)).toBe(false)
  })

  it('catches point notes and entire short holds skipped between frames', () => {
    const tracker = new RedZoneTracker(createRedZoneIndex([tap('red', 100, true), hold('short', 200, 205, 1)]))
    tracker.reset(0)
    expect(tracker.advance(90, new Set([0, 1]))).toBe(0)
    expect(tracker.advance(250, new Set([0, 1]))).toBe(3)
    expect(tracker.advance(300, new Set([0, 1]))).toBe(0)
  })

  it('detects presses inside holds, exact endpoints and restart/seek without replaying earlier zones', () => {
    const tracker = new RedZoneTracker(createRedZoneIndex([hold('red', 100, 400)]))
    tracker.reset(250)
    expect(tracker.advance(300, new Set())).toBe(0)
    expect(tracker.advance(300, new Set([0]))).toBe(1)
    expect(tracker.advance(400, new Set([0]))).toBe(1)
    tracker.reset(401)
    expect(tracker.advance(450, new Set([0]))).toBe(0)
    tracker.reset(0)
    expect(tracker.advance(100, new Set([0]))).toBe(1)
  })

  it('does not scan 50,000 future zones on idle frames or restart near the tail', () => {
    const index = createRedZoneIndex(Array.from({ length: 50_000 }, (_, i) => tap(String(i), 1000 + i * 10, true)))
    const original = index.lanes[0]
    let reads = 0
    index.lanes[0] = new Proxy(original, { get(target, key, receiver) {
      if (typeof key === 'string' && /^\d+$/.test(key)) reads++
      return Reflect.get(target, key, receiver)
    } })
    const tracker = new RedZoneTracker(index)
    tracker.reset(0)
    reads = 0
    for (let frame = 0; frame < 500; frame++) tracker.advance(frame, new Set([0]))
    expect(reads).toBeLessThanOrEqual(500)
    reads = 0
    tracker.reset(500_980)
    expect(reads).toBeLessThan(20)
    expect(tracker.advance(501_000, new Set([0]))).toBe(1)
  })
})

it('round-trips overlapping red notes/holds while retaining legacy notes and rejecting truthy red flags', async () => {
  const notes = [tap('normal', 100), tap('red', 100, true), hold('hold', 200, 500)]
  const restored = normalizeChart((await readChartPackage(await createChartPackage({ ...DEFAULT_CHART, notes }, {}))).chart)
  expect(restored.notes).toEqual(notes)
  expect(normalizeChart({ notes: [{ ...tap('legacy', 0), red: 'true' }] }).notes[0].red).toBeUndefined()
})

it('keeps red zones when saving an overlapping normal improvisation, with either conflict option', () => {
  const zones = [tap('red', 100, true), hold('red-hold', 200, 500)]
  const recorded = [tap('a', 100), tap('b', 300)]
  for (const overwrite of [false, true]) expect(mergeRecording(zones, recorded, overwrite)).toHaveLength(4)
})

it('treats beat-conversion drift at either boundary as inside without granting a timing window', () => {
  const index = createRedZoneIndex([hold('red', 1000 + 1e-10, 1500 - 1e-10)])
  expect(index.contains(0, 1000)).toBe(true)
  expect(index.contains(0, 1500)).toBe(true)
  expect(index.contains(0, 999.99)).toBe(false)
  expect(index.contains(0, 1500.01)).toBe(false)
})

it('narrows hold danger and expands hold protection while preserving red taps and short-hold danger', () => {
  const notes = [hold('long', 1000, 2000), hold('short', 3000, 3100), tap('point', 4000, true)]
  const danger = createRedZoneIndex(notes, -80)
  expect(danger.lanes[0]).toEqual([{ start: 1080, end: 1920 }, { start: 3025, end: 3075 }, { start: 4000, end: 4000 }])
  expect(createRedZoneIndex(notes, 80).lanes[0]).toEqual([{ start: 920, end: 2080 }, { start: 2920, end: 3180 }, { start: 4000, end: 4000 }])
})
