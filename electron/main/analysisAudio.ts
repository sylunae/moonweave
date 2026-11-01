import { open } from 'node:fs/promises'
import path from 'node:path'

const MAX_BYTES = 32 * 1024 * 1024

/** Reads only a chart-owned audio file, with an allocation bound before IPC. */
export async function readAnalysisAudio(directory: string, id: string, name: unknown): Promise<Uint8Array | null> {
  if (!/^[a-f0-9-]{8,64}$/i.test(id) || typeof name !== 'string' || path.basename(name) !== name
    || !name.startsWith(`${id}.`) || !/\.(mp3|wav|ogg|m4a|flac)$/i.test(name)) throw new Error('无效的谱面音频引用')
  const file = await open(path.join(directory, name), 'r')
  try {
    const { size } = await file.stat()
    if (size > MAX_BYTES) return null
    const bytes = new Uint8Array(size)
    let offset = 0
    while (offset < size) {
      const { bytesRead } = await file.read(bytes, offset, size - offset, offset)
      if (!bytesRead) throw new Error('音频读取不完整')
      offset += bytesRead
    }
    return bytes
  } finally { await file.close() }
}
