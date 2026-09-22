export type NoteKind = 'note' | 'hold'
export type ToolMode = NoteKind | 'delete' | 'region' | 'paste'

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

export interface Chart {
  version: 1
  title: string
  artist: string
  audioPath: string
  audioName: string
  backgroundPath: string
  backgroundName: string
  backgroundType: 'image' | 'video' | ''
  bpm: number
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
  bpm: 120,
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
  return {
    ...DEFAULT_CHART, ...value, version: 1,
    title: typeof value.title === 'string' ? value.title : DEFAULT_CHART.title,
    artist: typeof value.artist === 'string' ? value.artist : '',
    audioPath: typeof value.audioPath === 'string' ? value.audioPath : '',
    audioName: typeof value.audioName === 'string' ? value.audioName : '',
    backgroundPath: typeof value.backgroundPath === 'string' ? value.backgroundPath : '',
    backgroundName: typeof value.backgroundName === 'string' ? value.backgroundName : '',
    backgroundType: value.backgroundType === 'image' || value.backgroundType === 'video' ? value.backgroundType : '',
    bpm: Number.isFinite(value.bpm) && value.bpm! >= 20 && value.bpm! <= 400 ? value.bpm! : DEFAULT_CHART.bpm,
    offset: Number.isFinite(value.offset) ? value.offset! : 0,
    duration: Number.isFinite(value.duration) && value.duration! > 0 ? value.duration! : DEFAULT_CHART.duration,
    notes,
    settings: {
      editorZoom: Number.isFinite(settings.editorZoom) ? Math.max(90, Math.min(1320, settings.editorZoom!)) : DEFAULT_CHART.settings.editorZoom,
    },
  }
}
