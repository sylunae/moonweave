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

  it('preserves the interpolated position through rate changes with coarse samples', () => {
    const clock = new PlaybackClock()
    clock.start(1000, 0)
    expect(clock.getTime(1000, 16)).toBe(1016)
    clock.setRate(1000, 16, 0.5)
    expect(clock.getTime(1000, 16)).toBe(1016)
    expect(clock.getTime(1000, 24)).toBe(1020)
    clock.setRate(1020, 24, 1)
    expect(clock.getTime(1020, 32)).toBe(1028)
    expect(clock.getTime(1020, 44)).toBe(1040)
    clock.setRate(1020, 44, 0.5)
    expect(clock.getTime(1020, 44)).toBe(1040)
    expect(clock.getTime(1020, 52)).toBe(1044)
  })

  it('does not keep the monotonic floor of an earlier playback after a backward seek', () => {
    const clock = new PlaybackClock()
    clock.start(10000, 0)
    expect(clock.getTime(10000, 16)).toBe(10016)
    expect(clock.getTime(2000, 32)).toBe(2000)
    expect(clock.getTime(2000, 40)).toBe(2008)
  })

  it('bounds interpolation when media stalls instead of accumulating seconds of offset', () => {
    const clock = new PlaybackClock()
    clock.start(1000, 0, 0.5)
    expect(clock.getTime(1000, 5000)).toBeLessThanOrEqual(1050)
    clock.stop(1000, 5000)
    expect(clock.getTime(1000, 9000)).toBe(1000)
    clock.start(1000, 9000, 0.5)
    expect(clock.getTime(1000, 9016)).toBe(1008)
  })

  it('anchors to actual media progress after repeated seeks instead of counting decoder startup delay', () => {
    const clock = new PlaybackClock()
    let now = 0
    for (const [target, delay, rate] of [[10000, 240, 1], [2000, 80, 0.5], [8000, 500, 0.75], [1000, 120, 1]]) {
      clock.start(target, now, rate, { waitForProgress: true })
      now += delay
      expect(clock.getTime(target, now)).toBe(target)
      now += 16
      const advanced = target + 16 * rate
      expect(clock.getTime(advanced, now)).toBe(advanced)
      expect(clock.getTime(advanced, now + 8)).toBeCloseTo(advanced + 8 * rate)
      now += 100
    }
  })
})
