import type { BpmEstimate } from './bpmAnalysis'

export type BpmFailureReason = 'unavailable' | 'unsupported' | 'failed'

// Keep decoding memory reasonable, including on phones. No model or server.
const MAX_BYTES = 32 * 1024 * 1024
const MAX_SECONDS = 600

function readDuration(url: string, signal: AbortSignal) {
  return new Promise<number>((resolve, reject) => {
    const audio = new Audio()
    const cleanup = () => {
      audio.onloadedmetadata = null; audio.onerror = null
      signal.removeEventListener('abort', abort)
      audio.removeAttribute('src'); audio.load()
    }
    const abort = () => { cleanup(); reject(new DOMException('Aborted', 'AbortError')) }
    audio.preload = 'metadata'
    audio.onloadedmetadata = () => { const duration = audio.duration; cleanup(); resolve(duration) }
    audio.onerror = () => { cleanup(); reject(new Error('metadata')) }
    signal.addEventListener('abort', abort, { once: true })
    if (signal.aborted) { abort(); return }
    audio.src = url
  })
}

export async function readEncodedAudio(url: string, signal: AbortSignal): Promise<ArrayBuffer> {
  if (url.startsWith('moon-audio:') && window.moonweave) {
    // Managed media playback uses a custom scheme that intentionally disallows
    // cross-origin fetch. The preload exposes only chart-owned, bounded reads.
    const parsed = new URL(url)
    const id = parsed.pathname.split('/')[1]
    if (parsed.hostname !== 'library' || !id) throw new Error('reference')
    const bytes = await window.moonweave.readAudioForAnalysis(id)
    signal.throwIfAborted()
    if (!bytes || bytes.byteLength > MAX_BYTES) throw new RangeError('size')
    return bytes.slice().buffer as ArrayBuffer
  }
  const response = await fetch(url, { signal })
  if (!response.ok) throw new Error('read')
  if (Number(response.headers.get('content-length')) > MAX_BYTES) {
    await response.body?.cancel()
    throw new RangeError('size')
  }
  // Read incrementally so a missing Content-Length cannot bypass the byte cap.
  const reader = response.body?.getReader()
  if (!reader) throw new Error('body')
  const chunks: Uint8Array<ArrayBuffer>[] = []
  let bytes = 0
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      bytes += value.byteLength
      if (bytes > MAX_BYTES) { await reader.cancel(); throw new RangeError('size') }
      chunks.push(value as Uint8Array<ArrayBuffer>)
    }
  } finally { reader.releaseLock() }
  signal.throwIfAborted()
  return new Blob(chunks).arrayBuffer()
}

export async function detectBpm(url: string, signal: AbortSignal): Promise<BpmEstimate | null> {
  const duration = await readDuration(url, signal)
  if (!Number.isFinite(duration) || duration > MAX_SECONDS || duration < 8) throw new RangeError('duration')
  const encoded = await readEncodedAudio(url, signal)
  signal.throwIfAborted()
  // Native asynchronous decoding resamples to 11 kHz; no playback context needed.
  const context = new OfflineAudioContext(1, 1, 11025)
  const buffer = await context.decodeAudioData(encoded)
  signal.throwIfAborted()
  if (buffer.duration > MAX_SECONDS || buffer.numberOfChannels > 2) throw new RangeError('duration')
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./bpm.worker.ts', import.meta.url), { type: 'module' })
    const cleanup = () => { worker.terminate(); signal.removeEventListener('abort', abort) }
    const abort = () => { cleanup(); reject(new DOMException('Aborted', 'AbortError')) }
    signal.addEventListener('abort', abort, { once: true })
    worker.onmessage = (event: MessageEvent<{ result?: BpmEstimate | null; error?: boolean }>) => {
      cleanup()
      if (event.data.error) reject(new Error('analysis'))
      else resolve(event.data.result ?? null)
    }
    worker.onerror = () => { cleanup(); reject(new Error('worker')) }
    const channels = Array.from({ length: buffer.numberOfChannels }, (_, channel) => buffer.getChannelData(channel).slice())
    worker.postMessage({ channels, sampleRate: buffer.sampleRate }, channels.map((channel) => channel.buffer))
  })
}
