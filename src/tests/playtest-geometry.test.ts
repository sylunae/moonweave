import { describe, expect, it } from 'vitest'
import { getPlaytestHorizon, getPlaytestLaneCenterPercent, getPlaytestTrackHalfWidth } from '@/features/playtest/playtestGeometry'

describe('playtest perspective compensation', () => {
  it('shortens the visible time horizon as the lane becomes vertical', () => {
    const vertical = getPlaytestHorizon(1_400, 7, 0)
    const tilted = getPlaytestHorizon(1_400, 7, 45)
    expect(vertical).toBeLessThan(tilted)
    expect(tilted).toBeCloseTo(1_400)
  })

  it('narrows the track and keeps lane centers symmetric as tilt decreases', () => {
    expect(getPlaytestTrackHalfWidth(0)).toBeCloseTo(0.62)
    expect(getPlaytestTrackHalfWidth(45)).toBeCloseTo(0.8)
    expect(getPlaytestLaneCenterPercent(0, 0)).toBeCloseTo(26.75)
    expect(getPlaytestLaneCenterPercent(3, 0)).toBeCloseTo(73.25)
  })

  it('clamps out-of-range tilt before deriving geometry', () => {
    expect(getPlaytestTrackHalfWidth(-10)).toBeCloseTo(getPlaytestTrackHalfWidth(0))
    expect(getPlaytestTrackHalfWidth(60)).toBeCloseTo(getPlaytestTrackHalfWidth(45))
  })
})
