import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { detectBpm } from '@/features/chart/detectBpm'

let seconds = 60
let finishWorker = true
let workerTerminated = false
let decode: ReturnType<typeof vi.fn>
let fetchAudio: ReturnType<typeof vi.fn>

beforeEach(() => {
  seconds = 60; finishWorker = true; workerTerminated = false
  class MetadataAudio {
    duration = seconds
    onloadedmetadata: (() => void) | null = null
    onerror: (() => void) | null = null
    set src(_url: string) { queueMicrotask(() => this.onloadedmetadata?.()) }
    removeAttribute() {}
    load() {}
  }
  decode = vi.fn(async () => ({ duration: 60, numberOfChannels: 1, sampleRate: 11025, getChannelData: () => new Float32Array(10) }))
  fetchAudio = vi.fn(async () => new Response(new Uint8Array([1, 2, 3])))
  vi.stubGlobal('Audio', MetadataAudio)
  vi.stubGlobal('fetch', fetchAudio)
  vi.stubGlobal('OfflineAudioContext', class { decodeAudioData = decode })
  vi.stubGlobal('Worker', class {
    onmessage: ((event: { data: { result: { bpm: number; reliable: boolean } } }) => void) | null = null
    terminate() { workerTerminated = true }
    postMessage() { if (finishWorker) queueMicrotask(() => this.onmessage?.({ data: { result: { bpm: 120, reliable: true } } })) }
  })
})
afterEach(() => vi.unstubAllGlobals())

it('decodes and terminates its analysis worker after a successful result', async () => {
  expect(await detectBpm('blob:audio', new AbortController().signal)).toEqual({ bpm: 120, reliable: true })
  expect(workerTerminated).toBe(true)
})

it('skips overlong audio before fetching or decoding it', async () => {
  seconds = 601
  await expect(detectBpm('blob:audio', new AbortController().signal)).rejects.toThrow('duration')
  expect(fetchAudio).not.toHaveBeenCalled()
  expect(decode).not.toHaveBeenCalled()
})

it('rejects an oversized file before decoding it', async () => {
  fetchAudio.mockResolvedValue(new Response(new Uint8Array([1]), { headers: { 'content-length': String(33 * 1024 * 1024) } }))
  await expect(detectBpm('blob:audio', new AbortController().signal)).rejects.toThrow('size')
  expect(decode).not.toHaveBeenCalled()
})

it('reads managed desktop audio through the narrow preload API, without fetching the custom scheme', async () => {
  const readAudioForAnalysis = vi.fn(async () => new Uint8Array([1, 2, 3]))
  vi.stubGlobal('window', { moonweave: { readAudioForAnalysis } })
  expect(await detectBpm('moon-audio://library/12345678-abcd/12345678-abcd.mp3', new AbortController().signal)).toMatchObject({ bpm: 120 })
  expect(readAudioForAnalysis).toHaveBeenCalledWith('12345678-abcd')
  expect(fetchAudio).not.toHaveBeenCalled()
})

it('does not decode desktop audio that exceeds the main-process size cap', async () => {
  vi.stubGlobal('window', { moonweave: { readAudioForAnalysis: vi.fn(async () => null) } })
  await expect(detectBpm('moon-audio://library/12345678-abcd/12345678-abcd.mp3', new AbortController().signal)).rejects.toThrow('size')
  expect(decode).not.toHaveBeenCalled()
})

it('terminates an unfinished worker when analysis is cancelled', async () => {
  finishWorker = false
  const controller = new AbortController()
  const promise = detectBpm('blob:audio', controller.signal)
  const rejection = expect(promise).rejects.toMatchObject({ name: 'AbortError' })
  await vi.waitFor(() => expect(decode).toHaveBeenCalled())
  // Let the decode continuation attach its worker cancellation handler.
  await Promise.resolve()
  controller.abort()
  await rejection
  expect(workerTerminated).toBe(true)
})
