import { describe, expect, it } from 'vitest'
import { webcrypto } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { normalizeChart, type Chart } from '@/features/chart/types'
import { editSnapshot, restoreEdit } from '@/features/chart/editHistory'
import { AI_MAX_BYTES, AiChartError, aiChartRevision, aiNotesRevision, applyAiPlan, createAiContext, parseAiJson, prepareAiImport, prepareChartTransfer } from '@/features/chart/ai/aiChart'

if (!globalThis.crypto?.subtle) Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true })
const empty = () => normalizeChart({ audioName: 'song.wav', duration: 10000, bpm: 120, offset: 1000 })
const tap = (id = 'a', time = 1000, lane = 0) => ({ id, time, lane, kind: 'note' as const })
const song = (chart: Chart) => ({ audioName: chart.audioName, duration: chart.duration, bpm: chart.bpm, offset: chart.offset, bpmChanges: chart.bpmChanges })
const standalone = (chart = empty()) => ({ format: 'moonweave-ai-chart', version: 1, requestId: 'batch-1', mode: 'replace', unit: 'ms', song: song(chart), notes: [tap()] })
const target = async (chart: Chart) => ({ chartId: 'chart-a', revision: await aiChartRevision(chart) })
async function expectIssue(promise: Promise<unknown>, code: string) {
  try { await promise; expect.fail('Expected rejection') }
  catch (error) { expect(error).toBeInstanceOf(AiChartError); expect((error as AiChartError).issues.some((issue) => issue.code === code)).toBe(true) }
}

