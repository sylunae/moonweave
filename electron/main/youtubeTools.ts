import { app } from 'electron'
import { createHash, randomUUID } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { mkdir, rename, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { createGunzip } from 'node:zlib'

// FFmpeg uses the same Windows distribution as Sylunae Workshop.
const tools = {
  ffmpeg: {
    file: 'ffmpeg.exe',
    url: 'https://github.com/eugeneware/ffmpeg-static/releases/download/b6.1.1/ffmpeg-win32-x64.gz',
    sha256: '04e1307997530f9cf2fe35cba2ca7e8875ca91da02f89d6c7243df819c94ad00',
    installedBytes: 82_797_568,
  },
  ytDlp: {
    file: 'yt-dlp.exe',
    url: 'https://github.com/yt-dlp/yt-dlp/releases/download/2026.11.23/yt-dlp.exe',
    sha256: '622ed48023cac1daa52a3bf3a6ac38f03514de214b5f0fa069389fd0f6d17e5c',
    installedBytes: 23_627_865,
  },
}

type Tool = typeof tools[keyof typeof tools]
let installation: Promise<void> | undefined
const supported = process.platform === 'win32' && process.arch === 'x64'
const toolDirectory = () => join(app.getPath('userData'), 'media-tools')
const toolPath = (tool: Tool) => join(toolDirectory(), tool.file)

async function isInstalled(tool: Tool) {
  const file = await stat(toolPath(tool)).catch(() => null)
  return Boolean(file?.isFile() && file.size === tool.installedBytes)
}

export async function youtubeToolsStatus() {
  if (!supported) return 'unsupported'
  if (installation) return 'installing'
  const installed = await Promise.all(Object.values(tools).map(isInstalled))
  return installed.every(Boolean) ? 'ready' : 'missing'
}

async function downloadTool(tool: Tool) {
  if (await isInstalled(tool)) return
  const target = toolPath(tool)
  const temporary = `${target}.${randomUUID()}.download`
  const signal = AbortSignal.timeout(5 * 60_000)
  const response = await fetch(tool.url, { signal })
  if (!response.ok || !response.body) throw new Error(`Media tool download failed (HTTP ${response.status})`)
  let size = 0
  const limit = new Transform({
    transform(chunk, _encoding, done) {
      size += chunk.length
      if (size > tool.installedBytes) done(new Error('Media tool exceeds its expected size'))
      else done(null, chunk)
    },
  })
  try {
    const body = Readable.fromWeb(response.body as never)
    const output = createWriteStream(temporary, { flags: 'wx' })
    if (tool.url.endsWith('.gz')) await pipeline(body, createGunzip(), limit, output, { signal })
    else await pipeline(body, limit, output, { signal })
    const hash = createHash('sha256')
    await pipeline(createReadStream(temporary), hash, { signal })
    if (size !== tool.installedBytes || hash.digest('hex') !== tool.sha256) throw new Error('Media tool checksum mismatch')
    await rename(temporary, target)
  } finally {
    await rm(temporary, { force: true })
  }
}

export async function installYoutubeTools() {
  if (!supported) throw new Error('Unsupported platform')
  installation ??= (async () => {
    await mkdir(toolDirectory(), { recursive: true })
    for (const tool of Object.values(tools)) await downloadTool(tool)
  })().finally(() => { installation = undefined })
  await installation
}

export async function youtubeToolPaths() {
  if (await youtubeToolsStatus() !== 'ready') return null
  return { ffmpeg: toolPath(tools.ffmpeg), ytDlp: toolPath(tools.ytDlp) }
}
