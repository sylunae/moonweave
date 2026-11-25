import { normalizeEffects, type ChartEffect } from './effects/scrollSpeed'
import { emptyDifficultyTrack, libraryMetadata, managedLibraryMetadata, tiers, type DifficultyTrack } from './libraryMetadata'
import { currentText } from '../../app/currentText'

export type NoteKind = 'note' | 'hold'
export type ToolMode = NoteKind | 'delete' | 'region' | 'tempo' | 'effect'

export interface ChartNote {
  id: string
  lane: number
  time: number
  endTime?: number
  kind: NoteKind
  /** Omitted in legacy charts; red zones may overlap ordinary notes. */
  red?: boolean
}

export interface ChartSettings {
  editorZoom: number
  editorLaneWidthPercent?: number
}

export const EDITOR_LANE_WIDTH = { min: 50, max: 100, default: 100, step: 5 } as const

export interface BpmChange {
  time: number
  bpm: number
}

export interface Chart {
  library?: import('./libraryMetadata').LibraryMetadata
  tracks?: Record<number, import('./libraryMetadata').DifficultyTrack>
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
  effects: ChartEffect[]
  offset: number
  duration: number
  notes: ChartNote[]
  /** Recent AI batch IDs; restored together with notes when undoing. */
  aiImportHistory: string[]
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
  effects: [],
  offset: 0,
  duration: 120000,
  notes: [],
  aiImportHistory: [],
  settings: { editorZoom: 230, editorLaneWidthPercent: EDITOR_LANE_WIDTH.default },
}

export function normalizeChart(input: unknown): Chart {
  if (!input || typeof input !== 'object') throw new Error(currentText('谱面文件格式无效', 'Invalid chart file format'))
  const value = input as Partial<Chart>
  const notes = Array.isArray(value.notes) ? value.notes.filter((note): note is ChartNote => {
    if (!note || typeof note !== 'object') return false
    const candidate = note as Partial<ChartNote>
    return typeof candidate.id === 'string'
      && Number.isFinite(candidate.lane) && candidate.lane! >= 0 && candidate.lane! <= 3
      && Number.isFinite(candidate.time) && candidate.time! >= 0
      && (candidate.kind === 'note' || candidate.kind === 'hold')
      && (candidate.kind !== 'hold' || (Number.isFinite(candidate.endTime) && candidate.endTime! > candidate.time!))
  }).map((note) => {
    const { red, ...rest } = note
    return { ...rest, lane: Math.round(note.lane), ...(red === true ? { red: true } : {}) }
  }) : []
  const settings: Partial<ChartSettings> = value.settings && typeof value.settings === 'object' ? value.settings : {}
  const laneWidth = settings.editorLaneWidthPercent
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
    ...(value.library ? { library: libraryMetadata(value.library) } : {}),
    ...(value.tracks ? { tracks: Object.fromEntries(tiers.flatMap((_, i) => {
      const track = value.tracks?.[i]
      if (!track || typeof track !== 'object') return []
      const { notes, effects, aiImportHistory } = normalizeChart({ notes: track.notes, effects: track.effects, aiImportHistory: track.aiImportHistory })
      return [[i, { notes, effects, aiImportHistory } satisfies DifficultyTrack]]
    })) } : {}),
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
    effects: normalizeEffects(value.effects),
    offset: Number.isFinite(value.offset) ? value.offset! : 0,
    duration: Number.isFinite(value.duration) && value.duration! > 0 ? value.duration! : DEFAULT_CHART.duration,
    notes,
    aiImportHistory: Array.isArray(value.aiImportHistory) ? value.aiImportHistory.filter((id): id is string => typeof id === 'string' && id.length > 0 && id.length <= 128).slice(-200) : [],
    settings: {
      editorZoom: Number.isFinite(settings.editorZoom) ? Math.max(90, Math.min(1320, settings.editorZoom!)) : DEFAULT_CHART.settings.editorZoom,
      editorLaneWidthPercent: typeof laneWidth === 'number' && Number.isFinite(laneWidth)
        ? Math.max(EDITOR_LANE_WIDTH.min, Math.min(EDITOR_LANE_WIDTH.max, Math.round(laneWidth)))
        : EDITOR_LANE_WIDTH.default,
    },
  }
}

export function normalizeManagedChart(input: unknown): Chart {
  const chart = normalizeChart(input)
  const library = managedLibraryMetadata(chart.library)
  const tracks = Object.fromEntries(tiers.flatMap((_, tier) =>
    tier === library.tier ? [] : [[tier, chart.tracks?.[tier] ?? emptyDifficultyTrack()]]))
  return { ...chart, library, tracks }
}
