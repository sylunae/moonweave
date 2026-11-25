import { describe, expect, it } from 'vitest'
import { createChartPackage, readChartPackage } from '@/features/chart/chartPackage'
import { DEFAULT_CHART, normalizeChart } from '@/features/chart/types'
import { noteImportIssue, readNoteSource } from '@/features/chart/noteImport'

describe('Moonweave chart packages', () => {
  it('round-trips chart data and every managed asset', async () => {
    const chart = normalizeChart({ ...DEFAULT_CHART, title: 'Packaged song', audioName: 'song.ogg', backgroundName: 'stage.webm', coverName: 'cover.webp' })
    const bytes = await createChartPackage(chart, {
      audio: { name: 'song.ogg', data: new Uint8Array([1, 2, 3]) },
      background: { name: 'stage.webm', data: new Uint8Array([4, 5]) },
      cover: { name: 'cover.webp', data: new Uint8Array([6, 7, 8]) },
    })
    const unpacked = await readChartPackage(bytes)
    const restored = normalizeChart(unpacked.chart)

    expect(restored.title).toBe('Packaged song')
    expect(restored.audioPath).toBe('assets/audio.ogg')
    expect(restored.backgroundPath).toBe('assets/background.webm')
    expect(restored.coverPath).toBe('assets/cover.webp')
    expect([...unpacked.assets.audio!.data]).toEqual([1, 2, 3])
    expect([...unpacked.assets.background!.data]).toEqual([4, 5])
    expect([...unpacked.assets.cover!.data]).toEqual([6, 7, 8])
  })

  it('rejects archives without a Moonweave manifest', async () => {
    await expect(readChartPackage(new Uint8Array([1, 2, 3]))).rejects.toThrow()
  })

  it('reads active and inactive difficulty notes from native JSON and packages including media', async () => {
    const hold = { id: 'normal', time: 3000, endTime: 5000, lane: 1, kind: 'hold', red: true }
    const tap = { id: 'hard', time: 8000, lane: 3, kind: 'note' }
    const chart = normalizeChart({ library: { levels: [0, 4, 8, 0], tier: 2 }, notes: [tap], tracks: { 1: { notes: [hold] } } })
    const archive = await createChartPackage(chart, { audio: { data: new Uint8Array([1, 2, 3]), name: 'song.ogg' } })
    const files = [new File([JSON.stringify(chart)], 'chart.json'), new File([archive.slice().buffer], 'song.mwchart')]
    for (const file of files) {
      const source = await readNoteSource(file)
      expect(source.notes).toEqual([tap])
      expect(source.tracks?.[1].notes).toEqual([hold])
      expect(noteImportIssue(source.tracks![1].notes, 4500)).toBe('duration')
      expect(noteImportIssue([...source.notes, ...source.notes], 10000)).toBe('duplicate')
    }
  })

  it('rejects malformed native notes and AI documents without silently dropping notes', async () => {
    for (const invalid of [{ format: 'moonweave-ai-chart', notes: [] }, { version: 1, notes: [{ kind: 'hold' }] }]) {
      await expect(readNoteSource(new File([JSON.stringify(invalid)], 'chart.json'))).rejects.toThrow()
    }
  })
})
