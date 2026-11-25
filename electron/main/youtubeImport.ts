import { app, ipcMain, type WebContents } from 'electron'
import { execFile } from 'node:child_process'
import { createWriteStream } from 'node:fs'
import { mkdtemp, readdir, readFile, rename, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { promisify } from 'node:util'
import type { YoutubeImportResult } from '../../src/shared/electron'
import { youtubeVideoId } from '../../src/shared/youtubeUrl'
import { installYoutubeTools, youtubeToolPaths, youtubeToolsStatus } from './youtubeTools'

const run = promisify(execFile)
const MAX_SECONDS = 3600
const MAX_COVER_BYTES = 2 * 1024 * 1024
const validRequestId = (id: unknown): id is string => typeof id === 'string' && /^[a-f0-9-]{36}$/i.test(id)

interface ImportJob {
  owner: WebContents
  id: string
  controller: AbortController
  directory?: string
  media?: { audio: string; cover?: string }
}

const staged = new Map<WebContents, ImportJob>()
let active: ImportJob | undefined

function discardDirectory(job: ImportJob) {
  return job.directory
    ? rm(job.directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }).catch(console.error)
    : Promise.resolve()
}

export function discardYoutubeImport(owner: WebContents, id?: string) {
  if (active?.owner === owner && (id === undefined || active.id === id)) active.controller.abort()
  const job = staged.get(owner)
  if (!job || (id !== undefined && job.id !== id)) return Promise.resolve()
  staged.delete(owner)
  return discardDirectory(job)
}

export function getYoutubeImport(owner: WebContents, id: unknown) {
  const job = staged.get(owner)
  return validRequestId(id) && job?.id === id ? job.media : undefined
}

async function downloadCover(video: string, target: string, signal: AbortSignal) {
  for (const quality of ['maxresdefault', 'hqdefault']) {
    try {
      const timeout = AbortSignal.any([signal, AbortSignal.timeout(5000)])
      const response = await fetch(`https://i.ytimg.com/vi/${video}/${quality}.jpg`, { signal: timeout, redirect: 'error' })
      if (!response.ok || !response.body || response.headers.get('content-type')?.split(';')[0] !== 'image/jpeg') {
        await response.body?.cancel()
        continue
      }
      let size = 0
      const limit = new Transform({
        transform(chunk, _encoding, done) {
          size += chunk.length
          if (size > MAX_COVER_BYTES) done(new Error('Thumbnail too large'))
          else done(null, chunk)
        },
      })
      await pipeline(Readable.fromWeb(response.body as never), limit, createWriteStream(target, { flags: 'wx' }), { signal: timeout })
      if (size > 0) return new Uint8Array(await readFile(target))
    } catch {
      signal.throwIfAborted()
    }
    await rm(target, { force: true })
  }
  return undefined
}

