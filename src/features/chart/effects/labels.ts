import { scrollSpeedMap, type ChartEffect } from './scrollSpeed'

export function effectLabel(event: ChartEffect, effects: ChartEffect[]) {
  const from = scrollSpeedMap(effects).speedBefore(event.time)
  const number = (value: number) => Number(value.toFixed(3))
  return event.transition === 'linear' ? `×${number(from)} → ×${event.multiplier}` : `×${event.multiplier}`
}
