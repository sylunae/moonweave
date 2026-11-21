import { createHash, randomUUID } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

// The baseline must be the complete, successfully applied result, never the new draft.
export function continuationTarget(previous) {
  if (previous.format !== 'moonweave-ai-chart' || previous.version !== 1 || previous.mode !== 'replace' || previous.unit !== 'ms'
    || typeof previous.requestId !== 'string' || !previous.requestId.trim() || previous.requestId.length > 128 || !Array.isArray(previous.notes)) {
    throw new Error('Baseline must be a complete Moonweave v1 replace result in ms, with a requestId and notes.')
  }
  const rows = previous.notes.map((n) => {
    if (typeof n.id !== 'string' || !['note', 'hold'].includes(n.kind) || !Number.isInteger(n.lane) || n.lane < 0 || n.lane > 3
      || !Number.isFinite(n.time) || (n.kind === 'hold' && (!Number.isFinite(n.endTime) || n.endTime <= n.time))) {
      throw new Error('Baseline contains invalid millisecond notes.')
    }
    return JSON.stringify([n.id, n.kind, n.lane, n.time, n.endTime ?? null, ...(n.red ? [true] : [])])
  }).sort()
  return { afterRequestId: previous.requestId, notesRevision: `sha256:${createHash('sha256').update(`[${rows.join(',')}]`).digest('hex')}` }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const [, , baselinePath, draftPath, outputPath] = process.argv
    if (!baselinePath || !draftPath || !outputPath) throw new Error('Usage: node continue-chart.mjs applied-full.json revised-draft.json new-result.json')
    const previous = JSON.parse(readFileSync(baselinePath, 'utf8').replace(/^\uFEFF/, ''))
    const draft = JSON.parse(readFileSync(draftPath, 'utf8').replace(/^\uFEFF/, ''))
    const result = { ...draft, target: continuationTarget(previous), song: previous.song, requestId: randomUUID() }
    // Never overwrite a baseline, draft, or existing result.
    writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`, { flag: 'wx' })
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
