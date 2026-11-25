import type { Chart } from './types'

export const tiers = ['EASY', 'NORMAL', 'HARD', 'EXPERT'] as const
export type Visibility = 'draft' | 'private' | 'published'
export interface LibraryMetadata {
  charter: string
  description: string
  tags: string[]
  status: Visibility
  levels: number[]
  tier: number
  hue: number
}

export function libraryMetadata(input: unknown): LibraryMetadata {
  const value = (input && typeof input === 'object' ? input : {}) as Partial<LibraryMetadata>
  const levels = tiers.map((_, i) => Math.max(0, Math.min(20, Math.round(Number(value.levels?.[i]) || 0))))
  if (!levels.some(Boolean)) levels[1] = 1
  const tier = Number(value.tier)
  return {
    charter: typeof value.charter === 'string' ? value.charter : '',
    description: typeof value.description === 'string' ? value.description : '',
    tags: Array.isArray(value.tags) ? value.tags.filter((v): v is string => typeof v === 'string').slice(0, 32) : [],
    status: value.status === 'published' || value.status === 'private' ? value.status : 'draft',
    levels, tier: Number.isInteger(tier) && levels[tier] ? tier : levels.findIndex(Boolean),
    hue: Number.isFinite(value.hue) ? Number(value.hue) : 190,
  }
}

export function totalNotes(notes: unknown, tracks: unknown, levels: number[], active: number) {
  const maps = tracks as Record<number, Partial<DifficultyTrack>> | null
  return levels.reduce((sum, level, i) => {
    const lane = i === active ? notes : maps?.[i]?.notes
    return sum + (level && Array.isArray(lane) ? lane.length : 0)
  }, 0)
}

export type DifficultyTrack = Pick<Chart, 'notes' | 'effects' | 'aiImportHistory'>
export function chooseDifficulty(chart: Chart, tier: number): Chart {
  const meta = libraryMetadata(chart.library)
  if (tier === meta.tier || !meta.levels[tier]) return chart
  const tracks = { ...chart.tracks, [meta.tier]: { notes: chart.notes, effects: chart.effects, aiImportHistory: chart.aiImportHistory } }
  const track = tracks[tier] ?? { notes: [], effects: [], aiImportHistory: [] }
  delete tracks[tier]
  return { ...chart, ...track, tracks, library: { ...meta, tier } }
}
