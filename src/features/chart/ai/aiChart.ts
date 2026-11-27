import type { BpmChange, Chart, ChartNote } from '../types'
import { beatAtTime, bpmAtTime, timeAtBeat } from '../tempoMap'

export const AI_FORMAT = 'moonweave-ai-chart'
export const AI_MAX_BYTES = 4 * 1024 * 1024
const MAX_ITEMS = 50_000
const MAX_ISSUES = 100
export type AiIssueCode = 'json' | 'size' | 'schema' | 'number' | 'id' | 'duplicate' | 'bounds' | 'hold' | 'collision' | 'target' | 'stale' | 'audio' | 'timing' | 'standalone' | 'range' | 'missing' | 'replayed' | 'transfer'
export interface AiIssue { code: AiIssueCode; path: string }
export class AiChartError extends Error {
  constructor(public issues: AiIssue[]) { super(issues.map((issue) => `${issue.path}: ${issue.code}`).join('\n')) }
}
type RecordValue = Record<string, unknown>
export interface AiRange { start: number; end: number }
export interface AiPlan {
  chartId: string
  base: string
  requestId: string
  mode: 'replace' | 'segment' | 'patch'
  range: AiRange
  next: Chart
  summary: { added: number; updated: number; deleted: number; holds: number }
}
const record = (value: unknown): value is RecordValue => !!value && typeof value === 'object' && !Array.isArray(value)
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)
const validId = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0 && value.length <= 128
const fail = (code: AiIssueCode, path: string): never => { throw new AiChartError([{ code, path }]) }
const keys = (value: RecordValue, allowed: string[], path: string) => {
  for (const key of Object.keys(value)) if (!allowed.includes(key)) fail('schema', `${path}.${key}`)
}
const sortNotes = (notes: ChartNote[]) => [...notes].sort((a, b) => a.time - b.time || a.lane - b.lane || a.id.localeCompare(b.id))

