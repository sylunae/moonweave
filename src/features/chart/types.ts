export type NoteKind = 'note' | 'hold'
export type ToolMode = NoteKind | 'delete' | 'region' | 'tempo'

export interface ChartNote {
  id: string
  lane: number
  time: number
  endTime?: number
  kind: NoteKind
}

export interface ChartSettings {
  editorZoom: number
}

export interface BpmChange {
  time: number
  bpm: number
}

export interface Chart {
  version: 1
  title: string
  artist: string
  audioPath: string
  audioName: string
  backgroundPath: string
  backgroundName: string
  backgroundType: 'image' | 'video' | ''
  backgroundVideoStartTime: number
  coverPath: string
  coverName: string
  bpm: number
  bpmChanges: BpmChange[]
  offset: number
  duration: number
  notes: ChartNote[]
  settings: ChartSettings
}

export const DEFAULT_CHART: Chart = {
  version: 1,
  title: 'Untitled constellation',
  artist: '',
  audioPath: '',
  audioName: '',
  backgroundPath: '',
  backgroundName: '',
  backgroundType: '',
  backgroundVideoStartTime: 0,
  coverPath: '',
  coverName: '',
  bpm: 120,
  bpmChanges: [],
  offset: 0,
  duration: 120000,
  notes: [],
  settings: { editorZoom: 230 },
}

export function normalizeChart(input: unknown): Chart {
  if (!input || typeof input !== 'object') throw new Error('谱面文件格式无效')
  const value = input as Partial<Chart>
  const notes = Array.isArray(value.notes) ? value.notes.filter((note): note is ChartNote => {
    if (!note || typeof note !== 'object') return false
    const candidate = note as Partial<ChartNote>
    return typeof candidate.id === 'string'
      && Number.isFinite(candidate.lane) && candidate.lane! >= 0 && candidate.lane! <= 3
      && Number.isFinite(candidate.time) && candidate.time! >= 0
      && (candidate.kind === 'note' || candidate.kind === 'hold')
      && (candidate.kind !== 'hold' || (Number.isFinite(candidate.endTime) && candidate.endTime! > candidate.time!))
  }).map((note) => ({ ...note, lane: Math.round(note.lane) })) : []
  const settings: Partial<ChartSettings> = value.settings && typeof value.settings === 'object' ? value.settings : {}
  const bpmChanges = Array.isArray(value.bpmChanges)
    ? [...new Map(value.bpmChanges.flatMap((change) => {
      if (!change || typeof change !== 'object') return []
      const candidate = change as Partial<BpmChange>
      if (!Number.isFinite(candidate.time) || candidate.time! < 0 || !Number.isFinite(candidate.bpm) || candidate.bpm! < 20 || candidate.bpm! > 400) return []
      const normalized: BpmChange = { time: candidate.time!, bpm: candidate.bpm! }
      return [[normalized.time, normalized] as const]
    })).values()].sort((a, b) => a.time - b.time)
    : []
  return {
    ...DEFAULT_CHART, ...value, version: 1,
    title: typeof value.title === 'string' ? value.title : DEFAULT_CHART.title,
    artist: typeof value.artist === 'string' ? value.artist : '',
    audioPath: typeof value.audioPath === 'string' ? value.audioPath : '',
    audioName: typeof value.audioName === 'string' ? value.audioName : '',
    backgroundPath: typeof value.backgroundPath === 'string' ? value.backgroundPath : '',
    backgroundName: typeof value.backgroundName === 'string' ? value.backgroundName : '',
    backgroundType: value.backgroundType === 'image' || value.backgroundType === 'video' ? value.backgroundType : '',
    backgroundVideoStartTime: Number.isFinite(value.backgroundVideoStartTime) ? value.backgroundVideoStartTime! : 0,
    coverPath: typeof value.coverPath === 'string' ? value.coverPath : '',
    coverName: typeof value.coverName === 'string' ? value.coverName : '',
    bpm: Number.isFinite(value.bpm) && value.bpm! >= 20 && value.bpm! <= 400 ? value.bpm! : DEFAULT_CHART.bpm,
    bpmChanges,
    offset: Number.isFinite(value.offset) ? value.offset! : 0,
    duration: Number.isFinite(value.duration) && value.duration! > 0 ? value.duration! : DEFAULT_CHART.duration,
    notes,
    settings: {
      editorZoom: Number.isFinite(settings.editorZoom) ? Math.max(90, Math.min(1320, settings.editorZoom!)) : DEFAULT_CHART.settings.editorZoom,
    },
  }
}