function metadataText(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function truncateText(text: string, length: number) {
  return text.slice(0, length).replace(/[\uD800-\uDBFF]$/, '').trimEnd()
}

async function download(owner: WebContents, id: unknown, url: unknown): Promise<YoutubeImportResult> {
  const video = youtubeVideoId(url)
  if (!video || !validRequestId(id)) return { ok: false, reason: 'link' }
  if (active || staged.get(owner)?.id === id) return { ok: false, reason: 'busy' }
  const job: ImportJob = { owner, id, controller: new AbortController() }
  active = job
  const { signal } = job.controller
  try {
    const tools = await youtubeToolPaths()
    signal.throwIfAborted()
    if (!tools) return { ok: false, reason: 'tools' }
    const directory = await mkdtemp(join(app.getPath('temp'), 'moonweave-youtube-'))
    job.directory = directory
    const options = { signal, windowsHide: true, maxBuffer: 8 * 1024 * 1024, timeout: 60_000, cwd: directory }
    // yt-dlp bundles its challenge solver scripts. Electron supplies their Node runtime.
    const downloader = {
      ...options,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', NODE_OPTIONS: '' },
    }
    const common = [
      '--ignore-config', '--no-plugin-dirs', '--no-cache-dir', '--no-playlist', '--no-warnings',
      '--no-js-runtimes', '--js-runtimes', `node:${process.execPath}`, '--socket-timeout', '15',
    ]
    const link = `https://www.youtube.com/watch?v=${video}`
    const { stdout } = await run(tools.ytDlp, [...common, '--dump-single-json', '--skip-download', '--', link], downloader)
    const metadata = JSON.parse(stdout) as Record<string, unknown>
    const duration = Number(metadata.duration)
    if (metadata.id !== video || metadata.is_live || metadata.live_status === 'is_upcoming' ||
        !Number.isFinite(duration) || duration <= 0 || duration > MAX_SECONDS) {
      return { ok: false, reason: 'duration' }
    }
    const title = truncateText(metadataText(metadata.track) || metadataText(metadata.title) || video, 100)
    const artists = Array.isArray(metadata.artists) ? metadata.artists.map(metadataText).filter(Boolean).join(', ') : ''
    const channel = metadataText(metadata.channel) || metadataText(metadata.uploader)
    const artist = truncateText(artists || metadataText(metadata.artist) || metadataText(metadata.creator) ||
      channel.replace(/ - Topic$/, ''), 240)
    const stem = truncateText(title.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_'), 80)
    const audioName = `${stem || 'YouTube'} [${video}].mp3`
    await run(tools.ytDlp, [
      ...common, '--no-progress', '--no-continue', '--max-filesize', '128M', '--fixup', 'never',
      '--format', 'bestaudio[protocol=https]/best[protocol=https]', '--output', 'source.%(ext)s', '--', link,
    ], { ...downloader, timeout: 5 * 60_000 })
    const source = (await readdir(directory)).find(name => /^source\.(m4a|webm|mp4|opus|aac|ogg)$/i.test(name))
    if (!source || (await stat(join(directory, source))).size > 128 * 1024 * 1024) return { ok: false, reason: 'failed' }
    const audio = join(directory, audioName)
    await run(tools.ffmpeg, [
      '-nostdin', '-hide_banner', '-loglevel', 'error', '-threads', '1',
      '-protocol_whitelist', 'file', '-format_whitelist', 'mov,matroska,webm,ogg,aac', '-i', source,
      '-map', '0:a:0', '-map_metadata', '-1', '-threads', '1', '-codec:a', 'libmp3lame', '-b:a', '192k',
      '-t', String(MAX_SECONDS + 1), '-fs', '96M', 'audio.mp3',
    ], { ...options, timeout: 3 * 60_000 })
    const output = join(directory, 'audio.mp3')
    const { size } = await stat(output)
    if (!size || size >= 96 * 1024 * 1024) return { ok: false, reason: 'failed' }
    // Use fixed command arguments and give the staged files descriptive names afterwards.
    await rename(output, audio)
    await rm(join(directory, source))
    const coverPath = join(directory, `YouTube ${video}.jpg`)
    const cover = await downloadCover(video, coverPath, signal)
    signal.throwIfAborted()
    const previous = staged.get(owner)
    job.media = { audio, cover: cover ? coverPath : undefined }
    staged.set(owner, job)
    if (previous) void discardDirectory(previous)
    return { ok: true, media: { title, artist, duration: Math.round(duration * 1000), audioName, cover } }
  } catch {
    return { ok: false, reason: 'failed' }
  } finally {
    if (staged.get(owner) !== job) await discardDirectory(job)
    active = undefined
  }
}

export function registerYoutubeImport() {
  ipcMain.handle('youtube:status', () => youtubeToolsStatus())
  ipcMain.handle('youtube:install', () => installYoutubeTools())
  ipcMain.handle('youtube:download', (event, id: unknown, url: unknown) => download(event.sender, id, url))
  ipcMain.handle('youtube:discard', (event, id: unknown) => {
    if (validRequestId(id)) return discardYoutubeImport(event.sender, id)
  })
}