/** Excludes playhead, zoom and artwork; includes musical content and song identity. */
export function aiChartBase(chart: Chart) {
  return JSON.stringify({ title: chart.title, artist: chart.artist, audioName: chart.audioName, audioPath: chart.audioPath,
    duration: chart.duration, bpm: chart.bpm, offset: chart.offset, bpmChanges: chart.bpmChanges,
    notes: sortNotes(chart.notes).map((n) => [n.id, n.kind, n.lane, n.time, n.endTime ?? null, ...(n.red ? [true] : []),
      ...(n.animation || n.visualOnly || n.disabled ? [{ animation: n.animation, visualOnly: n.visualOnly, disabled: n.disabled }] : [])]),
    effects: chart.effects, aiImportHistory: chart.aiImportHistory })
}
export async function aiChartRevision(chart: Chart) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(aiChartBase(chart)))
  return `sha256:${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')}`
}
/** Portable baseline for continuing from a full AI result, without editor metadata. */
export async function aiNotesRevision(notes: ChartNote[]) {
  const rows = notes.map((n) => JSON.stringify([n.id, n.kind, n.lane, n.time, n.endTime ?? null, ...(n.red ? [true] : [])])).sort()
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`[${rows.join(',')}]`))
  return `sha256:${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')}`
}
export function parseAiJson(source: string): unknown {
  if (source.length > AI_MAX_BYTES || new TextEncoder().encode(source).length > AI_MAX_BYTES) fail('size', '$')
  try { return JSON.parse(source.replace(/^\uFEFF/, '')) }
  catch { return fail('json', '$') }
}
function readSong(value: unknown, chart: Chart) {
  if (!record(value)) return fail('schema', 'song')
  keys(value, ['audioName', 'duration', 'bpm', 'offset', 'bpmChanges'], 'song')
  if (typeof value.audioName !== 'string' || !value.audioName || !chart.audioName || value.audioName !== chart.audioName) fail('audio', 'song.audioName')
  if (!finite(value.duration) || value.duration <= 0 || Math.abs(value.duration - chart.duration) > 1) fail('audio', 'song.duration')
  if (!finite(value.bpm) || value.bpm < 20 || value.bpm > 400) return fail('number', 'song.bpm')
  if (!finite(value.offset) || Math.abs(value.offset) > chart.duration) return fail('number', 'song.offset')
  if (!Array.isArray(value.bpmChanges)) return fail('schema', 'song.bpmChanges')
  if (value.bpmChanges.length > MAX_ITEMS) return fail('size', 'song.bpmChanges')
  const bpmChanges: BpmChange[] = []
  for (const [index, item] of value.bpmChanges.entries()) {
    const path = `song.bpmChanges[${index}]`
    if (!record(item)) return fail('schema', path)
    keys(item, ['time', 'bpm'], path)
    if (!finite(item.time) || item.time < 0 || item.time >= chart.duration || !finite(item.bpm) || item.bpm < 20 || item.bpm > 400) return fail('number', path)
    if (index && item.time <= bpmChanges[index - 1].time) fail('timing', path)
    bpmChanges.push({ time: item.time, bpm: item.bpm })
  }
  return { bpm: value.bpm, offset: value.offset, bpmChanges }
}
const noteSame = (a: ChartNote, b: ChartNote) => a.id === b.id && a.kind === b.kind && a.lane === b.lane && a.time === b.time && a.endTime === b.endTime && Boolean(a.red) === Boolean(b.red)
function validateResult(notes: ChartNote[], duration: number) {
  const issues: AiIssue[] = []
  const ids = new Set<string>()
  const lanes: ChartNote[][] = Array.from({ length: 8 }, () => [])
  const add = (code: AiIssueCode, path: string) => { if (issues.length < MAX_ISSUES) issues.push({ code, path }) }
  for (const [index, note] of notes.entries()) {
    const path = `notes[${index}] (${note.id})`
    if (!validId(note.id)) add('id', path)
    if (ids.has(note.id)) add('duplicate', path)
    ids.add(note.id)
    if (!Number.isInteger(note.lane) || note.lane < 0 || note.lane > 3) { add('number', `${path}.lane`); continue }
    if (!finite(note.time) || note.time < 0 || note.time >= duration) add('bounds', `${path}.time`)
    if (note.kind !== 'note' && note.kind !== 'hold') add('schema', `${path}.kind`)
    if (note.kind === 'hold' && (!finite(note.endTime) || note.endTime <= note.time || note.endTime > duration)) add('hold', path)
    if (note.kind === 'note' && note.endTime !== undefined) add('hold', path)
    if (note.red !== undefined && typeof note.red !== 'boolean') add('schema', `${path}.red`)
    if (!note.visualOnly && !note.disabled) lanes[note.lane + (note.red ? 4 : 0)].push(note)
  }
  for (const lane of lanes) {
    lane.sort((a, b) => a.time - b.time)
    let previous: ChartNote | undefined
    for (const note of lane) {
      if (previous && (note.time === previous.time || note.time < (previous.endTime ?? previous.time))) add('collision', `${previous.id} / ${note.id}`)
      if (!previous || (note.endTime ?? note.time) >= (previous.endTime ?? previous.time)) previous = note
    }
  }
  if (issues.length) throw new AiChartError(issues)
}

