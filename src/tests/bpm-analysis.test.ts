import { describe, expect, it } from 'vitest'
import { analyzeBpm, summarizeBpmWindows } from '@/features/chart/bpmAnalysis'

const sampleRate = 11025
function clicks(bpm: number, seconds = 55, offset = 0.137) {
  const samples = new Float32Array(Math.ceil(seconds * sampleRate))
  for (let time = offset; time < seconds; time += 60 / bpm) {
    const start = Math.round(time * sampleRate)
    for (let i = 0; i < 220 && start + i < samples.length; i++) samples[start + i] += Math.sin(i * 0.4) * Math.exp(-i / 35)
  }
  return samples
}

describe('lightweight BPM analysis', () => {
  it('uses cross-window agreement for musical audio with syncopated competing peaks', () => {
    // Window measurements from the reported MP3; no audio is bundled.
    expect(summarizeBpmWindows([
      { bpm: 125.0772, strength: 0.5282, clear: true },
      { bpm: 125.0567, strength: 0.2598, clear: false },
      { bpm: 125.1050, strength: 0.3390, clear: false },
    ])).toEqual({ bpm: 125.1, reliable: true })
  })
  it('does not accept conflicting or consistently weak observations as reliable', () => {
    expect(summarizeBpmWindows([
      { bpm: 110, strength: 0.5, clear: true },
      { bpm: 140, strength: 0.5, clear: true },
      { bpm: 170, strength: 0.5, clear: true },
    ])?.reliable).toBe(false)
    expect(summarizeBpmWindows(Array.from({ length: 3 }, () => ({ bpm: 125, strength: 0.19, clear: false })))?.reliable).toBe(false)
  })
  it.each([95, 120, 137.5, 160, 175])('estimates a steady %s BPM pulse with a nonzero offset', (bpm) => {
    const estimate = analyzeBpm([clicks(bpm)], sampleRate)
    expect(estimate?.bpm).toBeCloseTo(bpm, 0)
    expect(estimate?.reliable).toBe(true)
  })
  it('does not cancel opposite-phase stereo channels', () => {
    const left = clicks(140)
    const right = left.map((sample) => -sample)
    expect(analyzeBpm([left, right], sampleRate)?.bpm).toBeCloseTo(140, 0)
  })
  it('flags inconsistent tempo across the track', () => {
    const samples = new Float32Array(sampleRate * 90)
    samples.set(clicks(110, 30), 0)
    samples.set(clicks(140, 30), sampleRate * 30)
    samples.set(clicks(170, 30), sampleRate * 60)
    expect(analyzeBpm([samples], sampleRate)?.reliable).toBe(false)
  })
  it('rejects silence, sustained tones, short clips and invalid input', () => {
    expect(analyzeBpm([new Float32Array(sampleRate * 30)], sampleRate)).toBeNull()
    expect(analyzeBpm([new Float32Array(sampleRate * 30).fill(0.1)], sampleRate)).toBeNull()
    expect(analyzeBpm([clicks(120, 5)], sampleRate)).toBeNull()
    expect(analyzeBpm([], sampleRate)).toBeNull()
    expect(analyzeBpm([clicks(120)], 0)).toBeNull()
  })
})
