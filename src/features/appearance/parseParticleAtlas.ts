import { decompressFrame, parseGIF, type Frame } from 'gifuct-js'
import type { ParticleAtlas } from './particleLibrary'

const MAX_PARTICLE_FILE_SIZE = 8 * 1024 * 1024
const MAX_ATLAS_SIZE = 2048
const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10]

export class ParticleImportError extends Error {
  constructor(readonly reason: 'invalid' | 'format' | 'limits') {
    super(reason)
  }
}

function makeCanvas(width: number, height: number) {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (!context) throw new ParticleImportError('invalid')
  return context
}

async function encodeAtlas(canvas: HTMLCanvasElement, columns: number, rows: number, frameDurations: number[]): Promise<ParticleAtlas> {
  try {
    const image = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((blob) => blob ? resolve(blob) : reject(new ParticleImportError('invalid')), 'image/png')
    })
    return { image, columns, rows, frameDurations }
  } finally {
    canvas.width = canvas.height = 0
  }
}

async function parsePng(data: ArrayBuffer, signal: AbortSignal) {
  const view = new DataView(data)
  if (view.byteLength < 33 || view.getUint32(8) !== 13 || view.getUint32(12) !== 0x49484452) throw new ParticleImportError('invalid')
  const width = view.getUint32(16), height = view.getUint32(20)
  if (width > 4096 || height > 4096) throw new ParticleImportError('limits')
  if (!width || width !== height || width % 4) throw new ParticleImportError('format')
  for (let offset = 33; offset + 12 <= view.byteLength;) {
    const length = view.getUint32(offset), chunk = view.getUint32(offset + 4)
    if (chunk === 0x6163544c) throw new ParticleImportError('format') // acTL marks an animated PNG.
    if (chunk === 0x49444154) break // IDAT marks the start of image data.
    offset += length + 12
  }

  const bitmap = await createImageBitmap(new Blob([data], { type: 'image/png' }))
  try {
    signal.throwIfAborted()
    const size = Math.min(MAX_ATLAS_SIZE, width)
    const atlas = makeCanvas(size, size)
    atlas.drawImage(bitmap, 0, 0, size, size)
    return await encodeAtlas(atlas.canvas, 4, 4, Array<number>(16).fill(25))
  } finally {
    bitmap.close()
  }
}

function getGifFrames(data: ArrayBuffer) {
  if (data.byteLength < 14) throw new ParticleImportError('invalid')
  const view = new DataView(data)
  const width = view.getUint16(6, true), height = view.getUint16(8, true)
  if (!width || !height) throw new ParticleImportError('invalid')
  if (width > 1024 || height > 1024) throw new ParticleImportError('limits')

  const gif = parseGIF(data)
  const frames = gif.frames.filter((frame): frame is Frame => 'image' in frame && Boolean(frame.image))
  if (frames.length < 2) throw new ParticleImportError('format')
  if (frames.length > 120) throw new ParticleImportError('limits')
  let pixels = 0
  const durations = frames.map(({ image, gce }) => {
    const rect = image.descriptor
    if (!rect.width || !rect.height || rect.left + rect.width > width || rect.top + rect.height > height ||
      (!rect.lct.exists && !gif.gct?.length) || image.data.minCodeSize < 2 || image.data.minCodeSize > 8 || !image.data.blocks.length) {
      throw new ParticleImportError('invalid')
    }
    pixels += rect.width * rect.height
    return Math.max(20, (gce?.delay || 10) * 10)
  })
  if (pixels > 48_000_000 || durations.reduce((sum, delay) => sum + delay, 0) > 15_000) throw new ParticleImportError('limits')
  return { gif, frames, width, height, durations }
}

async function parseGif(data: ArrayBuffer, signal: AbortSignal) {
  const { gif, frames, width, height, durations } = getGifFrames(data)
  const columns = Math.ceil(Math.sqrt(frames.length))
  const rows = Math.ceil(frames.length / columns)
  const side = Math.min(384, Math.floor(MAX_ATLAS_SIZE / columns), Math.max(width, height))
  const scale = side / Math.max(width, height)
  const drawWidth = width * scale, drawHeight = height * scale
  const atlas = makeCanvas(side * columns, side * rows)
  const composite = makeCanvas(width, height)
  const patch = makeCanvas(1, 1)
  const background = frames.some((frame) => frame.gce?.extras.transparentColorGiven) ? undefined : gif.gct?.[gif.lsd.backgroundColorIndex]

  const clearFrame = (left: number, top: number, frameWidth: number, frameHeight: number) => {
    composite.clearRect(left, top, frameWidth, frameHeight)
    if (background) {
      composite.fillStyle = `rgb(${background.join(',')})`
      composite.fillRect(left, top, frameWidth, frameHeight)
    }
  }
  clearFrame(0, 0, width, height)

  try {
    for (const [index, frame] of frames.entries()) {
      if (index % 4 === 0) await new Promise<void>((resolve) => window.setTimeout(resolve, 0))
      signal.throwIfAborted()
      const decoded = decompressFrame(frame, gif.gct, true)
      const { left, top, width: frameWidth, height: frameHeight } = decoded.dims
      const restore = decoded.disposalType === 3 ? composite.getImageData(left, top, frameWidth, frameHeight) : null
      patch.canvas.width = frameWidth
      patch.canvas.height = frameHeight
      const image = patch.createImageData(frameWidth, frameHeight)
      image.data.set(decoded.patch)
      patch.putImageData(image, 0, 0)
      composite.drawImage(patch.canvas, left, top)
      const x = (index % columns) * side + (side - drawWidth) / 2
      const y = Math.floor(index / columns) * side + (side - drawHeight) / 2
      atlas.drawImage(composite.canvas, x, y, drawWidth, drawHeight)
      if (restore) composite.putImageData(restore, left, top)
      else if (decoded.disposalType === 2) clearFrame(left, top, frameWidth, frameHeight)
    }
    return await encodeAtlas(atlas.canvas, columns, rows, durations)
  } finally {
    atlas.canvas.width = composite.canvas.width = patch.canvas.width = 0
  }
}

export async function parseParticleAtlas(file: Blob, signal: AbortSignal) {
  if (file.size > MAX_PARTICLE_FILE_SIZE) throw new ParticleImportError('limits')
  const data = await file.arrayBuffer()
  signal.throwIfAborted()
  const bytes = new Uint8Array(data)
  const signature = String.fromCharCode(...bytes.subarray(0, 6))
  try {
    if (signature === 'GIF87a' || signature === 'GIF89a') return await parseGif(data, signal)
    if (PNG_SIGNATURE.every((value, index) => bytes[index] === value)) return await parsePng(data, signal)
    throw new ParticleImportError('format')
  } catch (error) {
    signal.throwIfAborted()
    if (error instanceof ParticleImportError) throw error
    throw new ParticleImportError('invalid')
  }
}
