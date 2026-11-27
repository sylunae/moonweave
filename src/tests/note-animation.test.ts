import { expect, it } from 'vitest'
import { motionValue, type MotionKey, type NoteAnimation } from '@/features/chart/effects/noteAnimation'
import { scrollSpeedMap } from '@/features/chart/effects/scrollSpeed'
import { DEFAULT_CHART, normalizeChart, type ChartNote } from '@/features/chart/types'
import { compileMotion, MotionGeometry } from '@/features/playtest/noteMotion'
import type { VisualNote } from '@/features/playtest/speedGeometry'
import { createChartPackage, readChartPackage } from '@/features/chart/chartPackage'
import { chooseDifficulty } from '@/features/chart/libraryMetadata'
import { editSnapshot, restoreEdit, shiftChartOffset } from '@/features/chart/editHistory'
import { beatAtTime, retimeInitialBpm } from '@/features/chart/tempoMap'

const key = (at: number, value: number, curve: MotionKey['curve'] = 'step'): MotionKey => ({ at, value, curve })
const slow: NoteAnimation = { speed: 0.4, keys: {} }
const note: ChartNote = { id: 'a', kind: 'note', time: 5000, lane: 0 }
const normal = scrollSpeedMap([])

it('admits a later slow note early, crosses a normal note and lands exactly on its original beat', () => {
  const group = new MotionGeometry(slow, [note], normal, DEFAULT_CHART)
  const hits: VisualNote[] = []
  group.append(hits, 2500, 5, 1000, 2500, 2500, 3501)
  expect(hits).toHaveLength(1)
  expect(hits[0].head! + hits[0].shift!).toBe(3500)
  hits.length = 0
  group.append(hits, 5000, 10, 1000, 5000, 5000, 6000)
  expect(hits[0].head! + hits[0].shift!).toBe(note.time)
})

it('integrates smooth local speed against global ramps, stops and tempo changes', () => {
  const global = scrollSpeedMap([{ id: 'r', type: 'scrollSpeed', time: 0, endTime: 1000, transition: 'linear', multiplier: 2 }])
  const motion = compileMotion({ ...slow, keys: { speed: [key(0, 0, 'smooth'), key(2, 1), key(3, 0), key(4, -1)] } }, global, DEFAULT_CHART)
  expect(motion.positionAt(1000)).toBeCloseTo(850, 7)
  expect(motion.positionAt(1500)).toBeCloseTo(motion.positionAt(2000))
  expect(motion.positionAt(2500)).toBeCloseTo(motion.positionAt(2000) - 1000)
  const tempo = { ...DEFAULT_CHART, bpmChanges: [{ time: 500, bpm: 60 }] }
  const ramp = compileMotion({ ...slow, keys: { speed: [key(0, 0, 'linear'), key(2, 2)] } }, normal, tempo)
  expect(ramp.positionAt(1500)).toBeCloseTo(1750)
})

it('includes the interior turning point of a folded hold even when both ends coincide', () => {
  const group = { ...slow, keys: { speed: [key(0, 1, 'smooth'), key(2, -1)] } }
  const motion = compileMotion(group, normal, DEFAULT_CHART)
  const bounds = motion.bounds(0, 1000)
  expect(bounds.low).toBeCloseTo(0)
  expect(bounds.high).toBeCloseTo(312.5)
  const geometry = new MotionGeometry(group, [{ ...note, time: 0, endTime: 1000, kind: 'hold' }], normal, DEFAULT_CHART)
  const hits: VisualNote[] = []
  geometry.append(hits, 0, 0, 1000, 0, 300, 310)
  expect(hits).toHaveLength(1)
})

it('jumps offset on the exact key and interpolates hit opacity on a separate clock', () => {
  const offsets = [key(2, 10), key(2.125, -5), key(2.25, 0)]
  expect([1, 2, 2.12499, 2.125, 2.25].map(t => motionValue(offsets, t, 0))).toEqual([0, 10, 10, -5, 0])
  expect(motionValue([key(0, 100, 'linear'), key(200, 0)], 50, 100)).toBe(75)
})

it('keeps notes with an initial hide key hidden through preroll until their reveal', () => {
  const tempo = { ...DEFAULT_CHART, offset: 160 }
  const notes = [{ ...note, visualOnly: true }]
  const visible = (geometry: MotionGeometry, time: number) => {
    const hits: VisualNote[] = []
    geometry.append(hits, time, beatAtTime(tempo, time), 1000, time, time - 260, time + 1000)
    return hits
  }
  const opening = new MotionGeometry({ speed: 0, keys: {
    opacity: [key(-1, 0), key(8, 100)],
  } }, notes, normal, tempo)
  for (const time of [-1100, -341, 0, 4159]) expect(visible(opening, time)).toHaveLength(0)
  expect(visible(opening, 4160)[0]?.opacity).toBe(1)

  const later = new MotionGeometry({ speed: 0, keys: {
    opacity: [key(3, 0), key(8, 100)],
  } }, notes, normal, tempo)
  expect(visible(later, -1100)[0]?.opacity).toBe(1)
  expect(visible(later, 1659)[0]?.opacity).toBe(1)
  expect(visible(later, 1660)).toHaveLength(0)
})

it('migrates legacy animations and round-trips per-note properties through difficulty changes, retiming and undo', async () => {
  const animation = { ...slow, keys: { speed: [key(2, 0)], hitOffset: [key(150, 12)] } }
  const legacy = { id: 'slow', name: 'Slow', ...animation }
  const legacyNote = { ...note, animationId: 'slow', visualOnly: true }
  const chart = normalizeChart({
    animations: [legacy], notes: [legacyNote], library: { levels: [1, 1, 0, 0], tier: 0 },
    tracks: { 1: { animations: [legacy], notes: [{ ...legacyNote, id: 'b', disabled: true }] } },
  })
  expect(chart.notes[0]).toEqual({ ...note, animation, visualOnly: true })
  expect(chart).not.toHaveProperty('animations')
  const next = chooseDifficulty(chart, 1)
  expect(next.notes[0].animation).toEqual(animation)
  const imported = normalizeChart((await readChartPackage(await createChartPackage(next, {}))).chart)
  expect(imported.notes[0]).toEqual({ ...note, id: 'b', animation, visualOnly: true, disabled: true })
  expect(normalizeChart({ notes: [{ ...note, disabled: 'true' }] }).notes).toEqual([note])
  const restored = chooseDifficulty(imported, 0)
  expect(restored.notes).toEqual(chart.notes)
  expect(shiftChartOffset(retimeInitialBpm(restored, 240), 120).notes[0].animation).toEqual(animation)
  expect(restoreEdit({ ...restored, notes: [] }, editSnapshot(chart)).notes).toEqual(chart.notes)
  expect(normalizeChart({ notes: [legacyNote] }).notes[0]).toEqual({ ...note, visualOnly: true })
})
