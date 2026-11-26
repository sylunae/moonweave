import { describe, expect, it } from 'vitest'
import { strToU8, zipSync } from 'fflate'
import { createChartPackage, isChartPackageFile, readChartPackage } from '@/features/chart/chartPackage'
import { DEFAULT_CHART, normalizeChart } from '@/features/chart/types'
import { noteImportIssue, readNoteSource } from '@/features/chart/noteImport'

describe('Moonweave chart packages', () => {
  it('round-trips chart data and every managed asset', async () => {
    const chart = normalizeChart({
      ...DEFAULT_CHART, title: 'Packaged song', audioName: 'song.ogg', backgroundName: 'stage.webm', coverName: 'cover.webp',
      settings: { editorZoom: 340, editorLaneWidthPercent: 75 },
    })
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
    expect(restored.settings).toEqual({ editorZoom: 340, editorLaneWidthPercent: 75 })
    expect([...unpacked.assets.audio!.data]).toEqual([1, 2, 3])
    expect([...unpacked.assets.background!.data]).toEqual([4, 5])
    expect([...unpacked.assets.cover!.data]).toEqual([6, 7, 8])
  })

  it('defaults legacy charts to full lane width and clamps imported values', () => {
    expect(normalizeChart({ settings: { editorZoom: 340 } }).settings).toEqual({
      editorZoom: 340, editorLaneWidthPercent: 100,
    })
    expect(normalizeChart({ settings: { editorLaneWidthPercent: 0 } }).settings.editorLaneWidthPercent).toBe(50)
    expect(normalizeChart({ settings: { editorLaneWidthPercent: 140 } }).settings.editorLaneWidthPercent).toBe(100)
  })

  it('recognizes both chart package extensions regardless of case', () => {
    expect(['song.mwchart', 'song.zip', 'song.ZIP', 'song.json'].map(isChartPackageFile)).toEqual([true, true, true, false])
  })

  it('rejects ordinary ZIPs and packages with incomplete content', async () => {
    const chart = strToU8(JSON.stringify(DEFAULT_CHART))
    const manifest = strToU8(JSON.stringify({
      format: 'moonweave-chart', version: 1, chart: 'chart.json', assets: { audio: { path: 'assets/audio.ogg', name: 'song.ogg' } },
    }))
    await expect(readChartPackage(new Uint8Array([1, 2, 3]))).rejects.toThrow()
    await expect(readChartPackage(zipSync({ 'chart.json': chart }))).rejects.toThrow('无效的 Moonweave 谱面包')
    await expect(readChartPackage(zipSync({ 'manifest.json': manifest, 'chart.json': strToU8('{}') }))).rejects.toThrow('谱面文件格式无效')
    await expect(readChartPackage(zipSync({ 'manifest.json': manifest, 'chart.json': chart }))).rejects.toThrow('谱面包缺少 audio 资源')
  })

  it('reads active and inactive difficulty notes from native JSON and packages including media', async () => {
    const hold = { id: 'normal', time: 3000, endTime: 5000, lane: 1, kind: 'hold', red: true }
    const tap = { id: 'hard', time: 8000, lane: 3, kind: 'note' }
    const chart = normalizeChart({ library: { levels: [0, 4, 8, 0], tier: 2 }, notes: [tap], tracks: { 1: { notes: [hold] } } })
    const archive = await createChartPackage(chart, { audio: { data: new Uint8Array([1, 2, 3]), name: 'song.ogg' } })
    const files = [
      new File([JSON.stringify(chart)], 'chart.json'),
      new File([archive.slice().buffer], 'song.mwchart'),
      new File([archive.slice().buffer], 'song.ZIP', { type: 'application/zip' }),
    ]
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
