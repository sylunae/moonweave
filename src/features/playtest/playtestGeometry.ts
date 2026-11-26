const MAX_LANE_TILT = 45
export const TRACK_TOP_SCALE_RANGE = 0.82
export const JUDGMENT_LINE_Y = 0.86
export const TOUCH_LANE_START_Y = 0.56
export const PLAYTEST_HORIZON_MS = 1_400
const VERTICAL_TRACK_HALF_WIDTH = 0.62
const TILTED_TRACK_HALF_WIDTH = 0.80
export type PlaytestTrackLayout = 'tilted' | 'portrait' | 'compact'

export function resolvePlaytestTrackLayout(portrait: boolean, canChoose: boolean, trackMode: 'tilted' | 'vertical') {
  if (portrait) return 'portrait'
  return canChoose && trackMode === 'vertical' ? 'compact' : 'tilted'
}

export function normalizeLaneTilt(laneTilt: number) {
  return Math.min(1, Math.max(0, laneTilt / MAX_LANE_TILT))
}

function judgmentLineSpeedScale(normalizedTilt: number) {
  const topScale = 1 - normalizedTilt * TRACK_TOP_SCALE_RANGE
  if (normalizedTilt < 0.0001) return 1
  return -Math.log(topScale) / (1 - topScale)
}

export function getPlaytestHorizon(baseHorizon: number, scrollSpeed: number, laneTilt: number) {
  const tilt = normalizeLaneTilt(laneTilt)
  const currentSpeedScale = judgmentLineSpeedScale(tilt)
  const referenceSpeedScale = judgmentLineSpeedScale(1)
  return baseHorizon * (7 / Math.max(4, scrollSpeed)) * currentSpeedScale / referenceSpeedScale
}

export function getPlaytestTrackHalfWidth(laneTilt: number) {
  const tilt = normalizeLaneTilt(laneTilt)
  return VERTICAL_TRACK_HALF_WIDTH + (TILTED_TRACK_HALF_WIDTH - VERTICAL_TRACK_HALF_WIDTH) * tilt
}

export function getPlaytestTrackScale(laneTilt: number, screenY: number) {
  const topScale = 1 - normalizeLaneTilt(laneTilt) * TRACK_TOP_SCALE_RANGE
  return topScale + (1 - topScale) * screenY / JUDGMENT_LINE_Y
}

export function getPlaytestLanePositionPercent(lane: number, laneTilt: number, screenY: number, halfWidth: number) {
  return 50 + (lane / 2 - 1) * halfWidth * getPlaytestTrackScale(laneTilt, screenY) * 50
}

export function getPlaytestLaneCenterPercent(lane: number, laneTilt: number, halfWidth = getPlaytestTrackHalfWidth(laneTilt)) {
  return getPlaytestLanePositionPercent(lane + 0.5, laneTilt, JUDGMENT_LINE_Y, halfWidth)
}

export function getPlaytestViewportGeometry(
  layout: PlaytestTrackLayout, laneTilt: number, scrollSpeed: number, width: number, height: number,
) {
  const horizon = getPlaytestHorizon(PLAYTEST_HORIZON_MS, scrollSpeed, laneTilt)
  if (layout === 'tilted') {
    return { halfWidth: Math.min(getPlaytestTrackHalfWidth(laneTilt), height * 1.5 / width), horizon }
  }
  const halfWidth = layout === 'portrait' ? 0.88 : Math.min(0.72, 360 / width, height * 0.53 / width)
  // Scale travel time with the visible distance to keep linear fall speed
  // comparable across different window heights.
  return { halfWidth, horizon: horizon * Math.min(1.6, Math.max(0.65, height / 600)) }
}