export async function prepareAiImport(chart: Chart, chartId: string, input: unknown): Promise<AiPlan> {
  if (!record(input)) return fail('schema', '$')
  keys(input, ['format', 'version', 'requestId', 'mode', 'unit', 'song', 'target', 'range', 'notes', 'operations'], '$')
  if (input.format !== AI_FORMAT || input.version !== 1 || (input.mode !== 'replace' && input.mode !== 'segment' && input.mode !== 'patch') || (input.unit !== 'ms' && input.unit !== 'beat')) fail('schema', '$')
  if (!validId(input.requestId)) return fail('id', 'requestId')
  if (chart.aiImportHistory.includes(input.requestId)) fail('replayed', 'requestId')
  const mode = input.mode as AiPlan['mode']
  const timing = readSong(input.song, chart)
  const base = aiChartBase(chart)
  if (input.target !== undefined) {
    if (!record(input.target)) return fail('target', 'target')
    if ('afterRequestId' in input.target) {
      keys(input.target, ['afterRequestId', 'notesRevision'], 'target')
      if (!validId(input.target.afterRequestId) || chart.aiImportHistory.at(-1) !== input.target.afterRequestId) fail('target', 'target.afterRequestId')
      if (input.target.notesRevision !== await aiNotesRevision(chart.notes)) fail('stale', 'target.notesRevision')
    } else {
      keys(input.target, ['chartId', 'revision'], 'target')
      if (input.target.chartId !== chartId) fail('target', 'target.chartId')
      if (input.target.revision !== await aiChartRevision(chart)) fail('stale', 'target.revision')
    }
    if (timing.bpm !== chart.bpm || timing.offset !== chart.offset || JSON.stringify(timing.bpmChanges) !== JSON.stringify(chart.bpmChanges)) fail('timing', 'song')
  } else if (mode !== 'replace' || chart.notes.length || chart.effects.length || chart.bpmChanges.length) fail('standalone', 'target')
  const source: Chart = input.target === undefined ? { ...chart, ...timing } : chart
  const toTime = (value: unknown, path: string) => {
    if (!finite(value)) return fail('number', path)
    // Never use the editor's default clamping: invalid AI coordinates must remain errors.
    const time = input.unit === 'beat' ? timeAtBeat(source, value, -Number.MAX_VALUE, Number.MAX_VALUE) : value
    if (!finite(time) || time < 0 || time > chart.duration) return fail('bounds', path)
    return time
  }
  let range: AiRange = { start: 0, end: chart.duration }
  if (mode !== 'replace') {
    if (!record(input.range)) return fail('range', 'range')
    keys(input.range, ['start', 'end'], 'range')
    range = { start: toTime(input.range.start, 'range.start'), end: toTime(input.range.end, 'range.end') }
    if (range.end <= range.start) fail('range', 'range')
  } else if (input.range !== undefined) fail('schema', 'range')
  const inRange = (note: ChartNote) => note.time >= range.start && note.time < range.end && (note.endTime ?? note.time) <= range.end
  const readNote = (value: unknown, path: string): ChartNote => {
    if (!record(value)) return fail('schema', path)
    const startKey = input.unit === 'beat' ? 'beat' : 'time'
    const endKey = input.unit === 'beat' ? 'endBeat' : 'endTime'
    keys(value, ['id', 'kind', 'lane', 'red', startKey, endKey], path)
    if (!validId(value.id)) return fail('id', `${path}.id`)
    if (!finite(value.lane) || !Number.isInteger(value.lane) || value.lane < 0 || value.lane > 3) return fail('number', `${path}.lane`)
    if (value.kind !== 'note' && value.kind !== 'hold') return fail('schema', `${path}.kind`)
    const note: ChartNote = { id: value.id, kind: value.kind, lane: value.lane, time: toTime(value[startKey], `${path}.${startKey}`) }
    if (value.red !== undefined && typeof value.red !== 'boolean') fail('schema', `${path}.red`)
    if (value.red === true) note.red = true
    if (value.kind === 'hold') {
      if (value[endKey] === undefined) fail('hold', `${path}.${endKey}`)
      note.endTime = toTime(value[endKey], `${path}.${endKey}`)
      if (note.endTime <= note.time) fail('hold', path)
    } else if (value[endKey] !== undefined) fail('hold', path)
    if (note.time >= chart.duration || !inRange(note)) fail('range', path)
    return note
  }
  let notes: ChartNote[]
  if (mode === 'patch') {
    if (input.notes !== undefined || !Array.isArray(input.operations)) return fail('schema', 'operations')
    if (input.operations.length > MAX_ITEMS) return fail('size', 'operations')
    const byId = new Map(chart.notes.map((note) => [note.id, note]))
    if (byId.size !== chart.notes.length) fail('duplicate', 'notes')
    const touched = new Set<string>()
    for (const [index, op] of input.operations.entries()) {
      const path = `operations[${index}]`
      if (!record(op)) return fail('schema', path)
      keys(op, op.op === 'delete' ? ['op', 'id'] : ['op', 'note'], path)
      if (op.op !== 'add' && op.op !== 'update' && op.op !== 'delete') fail('schema', `${path}.op`)
      const note = op.op === 'delete' ? undefined : readNote(op.note, `${path}.note`)
      const id = note?.id ?? op.id
      if (!validId(id)) return fail('id', `${path}.id`)
      if (touched.has(id)) fail('duplicate', path)
      touched.add(id)
      const existing = byId.get(id)
      if (op.op === 'add' ? !!existing : !existing) fail(op.op === 'add' ? 'duplicate' : 'missing', path)
      if (existing && !inRange(existing)) fail('range', path)
      if (op.op === 'delete') byId.delete(id)
      else byId.set(id, { ...note!, ...(existing?.animation && { animation: existing.animation }),
        ...(existing?.visualOnly && { visualOnly: true }), ...(existing?.disabled && { disabled: true }) })
    }
    notes = [...byId.values()]
  } else {
    if (input.operations !== undefined || !Array.isArray(input.notes)) return fail('schema', 'notes')
    if (input.notes.length > MAX_ITEMS) return fail('size', 'notes')
    const incoming = input.notes.map((note, index) => readNote(note, `notes[${index}]`))
    // Boundary-crossing holds are preserved, even if their head is inside this segment.
    notes = mode === 'replace' ? incoming : [...chart.notes.filter((note) => !inRange(note)), ...incoming]
  }
  if (notes.length > MAX_ITEMS) fail('size', 'notes')
  validateResult(notes, chart.duration)
  notes = sortNotes(notes)
  const oldById = new Map(chart.notes.map((note) => [note.id, note]))
  const nextIds = new Set(notes.map((note) => note.id))
  return { chartId, base, requestId: input.requestId, mode, range,
    next: { ...source, notes, aiImportHistory: [...chart.aiImportHistory, input.requestId].slice(-200) },
    summary: {
      added: notes.filter((note) => !oldById.has(note.id)).length,
      updated: notes.filter((note) => { const old = oldById.get(note.id); return old && !noteSame(old, note) }).length,
      deleted: chart.notes.filter((note) => !nextIds.has(note.id)).length,
      holds: notes.filter((note) => note.kind === 'hold').length,
    },
  }
}

