import { app, BrowserWindow, dialog, ipcMain, protocol, shell } from 'electron'
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { ChartLibraryItem, ManagedChart, TitlebarTheme } from '../../src/shared/electron'

const TITLEBAR_HEIGHT = 42
const AUDIO_EXTENSIONS = new Set(['.mp3', '.wav', '.ogg', '.m4a', '.flac'])
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.avif'])
const VIDEO_EXTENSIONS = new Set(['.mp4', '.webm'])
const CONTENT_TYPES: Record<string, string> = { '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.m4a': 'audio/mp4', '.flac': 'audio/flac', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.avif': 'image/avif', '.mp4': 'video/mp4', '.webm': 'video/webm' }
const validId = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9-]{8,64}$/i.test(value)
const libraryRoot = () => path.join(app.getPath('userData'), 'library')
const chartsDirectory = () => path.join(libraryRoot(), 'charts')
const audioDirectory = () => path.join(libraryRoot(), 'audio')
const backgroundDirectory = () => path.join(libraryRoot(), 'backgrounds')
const chartFile = (id: string) => path.join(chartsDirectory(), `${id}.json`)
const ensureLibrary = () => { mkdirSync(chartsDirectory(), { recursive: true }); mkdirSync(audioDirectory(), { recursive: true }); mkdirSync(backgroundDirectory(), { recursive: true }) }
const audioUrlFor = (id: string, audioPath: string) => `moon-audio://library/${id}/${encodeURIComponent(path.basename(audioPath))}`
const backgroundUrlFor = (id: string, backgroundPath: string, version: number) => `moon-media://library/${id}/${encodeURIComponent(path.basename(backgroundPath))}?v=${version}`

interface StoredChart { id: string; chart: Record<string, unknown>; updatedAt: number }

function parseStoredChart(id: string): StoredChart | null {
  if (!validId(id)) return null
  try {
    const value = JSON.parse(readFileSync(chartFile(id), 'utf8')) as Partial<StoredChart>
    if (!value.chart || typeof value.chart !== 'object') return null
    return { id, chart: value.chart, updatedAt: typeof value.updatedAt === 'number' ? value.updatedAt : 0 }
  } catch { return null }
}

function summaryOf(record: StoredChart): ChartLibraryItem {
  const chart = record.chart
  return {
    id: record.id,
    title: typeof chart.title === 'string' ? chart.title : 'Untitled constellation',
    artist: typeof chart.artist === 'string' ? chart.artist : '',
    audioName: typeof chart.audioName === 'string' ? chart.audioName : '',
    noteCount: Array.isArray(chart.notes) ? chart.notes.length : 0,
    updatedAt: record.updatedAt,
  }
}

function managedChart(record: StoredChart): ManagedChart {
  const audioPath = typeof record.chart.audioPath === 'string' ? record.chart.audioPath : ''
  const resolved = audioPath ? path.join(audioDirectory(), path.basename(audioPath)) : ''
  const backgroundPath = typeof record.chart.backgroundPath === 'string' ? record.chart.backgroundPath : ''
  const resolvedBackground = backgroundPath ? path.join(backgroundDirectory(), path.basename(backgroundPath)) : ''
  return {
    id: record.id, chart: record.chart, updatedAt: record.updatedAt,
    audioUrl: resolved && existsSync(resolved) ? audioUrlFor(record.id, audioPath) : '',
    backgroundUrl: resolvedBackground && existsSync(resolvedBackground) ? backgroundUrlFor(record.id, backgroundPath, record.updatedAt) : '',
  }
}

function writeStoredChart(id: string, chart: Record<string, unknown>) {
  ensureLibrary()
  const record: StoredChart = { id, chart, updatedAt: Date.now() }
  const target = chartFile(id)
  const temporary = `${target}.${process.pid}.tmp`
  writeFileSync(temporary, JSON.stringify(record, null, 2), 'utf8')
  renameSync(temporary, target)
  return record
}

function removeManagedAudio(id: string, except = '') {
  ensureLibrary()
  for (const name of readdirSync(audioDirectory())) if (name.startsWith(`${id}.`) && name !== except) unlinkSync(path.join(audioDirectory(), name))
}

