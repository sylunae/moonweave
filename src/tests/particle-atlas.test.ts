import { afterEach, expect, it, vi } from 'vitest'
import { parseParticleAtlas } from '@/features/appearance/parseParticleAtlas'

const gifHeader = [71, 73, 70, 56, 57, 97, 2, 0, 1, 0, 0x80, 0, 0, 0, 0, 0, 255, 255, 255]
const gifFrame = (delay: number, options: number, pixels: number) => [
  0x21, 0xf9, 4, options, delay, 0, 0, 0,
  0x2c, 0, 0, 0, 0, 1, 0, 1, 0, 0,
  2, 2, pixels, 1, 0,
]

afterEach(() => { vi.unstubAllGlobals() })

it('packs GIF frames in order with source delays and restores a temporary frame', async () => {
  const data = new Blob([Uint8Array.from([
    ...gifHeader, ...gifFrame(3, 5, 0x4c), ...gifFrame(7, 13, 0x44), ...gifFrame(11, 9, 0x4c), 0x3b,
  ])])
  const output = new Blob(['atlas'], { type: 'image/png' })
  const restore = { data: new Uint8ClampedArray(4) }
  const contexts = Array.from({ length: 3 }, () => ({
    canvas: { width: 0, height: 0, toBlob: (callback: BlobCallback) => callback(output) },
    drawImage: vi.fn(),
    clearRect: vi.fn(),
    createImageData: () => ({ data: new Uint8ClampedArray(4) }),
    getImageData: vi.fn(() => restore),
    putImageData: vi.fn(),
  }))
  let nextCanvas = 0
  vi.stubGlobal('window', { setTimeout })
  vi.stubGlobal('document', { createElement: () => {
    const context = contexts[nextCanvas++]
    return Object.assign(context.canvas, { getContext: () => context })
  } })

  const atlas = await parseParticleAtlas(data, new AbortController().signal)

  expect(atlas).toEqual({ image: output, columns: 2, rows: 2, frameDurations: [30, 70, 110] })
  expect(contexts[0].drawImage.mock.calls.map(([, x, y]) => [x, y])).toEqual([[0, 0.5], [2, 0.5], [0, 2.5]])
  expect(contexts[1].putImageData).toHaveBeenCalledWith(restore, 0, 0)
  expect(contexts[1].clearRect).toHaveBeenCalledWith(0, 0, 1, 1)
  expect(contexts[2].putImageData.mock.calls[1][0].data[3]).toBe(0)
})

it('rejects an oversized GIF before allocating a canvas', async () => {
  const oversized = Uint8Array.from(gifHeader)
  new DataView(oversized.buffer).setUint16(6, 1025, true)
  await expect(parseParticleAtlas(new Blob([oversized]), new AbortController().signal)).rejects.toMatchObject({ reason: 'limits' })
})
