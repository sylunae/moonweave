import { describe, expect, it } from 'vitest'
import { dominantCoverColor } from '@/features/chart/coverColor'

describe('dominantCoverColor', () => {
  it('combines nearby shades and averages the most common color', () => {
    const pixels = new Uint8ClampedArray([
      224, 34, 45, 255,
      240, 46, 53, 255,
      16, 64, 160, 255,
    ])
    expect(dominantCoverColor(pixels)).toBe('rgb(232 40 49)')
  })

  it('ignores transparent pixels and supports monochrome covers', () => {
    const pixels = new Uint8ClampedArray([255, 0, 0, 0, 255, 0, 0, 127, 80, 80, 80, 255])
    expect(dominantCoverColor(pixels)).toBe('rgb(80 80 80)')
    expect(dominantCoverColor(pixels.slice(0, 8))).toBeNull()
  })
})