export function applyAiPlan(chart: Chart, chartId: string, plan: AiPlan): Chart {
  if (chartId !== plan.chartId) return fail('target', 'target.chartId')
  if (aiChartBase(chart) !== plan.base) return fail('stale', 'target.revision')
  // Preserve UI settings and unrelated metadata changed after preview.
  return { ...chart, notes: plan.next.notes, bpm: plan.next.bpm, offset: plan.next.offset,
    bpmChanges: plan.next.bpmChanges, aiImportHistory: plan.next.aiImportHistory }
}

/** Explicit full-chart reuse: source media/identity are irrelevant to this destination. */
export async function prepareChartTransfer(chart: Chart, chartId: string, input: unknown): Promise<AiPlan> {
  if (!record(input) || input.version !== 1) return fail('schema', '$')
  const legacy = input.format === AI_FORMAT
  if (legacy ? input.mode !== 'replace' && input.mode !== 'segment' : input.format !== undefined) return fail('transfer', 'mode')
  const song = legacy ? input.song : input
  if (!record(song)) return fail('schema', 'song')
  if (!finite(song.duration) || song.duration <= 0) return fail('number', 'song.duration')
  const requestId = crypto.randomUUID()
  const audioName = chart.audioName || 'chart-transfer'
  if (legacy && input.mode === 'segment') {
    if (!record(input.range) || !finite(input.range.start) || !finite(input.range.end)) return fail('range', 'range')
    keys(input.range, ['start', 'end'], 'range')
    // Older exports label even the entire song as a segment. Coverage is measured
    // against the SOURCE song, not the destination's possibly different duration.
    const original = { ...chart, audioName, duration: song.duration }
    const timing = readSong({ ...song, audioName }, original)
    const tempo = { ...original, ...timing }
    const toMs = (value: number) => input.unit === 'beat' ? timeAtBeat(tempo, value, -Number.MAX_VALUE, Number.MAX_VALUE) : value
    if (Math.abs(toMs(input.range.start)) > 0.000001 || Math.abs(toMs(input.range.end) - song.duration) > 0.000001) return fail('transfer', 'range')
  }
  // Reuse the strict coordinate, tempo and collision validator against destination bounds.
  // A disposable empty baseline avoids binding the source's target or media to this chart.
  const baseline: Chart = { ...chart, audioName, notes: [], effects: [], bpmChanges: [], aiImportHistory: [] }
  const plan = await prepareAiImport(baseline, chartId, {
    ...(legacy ? input : {}),
    format: AI_FORMAT, version: 1, requestId, mode: 'replace',
    unit: legacy ? input.unit : 'ms', target: undefined,
    ...(legacy && input.mode === 'segment' ? { range: undefined } : {}),
    song: { audioName, duration: chart.duration, bpm: song.bpm, offset: song.offset, bpmChanges: song.bpmChanges },
    notes: input.notes,
  })
  const previous = new Map(chart.notes.map((note) => [note.id, note]))
  const incoming = new Set(plan.next.notes.map((note) => note.id))
  return { ...plan, base: aiChartBase(chart),
    next: { ...chart, notes: plan.next.notes, bpm: plan.next.bpm, offset: plan.next.offset, bpmChanges: plan.next.bpmChanges,
      aiImportHistory: [...chart.aiImportHistory, requestId].slice(-200) },
    summary: { ...plan.summary,
      added: plan.next.notes.filter((note) => !previous.has(note.id)).length,
      updated: plan.next.notes.filter((note) => { const old = previous.get(note.id); return old && !noteSame(old, note) }).length,
      deleted: chart.notes.filter((note) => !incoming.has(note.id)).length,
    },
  }
}

