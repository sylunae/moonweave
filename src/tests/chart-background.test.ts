import { describe, expect, it } from 'vitest'
import { normalizeChart } from '@/features/chart/types'

describe('chart background metadata', () => {
  it('keeps supported managed background metadata', () => {
    const chart = normalizeChart({ backgroundPath: 'chart-id.webm', backgroundName: 'sky.webm', backgroundType: 'video', backgroundVideoStartTime: -12500, coverPath: 'chart-id.webp', coverName: 'cover.webp' })
    expect(chart.backgroundPath).toBe('chart-id.webm')
    expect(chart.backgroundName).toBe('sky.webm')
    expect(chart.backgroundType).toBe('video')
    expect(chart.backgroundVideoStartTime).toBe(-12500)
    expect(chart.coverPath).toBe('chart-id.webp')
    expect(chart.coverName).toBe('cover.webp')
  })

  it('gives legacy charts safe background defaults', () => {
    const chart = normalizeChart({ backgroundType: 'animated' })
    expect(chart.backgroundPath).toBe('')
    expect(chart.backgroundName).toBe('')
    expect(chart.backgroundType).toBe('')
    expect(chart.backgroundVideoStartTime).toBe(0)
    expect(chart.coverPath).toBe('')
    expect(chart.coverName).toBe('')
  })
})