function copyAudioIntoLibrary(id: string, source: string) {
  const extension = path.extname(source).toLowerCase()
  if (!AUDIO_EXTENSIONS.has(extension) || !statSync(source).isFile()) throw new Error('不支持的音频文件')
  ensureLibrary()
  const name = `${id}${extension}`
  const target = path.join(audioDirectory(), name)
  const temporary = `${target}.${process.pid}.tmp`
  copyFileSync(source, temporary)
  if (existsSync(target)) unlinkSync(target)
  renameSync(temporary, target)
  removeManagedAudio(id, name)
  return name
}

function removeManagedBackground(id: string, except = '') {
  ensureLibrary()
  for (const name of readdirSync(backgroundDirectory())) if (name.startsWith(`${id}.`) && name !== except) unlinkSync(path.join(backgroundDirectory(), name))
}

function copyBackgroundIntoLibrary(id: string, source: string) {
  const extension = path.extname(source).toLowerCase()
  const backgroundType = VIDEO_EXTENSIONS.has(extension) ? 'video' as const : IMAGE_EXTENSIONS.has(extension) ? 'image' as const : null
  if (!backgroundType || !statSync(source).isFile()) throw new Error('不支持的背景媒体文件')
  ensureLibrary()
  const name = `${id}${extension}`
  const target = path.join(backgroundDirectory(), name)
  const temporary = `${target}.${process.pid}.tmp`
  copyFileSync(source, temporary)
  if (existsSync(target)) unlinkSync(target)
  renameSync(temporary, target)
  removeManagedBackground(id, name)
  return { name, backgroundType }
}

protocol.registerSchemesAsPrivileged([
  { scheme: 'moon-audio', privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true } },
  { scheme: 'moon-media', privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true } },
])

function titlebarOverlay(theme: TitlebarTheme) {
  return { color: '#00000000', symbolColor: theme === 'dark' ? '#a1a1a1' : '#707070', height: TITLEBAR_HEIGHT }
}

function createWindow(): void {
  const window = new BrowserWindow({
    width: 1380, height: 880, minWidth: 360, minHeight: 560, show: false, backgroundColor: '#ffffff',
    icon: app.isPackaged ? undefined : fileURLToPath(new URL('../../build/icon.png', import.meta.url)),
    titleBarStyle: 'hidden', titleBarOverlay: titlebarOverlay('light'),
    webPreferences: { preload: fileURLToPath(new URL('../preload/index.cjs', import.meta.url)), contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: true },
  })
  window.once('ready-to-show', () => window.show())
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://') || url.startsWith('http://')) void shell.openExternal(url)
    return { action: 'deny' }
  })
  if (process.env.ELECTRON_RENDERER_URL) void window.loadURL(process.env.ELECTRON_RENDERER_URL)
  else void window.loadFile(fileURLToPath(new URL('../renderer/index.html', import.meta.url)))
}