describe('AI file protocol', () => {
  it('reuses an old bound AI chart with different audio and duration, preserving destination media', async () => {
    const chart = normalizeChart({ ...empty(), title: 'MIDI version', audioName: 'midi-render.wav', audioPath: 'new-audio',
      duration: 12000, bpm: 140, backgroundPath: 'background', coverPath: 'cover', notes: [tap('old', 500)],
      effects: [{ id: 'speed', type: 'scrollSpeed', transition: 'instant', time: 4000, multiplier: 2 }] })
    const input = { ...standalone(), target: { chartId: 'original-chart', revision: 'obsolete' },
      song: { ...song(empty()), bpmChanges: [{ time: 2000, bpm: 180 }] }, unit: 'beat',
      notes: [{ id: 'new', kind: 'hold', lane: 1, beat: 1, endBeat: 4 }] }
    const plan = await prepareChartTransfer(chart, 'midi-chart', input)
    const next = applyAiPlan(chart, 'midi-chart', plan)
    expect(next.notes).toEqual([{ id: 'new', kind: 'hold', lane: 1, time: 1500, endTime: 2000 + 2000 / 3 }])
    expect(next).toMatchObject({ title: chart.title, audioName: chart.audioName, audioPath: chart.audioPath,
      duration: 12000, backgroundPath: 'background', coverPath: 'cover', effects: chart.effects, bpm: 120, offset: 1000 })
    expect(plan.summary).toEqual({ added: 1, updated: 0, deleted: 1, holds: 1 })
    expect(restoreEdit(next, editSnapshot(chart))).toEqual(chart)
    expect(() => applyAiPlan({ ...chart, notes: [tap('human')] }, 'midi-chart', plan)).toThrow(AiChartError)
    expect(() => applyAiPlan(chart, 'other-chart', plan)).toThrow(AiChartError)
    await expectIssue(prepareAiImport(chart, 'midi-chart', input), 'audio')
  })

  it('reuses native chart.json without importing source media or requiring audio', async () => {
    const chart = normalizeChart({ duration: 15000, notes: [tap('a'), tap('remove', 2000, 1)] })
    const source = normalizeChart({ ...empty(), audioPath: 'source.wav', notes: [tap('a', 1500), tap('add', 2500, 2)] })
    const plan = await prepareChartTransfer(chart, 'chart-a', source)
    const next = applyAiPlan(chart, 'chart-a', plan)
    expect(next.notes).toEqual(source.notes)
    expect(next.audioPath).toBe('')
    expect(next.audioName).toBe('')
    expect(next.duration).toBe(15000)
    expect(plan.summary).toEqual({ added: 1, updated: 1, deleted: 1, holds: 0 })
    // Transfer remains possible even when the source's request ID was used on this chart.
    expect((await prepareChartTransfer({ ...chart, aiImportHistory: ['batch-1'] }, 'chart-a', standalone())).next.notes).toHaveLength(1)
  })

  it('rejects partial files, bad notes and out-of-bounds content when reusing a chart', async () => {
    await expectIssue(prepareChartTransfer(empty(), 'chart-a', { ...standalone(), mode: 'patch' }), 'transfer')
    await expectIssue(prepareChartTransfer(empty(), 'chart-a', { ...standalone(), mode: 'segment', range: { start: 0, end: 5000 } }), 'transfer')
    await expectIssue(prepareChartTransfer(empty(), 'chart-a', { ...standalone(), notes: [tap(), tap('b')] }), 'collision')
    await expectIssue(prepareChartTransfer(empty(), 'chart-a', { ...standalone(), notes: [tap('late', 11000)] }), 'bounds')
    await expectIssue(prepareChartTransfer(empty(), 'chart-a', { ...standalone(), song: { ...song(empty()), bpmChanges: [{ time: 11000, bpm: 180 }] } }), 'number')
    await expectIssue(prepareChartTransfer(empty(), 'chart-a', { ...standalone(), notes: [{ ...tap(), lane: 5 }] }), 'number')
    await expectIssue(prepareChartTransfer(empty(), 'chart-a', { ...standalone(), notes: [{ ...tap(), kind: 'hold', endTime: 500 }] }), 'hold')
  })

  it('recognizes whole-song segments in ms and beats using source duration', async () => {
    const chart = normalizeChart({ ...empty(), audioName: 'midi.wav', duration: 12000 })
    const full = { ...standalone(), mode: 'segment', target: { chartId: 'old', revision: 'old' }, range: { start: 0, end: 10000 } }
    expect((await prepareChartTransfer(chart, 'chart-a', full)).next.notes).toEqual(full.notes)
    const beatFile = { ...full, unit: 'beat', range: { start: -2, end: 18 }, notes: [{ id: 'a', kind: 'note', lane: 0, beat: 0 }] }
    expect((await prepareChartTransfer(chart, 'chart-a', beatFile)).next.notes).toEqual([tap()])
    await expectIssue(prepareChartTransfer(chart, 'chart-a', { ...full, range: { start: 1, end: 10000 } }), 'transfer')
    await expectIssue(prepareChartTransfer(chart, 'chart-a', { ...full, range: { start: 0, end: 12000 } }), 'transfer')
    await expectIssue(prepareChartTransfer(chart, 'chart-a', { ...beatFile, range: { start: 0, end: 18 } }), 'transfer')
  })

  it('continues from the last full AI result without re-export, while protecting manual edits', async () => {
    const first = standalone()
    const chart = applyAiPlan(empty(), 'chart-a', await prepareAiImport(empty(), 'chart-a', first))
    const input = { ...standalone(chart), requestId: 'batch-2',
      target: { afterRequestId: first.requestId, notesRevision: await aiNotesRevision(first.notes) }, notes: [tap('a', 2000, 2)] }
    const plan = await prepareAiImport(chart, 'chart-a', input)
    const next = applyAiPlan(chart, 'chart-a', plan)
    expect(next.notes).toEqual(input.notes)
    expect(next.aiImportHistory).toEqual(['batch-1', 'batch-2'])
    await expectIssue(prepareAiImport({ ...chart, notes: [tap('a', 1001)] }, 'chart-a', input), 'stale')
    await expectIssue(prepareAiImport({ ...chart, bpm: 130 }, 'chart-a', input), 'timing')
    await expectIssue(prepareAiImport(empty(), 'chart-a', input), 'target')
    await expectIssue(prepareAiImport(next, 'chart-a', { ...input, requestId: 'batch-3' }), 'target')
    await expectIssue(prepareAiImport(chart, 'chart-a', { ...input, target: { ...input.target, chartId: 'chart-a' } }), 'schema')
    expect(() => applyAiPlan({ ...chart, notes: [tap('manual')] }, 'chart-a', plan)).toThrow(AiChartError)
    const restored = normalizeChart(JSON.parse(JSON.stringify(chart)))
    expect((await prepareAiImport(restored, 'chart-a', input)).next.notes).toEqual(input.notes)
    const renamed = { ...chart, title: 'New title', backgroundName: 'new.png' }
    expect(applyAiPlan(renamed, 'chart-a', await prepareAiImport(renamed, 'chart-a', input)).title).toBe('New title')
  })

  it('uses the same portable note digest as the continuation helper', async () => {
    // @ts-expect-error The standalone Node helper deliberately has no TS dependency.
    const { continuationTarget } = await import('../../ai-make-chart/continue-chart.mjs')
    const previous = { ...standalone(), notes: [tap('中', 1000.25), { ...tap('A', 1250, 1), kind: 'hold' as const, endTime: 1500 }, tap('z', 2000)] }
    const revision = await aiNotesRevision(previous.notes)
    expect(continuationTarget(previous)).toEqual({ afterRequestId: previous.requestId, notesRevision: revision })
    expect(await aiNotesRevision([...previous.notes].reverse())).toBe(revision)
    expect(() => continuationTarget({ ...previous, mode: 'segment' })).toThrow()
    expect(() => continuationTarget({ ...previous, unit: 'beat' })).toThrow()
  })

  it('imports standalone beat coordinates across BPM changes without adding offset twice', async () => {
    const chart = empty()
    const input = { ...standalone(chart), unit: 'beat', song: { ...song(chart), bpmChanges: [{ time: 2000, bpm: 240 }] }, notes: [
      { id: 'tap', kind: 'note', lane: 0, beat: 0 },
      { id: 'hold', kind: 'hold', lane: 2, beat: 1, endBeat: 4 },
    ] }
    const plan = await prepareAiImport(chart, 'chart-a', input)
    expect(plan.next.notes).toEqual([tap('tap'), { id: 'hold', kind: 'hold', lane: 2, time: 1500, endTime: 2500 }])
    expect(plan.next.bpmChanges).toEqual([{ time: 2000, bpm: 240 }])
    expect(chart.notes).toEqual([])
  })

  it('accepts negative beats that map to valid audio times', async () => {
    const input = { ...standalone(), unit: 'beat', notes: [{ id: 'pickup', lane: 1, kind: 'note', beat: -1 }] }
    expect((await prepareAiImport(empty(), 'chart-a', input)).next.notes[0].time).toBe(500)
    await expectIssue(prepareAiImport(empty(), 'chart-a', { ...input, notes: [{ ...input.notes[0], beat: -3 }] }), 'bounds')
  })

  it('preserves crossing holds and out-of-range notes when replacing a half-open segment', async () => {
    const chart = normalizeChart({ ...empty(), notes: [
      { id: 'enter', kind: 'hold', lane: 0, time: 500, endTime: 1500 },
      tap('replace', 1500, 1),
      { id: 'exit', kind: 'hold', lane: 2, time: 1900, endTime: 2500 },
      tap('at-end', 2000, 3),
    ] })
    const input = { ...standalone(chart), target: await target(chart), mode: 'segment', range: { start: 1000, end: 2000 }, notes: [tap('new', 1700, 1)] }
    const plan = await prepareAiImport(chart, 'chart-a', input)
    expect(plan.next.notes.map((note) => note.id)).toEqual(['enter', 'new', 'exit', 'at-end'])
    expect(plan.summary).toEqual({ added: 1, updated: 0, deleted: 1, holds: 2 })
    await expectIssue(prepareAiImport(chart, 'chart-a', { ...input, notes: [tap('bad', 1200, 0)] }), 'collision')
    await expectIssue(prepareAiImport(chart, 'chart-a', { ...input, notes: [tap('bad', 2000, 1)] }), 'range')
  })

  it('atomically adds, updates and deletes by ID and restores request history on undo', async () => {
    const chart = normalizeChart({ ...empty(), notes: [tap('a'), tap('b', 1500, 1)] })
    const input = { ...standalone(chart), notes: undefined, target: await target(chart), mode: 'patch', range: { start: 0, end: 3000 }, operations: [
      { op: 'delete', id: 'a' },
      { op: 'update', note: { id: 'b', lane: 2, kind: 'hold', time: 1500, endTime: 2000 } },
      { op: 'add', note: tap('c', 2000, 2) },
    ] }
    const plan = await prepareAiImport(chart, 'chart-a', input)
    const next = applyAiPlan(chart, 'chart-a', plan)
    expect(plan.summary).toEqual({ added: 1, updated: 1, deleted: 1, holds: 1 })
    expect(next.aiImportHistory).toEqual(['batch-1'])
    expect(restoreEdit(next, editSnapshot(chart))).toEqual(chart)
    await expectIssue(prepareAiImport(next, 'chart-a', input), 'replayed')
    await expectIssue(prepareAiImport(chart, 'chart-a', { ...input, operations: [...input.operations, { op: 'delete', id: 'b' }] }), 'duplicate')
    await expectIssue(prepareAiImport(chart, 'chart-a', { ...input, operations: [{ op: 'delete', id: 'missing' }] }), 'missing')
    expect(chart.notes).toEqual([tap('a'), tap('b', 1500, 1)])
  })

  it('rejects patch edits to either the old or new position outside the range', async () => {
    const chart = normalizeChart({ ...empty(), notes: [tap('a', 500)] })
    const input = { ...standalone(chart), notes: undefined, target: await target(chart), mode: 'patch', range: { start: 1000, end: 2000 }, operations: [{ op: 'update', note: tap('a', 1500) }] }
    await expectIssue(prepareAiImport(chart, 'chart-a', input), 'range')
    await expectIssue(prepareAiImport(chart, 'chart-a', { ...input, range: { start: 0, end: 1000 } }), 'range')
  })

  it('rejects stale/wrong targets and timing changes while ignoring zoom and playhead', async () => {
    const chart = empty()
    const input = { ...standalone(chart), target: await target(chart) }
    await expectIssue(prepareAiImport({ ...chart, notes: [tap('human')] }, 'chart-a', input), 'stale')
    await expectIssue(prepareAiImport(chart, 'other-chart', input), 'target')
    await expectIssue(prepareAiImport(chart, 'chart-a', { ...input, song: { ...input.song, offset: 0 } }), 'timing')
    expect(await aiChartRevision({ ...chart, settings: { editorZoom: 900 } })).toBe(input.target.revision)
    const plan = await prepareAiImport(chart, 'chart-a', input)
    expect(() => applyAiPlan({ ...chart, bpm: 130 }, 'chart-a', plan)).toThrow(AiChartError)
    expect(() => applyAiPlan(chart, 'other-chart', plan)).toThrow(AiChartError)
    expect(applyAiPlan({ ...chart, settings: { editorZoom: 900 } }, 'chart-a', plan).settings.editorZoom).toBe(900)
  })

  it('requires an empty chart for standalone imports and checks audio identity', async () => {
    const chart = empty()
    await expectIssue(prepareAiImport({ ...chart, notes: [tap()] }, 'chart-a', standalone(chart)), 'standalone')
    await expectIssue(prepareAiImport(chart, 'chart-a', { ...standalone(chart), mode: 'segment', range: { start: 0, end: 2000 } }), 'standalone')
    await expectIssue(prepareAiImport(chart, 'chart-a', { ...standalone(chart), song: { ...song(chart), audioName: 'different.wav' } }), 'audio')
    await expectIssue(prepareAiImport(chart, 'chart-a', { ...standalone(chart), song: { ...song(chart), duration: 9990 } }), 'audio')
  })

  it.each([
    [{ ...tap(), lane: 0.5 }, 'number'],
    [{ ...tap(), time: '1000' }, 'number'],
    [{ ...tap(), time: -1 }, 'bounds'],
    [{ ...tap(), time: 10000 }, 'range'],
    [{ ...tap(), time: Infinity }, 'number'],
    [{ ...tap(), id: '' }, 'id'],
    [{ ...tap(), kind: 'hold' }, 'hold'],
    [{ ...tap(), kind: 'hold', endTime: 1000 }, 'hold'],
    [{ ...tap(), kind: 'hold', endTime: 10001 }, 'bounds'],
    [{ ...tap(), endTime: 1200 }, 'hold'],
    [{ ...tap(), beat: 1 }, 'schema'],
  ])('rejects invalid note data without normalizing it: %j', async (note, code) => {
    await expectIssue(prepareAiImport(empty(), 'chart-a', { ...standalone(), notes: [note] }), code as string)
  })

  it('rejects duplicate IDs and same-lane overlap, but allows chords and notes at hold tails', async () => {
    await expectIssue(prepareAiImport(empty(), 'chart-a', { ...standalone(), notes: [tap(), tap()] }), 'duplicate')
    await expectIssue(prepareAiImport(empty(), 'chart-a', { ...standalone(), notes: [tap(), tap('b')] }), 'collision')
    await expectIssue(prepareAiImport(empty(), 'chart-a', { ...standalone(), notes: [{ ...tap(), kind: 'hold', endTime: 2000 }, tap('b', 1500)] }), 'collision')
    expect((await prepareAiImport(empty(), 'chart-a', { ...standalone(), notes: [{ ...tap(), kind: 'hold', endTime: 2000 }, tap('b', 2000), tap('c', 1000, 1)] })).next.notes).toHaveLength(3)
  })

  it('exports cursor/tempo and boundary context, with a valid segment template', async () => {
    const chart = normalizeChart({ ...empty(), notes: [{ id: 'cross', lane: 0, kind: 'hold', time: 500, endTime: 1500 }, tap('local', 1700, 2)] })
    const context = await createAiContext(chart, 'chart-a', 1500, 4, { start: 1000, end: 2000 }, false)
    expect(context.cursor).toEqual({ time: 1500, beat: 1, bpm: 120, subdivision: 4, isPlaying: false })
    expect(context.notes[0]).toMatchObject({ id: 'cross', editable: false })
    expect(context.notes[1]).toMatchObject({ id: 'local', editable: true })
    const plan = await prepareAiImport(chart, 'chart-a', context.outputTemplate)
    expect(plan.next.notes.map((note) => note.id)).toEqual(['cross'])
    expect(JSON.stringify(context)).not.toContain('audioPath')
  })

  it('limits and parses JSON, including UTF-8 BOM but excluding Markdown fences', () => {
    expect(parseAiJson('\uFEFF{"version":1}')).toEqual({ version: 1 })
    expect(() => parseAiJson('```json\n{}\n```')).toThrow(AiChartError)
    expect(() => parseAiJson(' '.repeat(AI_MAX_BYTES + 1))).toThrow(AiChartError)
    expect(() => parseAiJson('中'.repeat(Math.ceil(AI_MAX_BYTES / 3)))).toThrow(AiChartError)
    expect(normalizeChart({}).aiImportHistory).toEqual([])
  })

  it('imports the shipped standalone example', async () => {
    const input = JSON.parse(readFileSync('ai-make-chart/examples/standalone.json', 'utf8'))
    const chart = normalizeChart({ audioName: input.song.audioName, duration: input.song.duration })
    expect((await prepareAiImport(chart, 'example', input)).next.notes).toHaveLength(6)
  })

  it('rejects coerced modes and excessive batches', async () => {
    await expectIssue(prepareAiImport(empty(), 'chart-a', { ...standalone(), mode: ['replace'] }), 'schema')
    await expectIssue(prepareAiImport(empty(), 'chart-a', { ...standalone(), notes: Array(50001).fill(tap()) }), 'size')
  })
})
