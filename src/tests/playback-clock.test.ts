import { describe, expect, it } from 'vitest'
import { PlaybackClock } from '@/features/playtest/PlaybackClock'

describe('PlaybackClock', () => {
  it('interpolates smoothly between coarse media clock updates', () => {
    const clock = new PlaybackClock()
    clock.start(1_000, 100)

    expect(clock.getTime(1_000, 108)).toBeCloseTo(1_008)
    expect(clock.getTime(1_000, 116)).toBeCloseTo(1_016)
    expect(clock.getTime(1_020, 120)).toBeGreaterThan(1_019)
  })

  it('soft-corrects drift without moving backwards', () => {
    const clock = new PlaybackClock()
    clock.start(0, 0)
    const beforeCorrection = clock.getTime(0, 20)
    const afterCorrection = clock.getTime(12, 21)

    expect(afterCorrection).toBeGreaterThanOrEqual(beforeCorrection)
    expect(afterCorrection).toBeLessThan(21)
  })

  it('hard-resyncs after a seek and stays fixed while stopped', () => {
    const clock = new PlaybackClock()
    clock.start(0, 0)

    expect(clock.getTime(2_000, 20)).toBe(2_000)
    clock.stop(2_050, 30)
    expect(clock.getTime(2_050, 500)).toBe(2_050)
  })
})