export async function createAiContext(chart: Chart, chartId: string, currentTime: number, subdivision: number, range: AiRange, isPlaying: boolean) {
  if (!finite(range.start) || !finite(range.end) || range.start < 0 || range.end > chart.duration || range.end <= range.start) return fail('range', 'range')
  const target = { chartId, revision: await aiChartRevision(chart) }
  const song = { audioName: chart.audioName, duration: chart.duration, bpm: chart.bpm, offset: chart.offset, bpmChanges: chart.bpmChanges }
  const from = timeAtBeat(chart, beatAtTime(chart, range.start) - 4)
  const to = timeAtBeat(chart, beatAtTime(chart, range.end) + 4)
  const nearby = sortNotes(chart.notes).filter((note) => note.time <= to && (note.endTime ?? note.time) >= from)
  const notes = nearby.slice(0, 5000).map((note) => ({ ...note, beat: beatAtTime(chart, note.time),
    ...(note.endTime === undefined ? {} : { endBeat: beatAtTime(chart, note.endTime) }),
    editable: note.time >= range.start && note.time < range.end && (note.endTime ?? note.time) <= range.end }))
  return {
    format: 'moonweave-ai-context', version: 1, target, title: chart.title, artist: chart.artist, song,
    conventions: { timeUnit: 'ms', beatUnit: 'quarter-note', beatZeroAtMs: chart.offset, lanesLeftToRight: [0, 1, 2, 3],
      range: '[start,end); hold endpoints must be inside; crossing holds are read-only', audioIdentity: 'filename-and-duration; use the identical original WAV',
      bpmChangeTimeUnit: 'ms, even when output unit is beat' },
    cursor: { time: currentTime, beat: beatAtTime(chart, currentTime), bpm: bpmAtTime(chart, currentTime), subdivision, isPlaying },
    range: { ...range, startBeat: beatAtTime(chart, range.start), endBeat: beatAtTime(chart, range.end) },
    notes, notesTruncated: nearby.length > notes.length, totalNearbyNotes: nearby.length,
    outputTemplate: { format: AI_FORMAT, version: 1, requestId: crypto.randomUUID(), mode: 'segment', unit: 'ms', target, song, range, notes: [] },
  }
}
