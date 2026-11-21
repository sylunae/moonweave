const MAX_LANE_TILT = 45
export const TRACK_TOP_SCALE_RANGE = 0.82
export const JUDGMENT_LINE_Y = 0.86
const VERTICAL_TRACK_HALF_WIDTH = 0.62
const TILTED_TRACK_HALF_WIDTH = 0.80

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

export function getPlaytestTrackInsetPercent(laneTilt: number, screenY: number) {
  const topScale = 1 - normalizeLaneTilt(laneTilt) * TRACK_TOP_SCALE_RANGE
  const scale = topScale + (1 - topScale) * screenY / JUDGMENT_LINE_Y
  return (1 - getPlaytestTrackHalfWidth(laneTilt) * scale) * 50
}

export function getPlaytestLaneCenterPercent(lane: number, laneTilt: number) {
  const lanePosition = (lane + 0.5) / 4
  return 50 + (lanePosition * 2 - 1) * getPlaytestTrackHalfWidth(laneTilt) * 50
}
