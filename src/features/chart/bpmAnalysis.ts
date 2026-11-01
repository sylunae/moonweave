export interface BpmEstimate {
  bpm: number
  reliable: boolean
}

const ENVELOPE_RATE = 200

/** Positive energy changes emphasize attacks rather than sustained loud notes. */
function estimateWindow(channels: Float32Array[], sampleRate: number, start: number, seconds: number) {
  const hop = Math.round(sampleRate / ENVELOPE_RATE)
  const rate = sampleRate / hop
  const count = Math.floor(seconds * sampleRate / hop)
  const onset = new Float32Array(count)
  let previousEnergy = 0
  let previousSample = 0
  for (let frame = 0; frame < count; frame++) {
    let energy = 0
    for (let j = 0; j < hop; j++) {
      const index = start + frame * hop + j
      // Average channel energies, avoiding cancellation of opposite-phase stereo.
      let power = 0
      for (const channel of channels) power += (channel[index] ?? 0) ** 2
      const sample = Math.sqrt(power / channels.length)
      const difference = sample - previousSample * 0.95
      energy += difference * difference
      previousSample = sample
    }
    energy = Math.sqrt(energy / hop)
    onset[frame] = Math.max(0, energy - previousEnergy)
    previousEnergy = energy
  }
  const mean = onset.reduce((sum, value) => sum + value, 0) / count
  let variance = 0
  for (let i = 0; i < count; i++) { onset[i] -= mean; variance += onset[i] ** 2 }
  if (variance < 1e-8) return null
  const minLag = Math.floor(rate * 60 / 200)
  const maxLag = Math.ceil(rate * 60 / 60)
  const scores = new Float32Array(maxLag + 2)
  for (let lag = minLag - 1; lag <= maxLag + 1; lag++) {
    let dot = 0, left = 0, right = 0
    for (let i = lag; i < count; i++) {
      dot += onset[i] * onset[i - lag]
      left += onset[i] ** 2; right += onset[i - lag] ** 2
    }
    scores[lag] = dot / Math.max(1e-12, Math.sqrt(left * right))
  }
  const peaks: { lag: number; score: number }[] = []
  for (let lag = minLag; lag <= maxLag; lag++) {
    if (scores[lag] >= scores[lag - 1] && scores[lag] > scores[lag + 1]) peaks.push({ lag, score: scores[lag] })
  }
  peaks.sort((a, b) => b.score - a.score)
  const best = peaks[0]
  if (!best || best.score < 0.18) return null
  const a = scores[best.lag - 1], b = scores[best.lag], c = scores[best.lag + 1]
  const correction = Math.max(-0.5, Math.min(0.5, (a - c) / (2 * (a - 2 * b + c) || 1)))
  let bpm = rate * 60 / (best.lag + correction)
  // Choose a conventional counting range; the dialog always offers half/double.
  while (bpm < 90) bpm *= 2
  while (bpm > 180) bpm /= 2
  const competing = peaks.find((peak) => {
    const ratio = peak.lag / best.lag
    return Math.abs(ratio - 0.5) > 0.04 && Math.abs(ratio - 2) > 0.08 && Math.abs(ratio - 1) > 0.04
  })
  return { bpm, strength: best.score, clear: best.score >= 0.3 && (!competing || competing.score < best.score * 0.85) }
}

export function summarizeBpmWindows(estimates: ({ bpm: number; strength: number; clear: boolean } | null)[]): BpmEstimate | null {
  const valid = estimates.filter((value) => value !== null).sort((a, b) => a.bpm - b.bpm)
  if (!valid.length) return null
  const bpm = valid[Math.floor(valid.length / 2)].bpm
  const consistent = valid.length >= (estimates.length === 1 ? 1 : 2)
    && valid.every((value) => Math.abs(value.bpm - bpm) / bpm < 0.025)
  // A musical backing often adds strong syncopated peaks in each window. When
  // all three windows agree, that agreement is evidence beyond a single peak's
  // margin over its competitors. Missing/weak windows cannot use this fallback.
  const consensus = valid.length >= 3 && valid.reduce((sum, value) => sum + value.strength, 0) / valid.length >= 0.3
  return { bpm: Math.round(bpm * 10) / 10, reliable: consistent && (valid.every((value) => value.clear) || consensus) }
}

/** Bounded work: at most three 20-second windows, independent of track length. */
export function analyzeBpm(channels: Float32Array[], sampleRate: number): BpmEstimate | null {
  if (!channels.length || !Number.isFinite(sampleRate) || sampleRate <= 0) return null
  const duration = Math.min(...channels.map((channel) => channel.length)) / sampleRate
  if (duration < 8) return null
  const seconds = Math.min(20, duration)
  const fractions = duration < 24 ? [0] : [0.15, 0.5, 0.85]
  const estimates = fractions.map((fraction) => estimateWindow(channels, sampleRate, Math.floor((duration - seconds) * fraction * sampleRate), seconds))
  return summarizeBpmWindows(estimates)
}
