import { describe, expect, it } from 'vitest'
import { normalizeChart } from '@/features/chart/types'

describe('chart background metadata', () => {
  it('keeps supported managed background metadata', () => {
    const chart = normalizeChart({ backgroundPath: 'chart-id.webm', backgroundName: 'sky.webm', backgroundType: 'video' })
    expect(chart.backgroundPath).toBe('chart-id.webm')
    expect(chart.backgroundName).toBe('sky.webm')
    expect(chart.backgroundType).toBe('video')
  })

  it('gives legacy charts safe background defaults', () => {
    const chart = normalizeChart({ backgroundType: 'animated' })
    expect(chart.backgroundPath).toBe('')
    expect(chart.backgroundName).toBe('')
    expect(chart.backgroundType).toBe('')
  })
})
