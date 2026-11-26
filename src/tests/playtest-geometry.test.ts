import { describe, expect, it } from 'vitest'
import {
  getPlaytestHorizon, getPlaytestLaneCenterPercent, getPlaytestLanePositionPercent,
  getPlaytestTrackHalfWidth, getPlaytestViewportGeometry, JUDGMENT_LINE_Y, resolvePlaytestTrackLayout, TOUCH_LANE_START_Y,
} from '@/features/playtest/playtestGeometry'

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

  it('forces vertical portrait and permits compact vertical landscape on desktop', () => {
    expect(resolvePlaytestTrackLayout(true, false, 'tilted')).toBe('portrait')
    expect(resolvePlaytestTrackLayout(false, false, 'vertical')).toBe('tilted')
    expect(resolvePlaytestTrackLayout(false, true, 'vertical')).toBe('compact')
    expect(resolvePlaytestTrackLayout(false, true, 'tilted')).toBe('tilted')
  })

  it('bounds desktop vertical width and scales travel time with height', () => {
    const short = getPlaytestViewportGeometry('compact', 0, 7, 1_200, 600)
    const tall = getPlaytestViewportGeometry('compact', 0, 7, 2_400, 900)
    expect(short.halfWidth * 1_200).toBeCloseTo(318)
    expect(tall.halfWidth * 2_400).toBeCloseTo(360)
    expect(tall.horizon / short.horizon).toBeCloseTo(1.5)
  })

  it('aligns projected touch lanes with the track in either orientation', () => {
    const landscape = getPlaytestViewportGeometry('tilted', 45, 7, 844, 390)
    const portrait = getPlaytestViewportGeometry('portrait', 0, 7, 390, 844)
    const landscapeEdge = (y: number) => getPlaytestLanePositionPercent(0, 45, y, landscape.halfWidth)
    const portraitEdge = (y: number) => getPlaytestLanePositionPercent(0, 0, y, portrait.halfWidth)
    expect(landscapeEdge(TOUCH_LANE_START_Y)).toBeGreaterThan(landscapeEdge(JUDGMENT_LINE_Y))
    expect(landscapeEdge(JUDGMENT_LINE_Y)).toBeGreaterThan(landscapeEdge(1))
    expect(landscapeEdge(1)).toBeGreaterThan(0)
    expect(portraitEdge(TOUCH_LANE_START_Y)).toBeCloseTo(6)
    expect(portraitEdge(1)).toBe(portraitEdge(TOUCH_LANE_START_Y))
  })
})