function registerIpc(): void {
  ipcMain.handle('shell:open-external', (_event, value: unknown) => {
    if (typeof value !== 'string' || !/^https?:\/\//i.test(value)) return false
    void shell.openExternal(value); return true
  })
  ipcMain.handle('shell:set-titlebar-theme', (event, value: unknown) => {
    if (value !== 'light' && value !== 'dark') return
    BrowserWindow.fromWebContents(event.sender)?.setTitleBarOverlay(titlebarOverlay(value))
  })
  ipcMain.handle('library:list', () => {
    ensureLibrary()
    return readdirSync(chartsDirectory()).filter((name) => name.endsWith('.json'))
      .map((name) => parseStoredChart(name.slice(0, -5))).filter((value): value is StoredChart => Boolean(value))
      .map(summaryOf).sort((a, b) => b.updatedAt - a.updatedAt)
  })
  ipcMain.handle('library:read', (_event, id: unknown) => {
    if (!validId(id)) return null
    const record = parseStoredChart(id)
    return record ? managedChart(record) : null
  })
  ipcMain.handle('library:write', (_event, id: unknown, chart: unknown) => {
    if (!validId(id) || !chart || typeof chart !== 'object') throw new Error('谱面数据无效')
    return summaryOf(writeStoredChart(id, chart as Record<string, unknown>))
  })
  ipcMain.handle('library:delete', (_event, id: unknown) => {
    if (!validId(id)) return false
    const target = chartFile(id)
    if (existsSync(target)) unlinkSync(target)
    removeManagedAudio(id)
    removeManagedBackground(id)
    return true
  })
  ipcMain.handle('library:choose-audio', async (event, id: unknown) => {
    if (!validId(id)) return null
    const owner = BrowserWindow.fromWebContents(event.sender)
    if (!owner) return null
    const result = await dialog.showOpenDialog(owner, { properties: ['openFile'], filters: [{ name: 'Audio', extensions: ['mp3', 'wav', 'ogg', 'm4a', 'flac'] }] })
    if (result.canceled) return null
    const source = result.filePaths[0]
    const audioPath = copyAudioIntoLibrary(id, source)
    return { audioPath, url: audioUrlFor(id, audioPath), name: path.basename(source) }
  })
  ipcMain.handle('library:choose-background', async (event, id: unknown) => {
    if (!validId(id)) return null
    const owner = BrowserWindow.fromWebContents(event.sender)
    if (!owner) return null
    const result = await dialog.showOpenDialog(owner, { properties: ['openFile'], filters: [{ name: 'Background media', extensions: ['png', 'jpg', 'jpeg', 'webp', 'avif', 'mp4', 'webm'] }] })
    if (result.canceled) return null
    const source = result.filePaths[0]
    const copied = copyBackgroundIntoLibrary(id, source)
    return { backgroundPath: copied.name, backgroundType: copied.backgroundType, url: backgroundUrlFor(id, copied.name, Date.now()), name: path.basename(source) }
  })
  ipcMain.handle('library:remove-background', (_event, id: unknown) => {
    if (!validId(id)) return false
    removeManagedBackground(id); return true
  })
  ipcMain.handle('library:import', async (event) => {
    const owner = BrowserWindow.fromWebContents(event.sender)
    if (!owner) return null
    const result = await dialog.showOpenDialog(owner, { properties: ['openFile'], filters: [{ name: 'Moonweave Chart', extensions: ['json'] }] })
    if (result.canceled) return null
    const sourceFile = result.filePaths[0]
    const chart = JSON.parse(readFileSync(sourceFile, 'utf8')) as Record<string, unknown>
    if (!chart || typeof chart !== 'object') throw new Error('谱面文件格式无效')
    const id = crypto.randomUUID()
    const storedPath = typeof chart.audioPath === 'string' ? chart.audioPath : ''
    const audioName = typeof chart.audioName === 'string' ? chart.audioName : ''
    const candidates = [path.isAbsolute(storedPath) ? storedPath : '', storedPath && !path.isAbsolute(storedPath) ? path.resolve(path.dirname(sourceFile), storedPath) : '', audioName ? path.join(path.dirname(sourceFile), audioName) : '']
    const sourceAudio = candidates.find((candidate) => { try { return Boolean(candidate) && statSync(candidate).isFile() } catch { return false } })
    chart.audioPath = sourceAudio ? copyAudioIntoLibrary(id, sourceAudio) : ''
    const storedBackgroundPath = typeof chart.backgroundPath === 'string' ? chart.backgroundPath : ''
    const backgroundName = typeof chart.backgroundName === 'string' ? chart.backgroundName : ''
    const backgroundCandidates = [path.isAbsolute(storedBackgroundPath) ? storedBackgroundPath : '', storedBackgroundPath && !path.isAbsolute(storedBackgroundPath) ? path.resolve(path.dirname(sourceFile), storedBackgroundPath) : '', backgroundName ? path.join(path.dirname(sourceFile), backgroundName) : '']
    const sourceBackground = backgroundCandidates.find((candidate) => { try { return Boolean(candidate) && statSync(candidate).isFile() } catch { return false } })
    if (sourceBackground) {
      const copied = copyBackgroundIntoLibrary(id, sourceBackground)
      chart.backgroundPath = copied.name; chart.backgroundType = copied.backgroundType
    } else { chart.backgroundPath = ''; chart.backgroundName = ''; chart.backgroundType = '' }
    return managedChart(writeStoredChart(id, chart))
  })
  ipcMain.handle('library:export', async (event, input: unknown) => {
    if (!input || typeof input !== 'object') return null
    const payload = input as { id?: unknown; chart?: unknown }
    if (!validId(payload.id) || !payload.chart || typeof payload.chart !== 'object') return null
    const owner = BrowserWindow.fromWebContents(event.sender)
    if (!owner) return null
    const chart = payload.chart as Record<string, unknown>
    const title = typeof chart.title === 'string' ? chart.title : 'untitled'
    const suggested = `${title.replace(/[<>:\"/\\|?*]/g, '_') || 'untitled'}.moon.json`
    const result = await dialog.showSaveDialog(owner, { defaultPath: suggested, filters: [{ name: 'Moonweave Chart', extensions: ['moon.json'] }, { name: 'JSON', extensions: ['json'] }] })
    if (result.canceled || !result.filePath) return null
    const exported = { ...chart }
    const managedName = typeof chart.audioPath === 'string' ? path.basename(chart.audioPath) : ''
    const managedSource = managedName ? path.join(audioDirectory(), managedName) : ''
    if (managedSource && existsSync(managedSource)) {
      const audioName = typeof chart.audioName === 'string' && chart.audioName ? path.basename(chart.audioName) : managedName
      copyFileSync(managedSource, path.join(path.dirname(result.filePath), audioName))
      exported.audioPath = audioName
    }
    const managedBackgroundName = typeof chart.backgroundPath === 'string' ? path.basename(chart.backgroundPath) : ''
    const managedBackgroundSource = managedBackgroundName ? path.join(backgroundDirectory(), managedBackgroundName) : ''
    if (managedBackgroundSource && existsSync(managedBackgroundSource)) {
      const backgroundName = typeof chart.backgroundName === 'string' && chart.backgroundName ? path.basename(chart.backgroundName) : managedBackgroundName
      copyFileSync(managedBackgroundSource, path.join(path.dirname(result.filePath), backgroundName))
      exported.backgroundPath = backgroundName
    }
    writeFileSync(result.filePath, JSON.stringify(exported, null, 2), 'utf8')
    return result.filePath
  })
  ipcMain.handle('library:reveal', async () => { ensureLibrary(); await shell.openPath(libraryRoot()); return libraryRoot() })
}

app.whenReady().then(() => {
  const serveManagedAsset = (request: Request, directory: string, schemeHost: string) => {
    const url = new URL(request.url)
    const parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent)
    const id = url.hostname === schemeHost ? parts[0] : ''
    const name = parts[1]
    if (!validId(id) || !name || path.basename(name) !== name || !name.startsWith(`${id}.`)) return new Response('Invalid audio reference', { status: 400 })
    try {
      const bytes = readFileSync(path.join(directory, name))
      const contentType = CONTENT_TYPES[path.extname(name).toLowerCase()] || 'application/octet-stream'
      const range = request.headers.get('range')
      if (range) {
        const match = /bytes=(\d+)-(\d*)/.exec(range)
        if (match) {
          const start = Number(match[1]); const end = match[2] ? Math.min(Number(match[2]), bytes.length - 1) : bytes.length - 1
          if (start <= end && start < bytes.length) return new Response(bytes.subarray(start, end + 1), { status: 206, headers: { 'Content-Type': contentType, 'Content-Length': String(end - start + 1), 'Content-Range': `bytes ${start}-${end}/${bytes.length}`, 'Accept-Ranges': 'bytes' } })
        }
      }
      return new Response(bytes, { status: 200, headers: { 'Content-Type': contentType, 'Content-Length': String(bytes.length), 'Accept-Ranges': 'bytes' } })
    } catch { return new Response('Managed asset not found', { status: 404 }) }
  }
  protocol.handle('moon-audio', (request) => serveManagedAsset(request, audioDirectory(), 'library'))
  protocol.handle('moon-media', (request) => serveManagedAsset(request, backgroundDirectory(), 'library'))
  registerIpc(); createWindow()
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })
})

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
