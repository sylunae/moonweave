import { readEncodedAudio } from './detectBpm'

// PCM has a fixed byte offset per sample. A backwards seek lands on the
// same samples even when the original MP3 has only a coarse VBR seek table.
export async function pcmWave(buffer: AudioBuffer, signal: AbortSignal) {
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, i) => buffer.getChannelData(i))
  const blockAlign = channels.length * 2
  const size = buffer.length * blockAlign
  const header = new DataView(new ArrayBuffer(44))
  const tag = (at: number, value: string) => {
    for (let i = 0; i < value.length; i++) header.setUint8(at + i, value.charCodeAt(i))
  }
  tag(0, 'RIFF')
  header.setUint32(4, size + 36, true)
  tag(8, 'WAVE')
  tag(12, 'fmt ')
  header.setUint32(16, 16, true)
  header.setUint16(20, 1, true)
  header.setUint16(22, channels.length, true)
  header.setUint32(24, buffer.sampleRate, true)
  header.setUint32(28, buffer.sampleRate * blockAlign, true)
  header.setUint16(32, blockAlign, true)
  header.setUint16(34, 16, true)
  tag(36, 'data')
  header.setUint32(40, size, true)

  const parts: BlobPart[] = [header.buffer]
  for (let start = 0; start < buffer.length; start += 131072) {
    signal.throwIfAborted()
    const frames = Math.min(131072, buffer.length - start)
    const samples = new Int16Array(frames * channels.length)
    for (let ch = 0; ch < channels.length; ch++) {
      const channel = channels[ch]
      for (let i = 0; i < frames; i++) {
        const sample = Math.max(-1, Math.min(1, channel[start + i]))
        samples[i * channels.length + ch] = Math.round(sample * (sample < 0 ? 32768 : 32767))
      }
    }
    parts.push(samples.buffer)
    await new Promise(resolve => setTimeout(resolve, 0))
  }
  signal.throwIfAborted()
  return new Blob(parts, { type: 'audio/wav' })
}

export async function prepareEditorAudio(url: string, signal: AbortSignal) {
  const encoded = await readEncodedAudio(url, signal)
  signal.throwIfAborted()
  const buffer = await new OfflineAudioContext(2, 1, 48000).decodeAudioData(encoded)
  signal.throwIfAborted()
  return pcmWave(buffer, signal)
}

export function cacheEditorAudio(source: string) {
  const controller = new AbortController()
  let url: string | undefined
  const ready = prepareEditorAudio(source, controller.signal).then(blob => {
    if (!controller.signal.aborted) url = URL.createObjectURL(blob)
    return url
  }, () => undefined) // Unreadable or oversized inputs keep native playback.
  return {
    ready,
    get url() { return url },
    dispose() {
      controller.abort()
      if (url) URL.revokeObjectURL(url)
    },
  }
}
