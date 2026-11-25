import { readChartPackageMetadata } from './chartPackage'
import { libraryMetadata } from './libraryMetadata'
import { normalizeChart, type Chart, type ChartNote } from './types'

export const noteJsonLimit = 8 * 1024 * 1024
export const notePackageLimit = 128 * 1024 * 1024

export async function readNoteSource(file: File): Promise<Chart> {
  const packaged = /\.mwchart$/i.test(file.name)
  if (file.size > (packaged ? notePackageLimit : noteJsonLimit)) throw new RangeError('file size')
  const input = packaged
    ? await readChartPackageMetadata(new Uint8Array(await file.arrayBuffer()), noteJsonLimit)
    : JSON.parse(await file.text()) as unknown
  if (!input || typeof input !== 'object') throw new Error('chart')
  const raw = input as Partial<Chart> & { format?: unknown }
  if (raw.format !== undefined || (raw.version !== undefined && raw.version !== 1) || !Array.isArray(raw.notes)) throw new Error('chart')
  const chart = normalizeChart(raw)
  const meta = libraryMetadata(chart.library)
  if (chart.notes.length !== raw.notes.length) throw new Error('notes')
  for (const [tier, level] of meta.levels.entries()) {
    if (!level || tier === meta.tier || raw.tracks?.[tier] === undefined) continue
    const notes = raw.tracks[tier]?.notes
    if (!Array.isArray(notes) || chart.tracks?.[tier]?.notes.length !== notes.length) throw new Error('notes')
  }
  return chart
}

export function noteImportIssue(notes: ChartNote[], duration: number) {
  const ids = new Set<string>()
  for (const note of notes) {
    if (!note.id || ids.has(note.id)) return 'duplicate'
    if (note.time >= duration || (note.endTime ?? note.time) > duration) return 'duration'
    ids.add(note.id)
  }
  return null
}
