export const curvePresets = {
  linear: [0, 0, 1, 1],
  easeIn: [0.42, 0, 1, 1],
  easeOut: [0, 0, 0.58, 1],
  easeInOut: [0.42, 0, 0.58, 1],
} as const
export type CurveName = keyof typeof curvePresets | 'custom'
export type BezierPoints = [number, number, number, number]
export function validBezier(value: unknown): value is BezierPoints {
  return Array.isArray(value) && value.length === 4 && value.every((n) => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 1)
}
export function curvePoints(curve?: CurveName, custom?: BezierPoints): readonly number[] {
  return curve === 'custom' ? custom ?? curvePresets.easeInOut : curvePresets[curve ?? 'linear']
}
export const bezierCoordinate = (t: number, a: number, b: number) => 3 * (1 - t) ** 2 * t * a + 3 * (1 - t) * t * t * b + t ** 3
export function curveProgress(progress: number, points: readonly number[]) {
  if (progress <= 0) return 0
  if (progress >= 1) return 1
  let low = 0, high = 1
  for (let i = 0; i < 30; i++) {
    const mid = (low + high) / 2
    if (bezierCoordinate(mid, points[0], points[2]) < progress) low = mid
    else high = mid
  }
  return bezierCoordinate((low + high) / 2, points[1], points[3])
}
