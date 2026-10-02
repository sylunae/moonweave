import { describe, expect, it } from 'vitest'
import { createChartPackage, readChartPackage } from '@/features/chart/chartPackage'
import { DEFAULT_CHART, normalizeChart } from '@/features/chart/types'

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
})
