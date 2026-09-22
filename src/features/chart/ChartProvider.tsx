import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { migrateLegacyChartPreferences, usePreferences } from '@/app/preferences'
import type { ChartLibraryItem } from '@/shared/electron'
import { PlaybackClock } from '@/features/playtest/PlaybackClock'
import { deleteWebChart, listWebCharts, readWebChart, writeWebChart } from './webLibrary'
import { createChartPackage, readChartPackage } from './chartPackage'
import { DEFAULT_CHART, normalizeChart, type Chart, type ChartNote } from './types'
import { snapToBeatLine } from './tempoMap'

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))
const freshChart = () => normalizeChart(DEFAULT_CHART)
const packagedAssetBlob = (asset: { data: Uint8Array; name: string }) => {
  const extension = asset.name.split('.').pop()?.toLowerCase() ?? ''
  const type = ({ mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', m4a: 'audio/mp4', flac: 'audio/flac', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', avif: 'image/avif', mp4: 'video/mp4', webm: 'video/webm' } as Record<string, string>)[extension] ?? ''
  return new Blob([asset.data.slice().buffer as ArrayBuffer], { type })
}
const webSummary = (id: string, chart: Chart, updatedAt: number, coverUrl = ''): ChartLibraryItem => ({
  id, title: chart.title, artist: chart.artist, audioName: chart.audioName, noteCount: chart.notes.length, updatedAt, coverUrl,
})

interface ChartContextValue {
  chart: Chart
  setChart: React.Dispatch<React.SetStateAction<Chart>>
  activeChartId: string
  charts: ChartLibraryItem[]
  libraryReady: boolean
  storageStatus: 'loading' | 'saving' | 'saved' | 'error'
  audioUrl: string
  backgroundUrl: string
  coverUrl: string
  audioRef: React.RefObject<HTMLAudioElement | null>
  currentTime: number
  isPlaying: boolean
  historyLength: number
  futureLength: number
  toast: string
  setCurrentTime(time: number): void
  commitNotes(notes: ChartNote[]): void
  undo(): void
  redo(): void
  chooseAudio(): Promise<void>
  chooseBackground(): Promise<void>
  removeBackground(): Promise<void>
  chooseCover(): Promise<void>
  removeCover(): Promise<void>
  flushActiveChart(): Promise<boolean>
  importChart(): Promise<string | null>
  exportChart(id: string): Promise<boolean>
  createChart(): Promise<string | null>
  selectChart(id: string): Promise<boolean>
  deleteChart(id: string): Promise<boolean>
  revealLibrary(): Promise<void>
  togglePlay(playbackRate: number, subdivision: number): Promise<void>
  showToast(message: string): void
}

const ChartContext = createContext<ChartContextValue | null>(null)

function chooseLocalFiles(accept: string, multiple = false) {
  return new Promise<File[]>((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'; input.accept = accept; input.multiple = multiple
    input.onchange = () => resolve([...(input.files ?? [])])
    input.addEventListener('cancel', () => resolve([]), { once: true })
    input.click()
  })
}

export function ChartProvider({ children }: { children: React.ReactNode }) {
  const { setPreferences } = usePreferences()
  const [chart, setChart] = useState<Chart>(freshChart)
  const [activeChartId, setActiveChartId] = useState('')
  const [charts, setCharts] = useState<ChartLibraryItem[]>([])
  const [libraryReady, setLibraryReady] = useState(false)
  const [storageStatus, setStorageStatus] = useState<ChartContextValue['storageStatus']>('loading')
  const [audioUrl, setAudioUrl] = useState('')
  const [backgroundUrl, setBackgroundUrl] = useState('')
  const [coverUrl, setCoverUrl] = useState('')
  const [currentTime, setCurrentTimeState] = useState(0)
  const [isPlaying, setIsPlaying] = useState(false)
  const [history, setHistory] = useState<ChartNote[][]>([])
  const [future, setFuture] = useState<ChartNote[][]>([])
  const [toast, setToast] = useState('')
  const audioRef = useRef<HTMLAudioElement>(null)
  const objectUrlRef = useRef('')
  const backgroundObjectUrlRef = useRef('')
  const webCoverUrlsRef = useRef(new Map<string, string>())
  const animationRef = useRef(0)
  const playbackClockRef = useRef(new PlaybackClock())
  const playbackQueueRef = useRef<Promise<void>>(Promise.resolve())
  const playbackEpochRef = useRef(0)
  const toastTimerRef = useRef(0)
  const chartRef = useRef(chart)
  const activeIdRef = useRef(activeChartId)
  const writeQueueRef = useRef(Promise.resolve(true))
  const deletedIdsRef = useRef(new Set<string>())
  chartRef.current = chart
  activeIdRef.current = activeChartId

  const showToast = useCallback((message: string) => {
    window.clearTimeout(toastTimerRef.current)
    setToast(message)
    toastTimerRef.current = window.setTimeout(() => setToast(''), 2600)
  }, [])
  const stopPlayback = useCallback(() => {
    playbackEpochRef.current += 1
    cancelAnimationFrame(animationRef.current)
    const audio = audioRef.current
    if (audio) {
      audio.pause()
      playbackClockRef.current.stop(audio.currentTime * 1000)
    }
    setIsPlaying(false)
  }, [])
  const replaceAudioUrl = useCallback((url: string, revoke = false) => {
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current)
    objectUrlRef.current = revoke ? url : ''
    setAudioUrl(url)
  }, [])
  const replaceBackgroundUrl = useCallback((url: string, revoke = false) => {
    if (backgroundObjectUrlRef.current) URL.revokeObjectURL(backgroundObjectUrlRef.current)
    backgroundObjectUrlRef.current = revoke ? url : ''
    setBackgroundUrl(url)
  }, [])
  const resetSession = useCallback((loaded: Chart, url = '', background = '', cover = '') => {
    stopPlayback(); setChart(loaded); setHistory([]); setFuture([]); setCurrentTimeState(0)
    replaceAudioUrl(url, url.startsWith('blob:')); replaceBackgroundUrl(background, background.startsWith('blob:')); setCoverUrl(cover)
  }, [replaceAudioUrl, replaceBackgroundUrl, stopPlayback])

  const updateSummary = useCallback((item: ChartLibraryItem, preserveCover = true) => {
    setCharts((items) => {
      const existing = items.find((candidate) => candidate.id === item.id)
      const next = preserveCover && !item.coverUrl && existing?.coverUrl ? { ...item, coverUrl: existing.coverUrl } : item
      return [next, ...items.filter((candidate) => candidate.id !== item.id)].sort((a, b) => b.updatedAt - a.updatedAt)
    })
  }, [])
  const persistSnapshot = useCallback((id: string, snapshot: Chart, assets: { audio?: Blob; background?: Blob | null; cover?: Blob | null; coverUrl?: string } = {}) => {
    if (!id) return Promise.resolve(false)
    setStorageStatus('saving')
    const operation = async () => {
      if (deletedIdsRef.current.has(id)) return false
      const item = window.moonweave
        ? await window.moonweave.writeChart(id, snapshot)
        : webSummary(id, snapshot, (await writeWebChart(id, snapshot, { audio: assets.audio, background: assets.background, cover: assets.cover })).updatedAt, assets.coverUrl)
      updateSummary(item, window.moonweave ? false : assets.cover === undefined); setStorageStatus('saved'); return true
    }
    const queued = writeQueueRef.current.then(operation, operation).catch((error) => {
      setStorageStatus('error'); showToast(error instanceof Error ? error.message : '谱面保存失败'); return false
    })
    writeQueueRef.current = queued
    return queued
  }, [showToast, updateSummary])
  const flushActiveChart = useCallback(() => persistSnapshot(activeIdRef.current, chartRef.current), [persistSnapshot])
  const migrateLegacyPreferences = useCallback((input: unknown) => {
    setPreferences((current) => migrateLegacyChartPreferences(current, input))
  }, [setPreferences])

  const readManagedChart = useCallback(async (id: string) => {
    if (window.moonweave) {
      const record = await window.moonweave.readChart(id)
      if (!record) return null
      migrateLegacyPreferences(record.chart)
      return { chart: normalizeChart(record.chart), audioUrl: record.audioUrl, backgroundUrl: record.backgroundUrl, coverUrl: record.coverUrl }
    }
    const record = await readWebChart(id)
    if (!record) return null
    migrateLegacyPreferences(record.chart)
    return {
      chart: normalizeChart(record.chart),
      audioUrl: record.audio ? URL.createObjectURL(record.audio) : '',
      backgroundUrl: record.background ? URL.createObjectURL(record.background) : '',
      coverUrl: record.cover ? webCoverUrlsRef.current.get(id) || (() => { const url = URL.createObjectURL(record.cover); webCoverUrlsRef.current.set(id, url); return url })() : '',
    }
  }, [migrateLegacyPreferences])

  const readChartForExport = useCallback(async (id: string) => {
    if (window.moonweave) {
      const record = await window.moonweave.readChart(id)
      return record ? normalizeChart(record.chart) : null
    }
    const record = await readWebChart(id)
    return record ? normalizeChart(record.chart) : null
  }, [])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const items: ChartLibraryItem[] = window.moonweave
          ? await window.moonweave.listCharts()
          : (await listWebCharts()).map((record) => {
            const cover = record.cover ? URL.createObjectURL(record.cover) : ''
            if (cover) webCoverUrlsRef.current.set(record.id, cover)
            return webSummary(record.id, normalizeChart(record.chart), record.updatedAt, cover)
          }).sort((a, b) => b.updatedAt - a.updatedAt)
        if (cancelled) return
        setCharts(items)
        if (items.length) {
          const record = await readManagedChart(items[0].id)
          if (!record || cancelled) return
          setActiveChartId(items[0].id); resetSession(record.chart, record.audioUrl, record.backgroundUrl, record.coverUrl)
        }
        setLibraryReady(true); setStorageStatus('saved')
      } catch (error) {
        if (!cancelled) { setStorageStatus('error'); showToast(error instanceof Error ? error.message : '谱面库初始化失败') }
      }
    })()
    return () => { cancelled = true }
  }, [readManagedChart, resetSession, showToast])

  useEffect(() => {
    if (!libraryReady || !activeChartId) return
    setStorageStatus('saving')
    const timer = window.setTimeout(() => { void persistSnapshot(activeChartId, chart) }, 550)
    return () => window.clearTimeout(timer)
  }, [activeChartId, chart, libraryReady, persistSnapshot])

  const selectChart = useCallback(async (id: string) => {
    if (!id) return false
    if (id === activeIdRef.current) return true
    await flushActiveChart()
    const record = await readManagedChart(id)
    if (!record) { showToast('找不到这份谱面'); return false }
    setActiveChartId(id); resetSession(record.chart, record.audioUrl, record.backgroundUrl, record.coverUrl)
    return true
  }, [flushActiveChart, readManagedChart, resetSession, showToast])
  const createChart = useCallback(async () => {
    await flushActiveChart()
    const id = crypto.randomUUID(); const created = freshChart()
    if (!await persistSnapshot(id, created)) return null
    setActiveChartId(id); resetSession(created); showToast('已新建谱面')
    return id
  }, [flushActiveChart, persistSnapshot, resetSession, showToast])
  const deleteChart = useCallback(async (id: string) => {
    deletedIdsRef.current.add(id)
    await writeQueueRef.current
    if (window.moonweave) await window.moonweave.deleteChart(id)
    else {
      await deleteWebChart(id)
      const cover = webCoverUrlsRef.current.get(id)
      if (cover) URL.revokeObjectURL(cover)
      webCoverUrlsRef.current.delete(id)
    }
    const remaining = charts.filter((item) => item.id !== id)
    setCharts(remaining)
    if (id !== activeIdRef.current) { showToast('谱面已删除'); return true }
    if (remaining.length) {
      const record = await readManagedChart(remaining[0].id)
      if (record) { setActiveChartId(remaining[0].id); resetSession(record.chart, record.audioUrl, record.backgroundUrl, record.coverUrl) }
      else { setActiveChartId(''); resetSession(freshChart()) }
    } else { setActiveChartId(''); resetSession(freshChart()) }
    setStorageStatus('saved')
    showToast('谱面及其内部媒体已删除')
    return true
  }, [charts, readManagedChart, resetSession, showToast])

  const chooseAudio = useCallback(async () => {
    const id = activeIdRef.current
    if (!id) return
    if (window.moonweave) {
      const result = await window.moonweave.chooseAudio(id)
      if (!result) return
      const next = { ...chartRef.current, audioPath: result.audioPath, audioName: result.name }
      setChart(next); replaceAudioUrl(result.url); setCurrentTimeState(0); await persistSnapshot(id, next); showToast('音频已复制到应用内部')
      return
    }
    const [file] = await chooseLocalFiles('audio/*,.flac,.m4a')
    if (!file) return
    const next = { ...chartRef.current, audioPath: 'indexeddb', audioName: file.name }
    const url = URL.createObjectURL(file)
    setChart(next); replaceAudioUrl(url, true); setCurrentTimeState(0); await persistSnapshot(id, next, { audio: file }); showToast('音频已保存到浏览器谱面库')
  }, [persistSnapshot, replaceAudioUrl, showToast])

  const chooseBackground = useCallback(async () => {
    const id = activeIdRef.current
    if (!id) return
    if (window.moonweave) {
      const result = await window.moonweave.chooseBackground(id)
      if (!result) return
      const next = { ...chartRef.current, backgroundPath: result.backgroundPath, backgroundName: result.name, backgroundType: result.backgroundType, backgroundVideoStartTime: 0 }
      setChart(next); replaceBackgroundUrl(result.url); await persistSnapshot(id, next); showToast('背景媒体已复制到应用内部')
      return
    }
    const [file] = await chooseLocalFiles('image/png,image/jpeg,image/webp,image/avif,video/mp4,video/webm')
    if (!file) return
    const backgroundType = file.type.startsWith('video/') || /\.(mp4|webm)$/i.test(file.name) ? 'video' as const : 'image' as const
    const next = { ...chartRef.current, backgroundPath: 'indexeddb', backgroundName: file.name, backgroundType, backgroundVideoStartTime: 0 }
    const url = URL.createObjectURL(file)
    setChart(next); replaceBackgroundUrl(url, true); await persistSnapshot(id, next, { background: file }); showToast('背景媒体已保存到浏览器谱面库')
  }, [persistSnapshot, replaceBackgroundUrl, showToast])

  const removeBackground = useCallback(async () => {
    const id = activeIdRef.current
    if (!id) return
    if (window.moonweave) await window.moonweave.removeBackground(id)
    const next = { ...chartRef.current, backgroundPath: '', backgroundName: '', backgroundType: '' as const, backgroundVideoStartTime: 0 }
    setChart(next); replaceBackgroundUrl(''); await persistSnapshot(id, next, window.moonweave ? {} : { background: null }); showToast('已恢复默认试玩背景')
  }, [persistSnapshot, replaceBackgroundUrl, showToast])

  const chooseCover = useCallback(async () => {
    const id = activeIdRef.current
    if (!id) return
    if (window.moonweave) {
      const result = await window.moonweave.chooseCover(id)
      if (!result) return
      const next = { ...chartRef.current, coverPath: result.coverPath, coverName: result.name }
      setChart(next); setCoverUrl(result.url); await persistSnapshot(id, next); showToast('曲目封面已保存到应用内部')
      return
    }
    const [file] = await chooseLocalFiles('image/png,image/jpeg,image/webp,image/avif')
    if (!file) return
    const previousUrl = webCoverUrlsRef.current.get(id)
    if (previousUrl) URL.revokeObjectURL(previousUrl)
    const url = URL.createObjectURL(file)
    webCoverUrlsRef.current.set(id, url)
    const next = { ...chartRef.current, coverPath: 'indexeddb', coverName: file.name }
    setChart(next); setCoverUrl(url); await persistSnapshot(id, next, { cover: file, coverUrl: url }); showToast('曲目封面已保存到浏览器谱面库')
  }, [persistSnapshot, showToast])

  const removeCover = useCallback(async () => {
    const id = activeIdRef.current
    if (!id) return
    if (window.moonweave) await window.moonweave.removeCover(id)
    else {
      const url = webCoverUrlsRef.current.get(id)
      if (url) URL.revokeObjectURL(url)
      webCoverUrlsRef.current.delete(id)
    }
    const next = { ...chartRef.current, coverPath: '', coverName: '' }
    setChart(next); setCoverUrl(''); await persistSnapshot(id, next, window.moonweave ? {} : { cover: null, coverUrl: '' }); showToast('已移除曲目封面')
  }, [persistSnapshot, showToast])

  const exportChart = useCallback(async (id: string) => {
    if (!id) return false
    let exportedChart: Chart
    if (id === activeIdRef.current) {
      if (!await flushActiveChart()) return false
      exportedChart = chartRef.current
    } else {
      const storedChart = await readChartForExport(id)
      if (!storedChart) { showToast('找不到这份谱面'); return false }
      exportedChart = storedChart
    }
    if (window.moonweave) {
      const target = await window.moonweave.exportChart({ id, chart: exportedChart })
      if (target) showToast('谱面已导出；关联媒体也已复制到同一目录')
      return Boolean(target)
    }
    const record = await readWebChart(id)
    if (!record) { showToast('找不到这份谱面'); return false }
    const assets: Parameters<typeof createChartPackage>[1] = {}
    if (record.audio) assets.audio = { data: new Uint8Array(await record.audio.arrayBuffer()), name: exportedChart.audioName || 'audio.mp3' }
    if (record.background) assets.background = { data: new Uint8Array(await record.background.arrayBuffer()), name: exportedChart.backgroundName || 'background.png' }
    if (record.cover) assets.cover = { data: new Uint8Array(await record.cover.arrayBuffer()), name: exportedChart.coverName || 'cover.png' }
    const packageBytes = await createChartPackage(exportedChart, assets)
    const blob = new Blob([packageBytes.slice().buffer as ArrayBuffer], { type: 'application/vnd.moonweave.chart+zip' })
    const url = URL.createObjectURL(blob); const anchor = document.createElement('a')
    anchor.href = url; anchor.download = `${exportedChart.title.replace(/[<>:\"/\\|?*]/g, '_')}.mwchart`; anchor.click()
    URL.revokeObjectURL(url); showToast('谱面资源包已导出')
    return true
  }, [flushActiveChart, readChartForExport, showToast])

  const importChart = useCallback(async () => {
    await flushActiveChart()
    try {
      if (window.moonweave) {
        const record = await window.moonweave.importChart()
        if (!record) return null
        migrateLegacyPreferences(record.chart)
        const loaded = normalizeChart(record.chart)
        setActiveChartId(record.id); resetSession(loaded, record.audioUrl, record.backgroundUrl, record.coverUrl)
        updateSummary(webSummary(record.id, loaded, record.updatedAt, record.coverUrl), false); showToast('谱面资源已导入内部谱面库')
        return record.id
      }
      const files = await chooseLocalFiles('.mwchart,application/json,.json,audio/*,.flac,.m4a,image/png,image/jpeg,image/webp,image/avif,video/mp4,video/webm', true)
      const packageFile = files.find((file) => file.name.toLowerCase().endsWith('.mwchart'))
      if (packageFile) {
        const packaged = await readChartPackage(new Uint8Array(await packageFile.arrayBuffer()))
        const loaded = normalizeChart(packaged.chart)
        const audio = packaged.assets.audio ? packagedAssetBlob(packaged.assets.audio) : undefined
        const background = packaged.assets.background ? packagedAssetBlob(packaged.assets.background) : undefined
        const cover = packaged.assets.cover ? packagedAssetBlob(packaged.assets.cover) : undefined
        loaded.audioPath = audio ? 'indexeddb' : ''; loaded.audioName = packaged.assets.audio?.name ?? ''
        loaded.backgroundPath = background ? 'indexeddb' : ''; loaded.backgroundName = packaged.assets.background?.name ?? ''
        loaded.backgroundType = background ? /\.(mp4|webm)$/i.test(loaded.backgroundName) ? 'video' : 'image' : ''
        loaded.coverPath = cover ? 'indexeddb' : ''; loaded.coverName = packaged.assets.cover?.name ?? ''
        const id = crypto.randomUUID()
        const importedCoverUrl = cover ? URL.createObjectURL(cover) : ''
        if (importedCoverUrl) webCoverUrlsRef.current.set(id, importedCoverUrl)
        if (!await persistSnapshot(id, loaded, { audio, background, cover, coverUrl: importedCoverUrl })) return null
        setActiveChartId(id); resetSession(loaded, audio ? URL.createObjectURL(audio) : '', background ? URL.createObjectURL(background) : '', importedCoverUrl)
        showToast('谱面资源包已导入浏览器谱面库')
        return id
      }
      const json = files.find((file) => file.name.toLowerCase().endsWith('.json'))
      if (!json) return null
      const imported = JSON.parse(await json.text())
      migrateLegacyPreferences(imported)
      const loaded = normalizeChart(imported)
      const expected = (loaded.audioName || loaded.audioPath.split(/[\\/]/).pop() || '').toLowerCase()
      const audio = files.find((file) => file !== json && (file.type.startsWith('audio/') || file.name.toLowerCase() === expected))
      const expectedBackground = (loaded.backgroundName || loaded.backgroundPath.split(/[\\/]/).pop() || '').toLowerCase()
      const expectedCover = (loaded.coverName || loaded.coverPath.split(/[\\/]/).pop() || '').toLowerCase()
      const supportedBackgroundTypes = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/avif', 'video/mp4', 'video/webm'])
      const hasSupportedBackgroundExtension = (file: File) => /\.(png|jpe?g|webp|avif|mp4|webm)$/i.test(file.name)
      const backgroundFiles = files.filter((file) => file !== json && (supportedBackgroundTypes.has(file.type) || hasSupportedBackgroundExtension(file)))
      const cover = backgroundFiles.find((file) => expectedCover && file.name.toLowerCase() === expectedCover)
      const background = backgroundFiles.find((file) => expectedBackground && file.name.toLowerCase() === expectedBackground) ?? backgroundFiles.find((file) => file !== cover)
      loaded.audioPath = audio ? 'indexeddb' : ''; if (audio) loaded.audioName = audio.name
      loaded.backgroundPath = background ? 'indexeddb' : ''
      if (background) { loaded.backgroundName = background.name; loaded.backgroundType = background.type.startsWith('video/') || /\.(mp4|webm)$/i.test(background.name) ? 'video' : 'image' }
      else { loaded.backgroundName = ''; loaded.backgroundType = '' }
      loaded.coverPath = cover ? 'indexeddb' : ''; loaded.coverName = cover?.name ?? ''
      const id = crypto.randomUUID()
      const importedCoverUrl = cover ? URL.createObjectURL(cover) : ''
      if (importedCoverUrl) webCoverUrlsRef.current.set(id, importedCoverUrl)
      if (!await persistSnapshot(id, loaded, { audio, background, cover, coverUrl: importedCoverUrl })) return null
      setActiveChartId(id); resetSession(loaded, audio ? URL.createObjectURL(audio) : '', background ? URL.createObjectURL(background) : '', importedCoverUrl)
      showToast(audio || background || cover ? '谱面与所选媒体已导入浏览器谱面库' : '谱面已导入；可继续上传媒体')
      return id
    } catch (error) { showToast(error instanceof Error ? error.message : '谱面文件格式无效'); return null }
  }, [flushActiveChart, migrateLegacyPreferences, persistSnapshot, resetSession, showToast, updateSummary])

  const revealLibrary = useCallback(async () => {
    if (window.moonweave) { await window.moonweave.revealLibrary(); return }
    showToast('网页谱面保存在当前站点的浏览器 IndexedDB 中')
  }, [showToast])

  const setCurrentTime = useCallback((time: number) => {
    const value = clamp(time, 0, chartRef.current.duration)
    setCurrentTimeState(value)
    const audio = audioRef.current
    if (!audio) return
    audio.currentTime = value / 1000
    if (audio.paused) playbackClockRef.current.reset(value)
    else playbackClockRef.current.start(value, performance.now(), audio.playbackRate)
  }, [])
  const commitNotes = useCallback((notes: ChartNote[]) => {
    setChart((previous) => {
      setHistory((items) => [...items.slice(-79), previous.notes]); setFuture([])
      return { ...previous, notes: [...notes].sort((a, b) => a.time - b.time) }
    })
  }, [])
  const undo = useCallback(() => setHistory((items) => {
    if (!items.length) return items
    const previous = items[items.length - 1]
    setChart((current) => { setFuture((next) => [current.notes, ...next]); return { ...current, notes: previous } })
    return items.slice(0, -1)
  }), [])
  const redo = useCallback(() => setFuture((items) => {
    if (!items.length) return items
    const next = items[0]
    setChart((current) => { setHistory((previous) => [...previous, current.notes]); return { ...current, notes: next } })
    return items.slice(1)
  }), [])
  const tick = useCallback(() => {
    const audio = audioRef.current
    if (!audio || audio.paused || audio.ended) return
    const time = playbackClockRef.current.getTime(audio.currentTime * 1000)
    setCurrentTimeState(clamp(time, 0, chartRef.current.duration))
    animationRef.current = requestAnimationFrame(tick)
  }, [])
  const togglePlay = useCallback((playbackRate: number, subdivision: number) => {
    const epoch = playbackEpochRef.current
    const toggle = async () => {
      if (epoch !== playbackEpochRef.current) return
      const audio = audioRef.current
      if (!audioUrl || !audio) { showToast('请先在编辑器右侧的谱面信息中选择歌曲音频'); return }
      if (!audio.paused && !audio.ended) {
        audio.pause()
        cancelAnimationFrame(animationRef.current)
        const currentChart = chartRef.current
        const value = snapToBeatLine(currentChart, audio.currentTime * 1000, subdivision)
        audio.currentTime = value / 1000
        playbackClockRef.current.stop(value)
        setCurrentTimeState(value)
        setIsPlaying(false)
        return
      }

      audio.playbackRate = playbackRate
      try {
        await audio.play()
        if (epoch !== playbackEpochRef.current || audio.paused) return
        cancelAnimationFrame(animationRef.current)
        playbackClockRef.current.start(audio.currentTime * 1000, performance.now(), audio.playbackRate)
        setIsPlaying(true)
        animationRef.current = requestAnimationFrame(tick)
      } catch {
        setIsPlaying(false)
        showToast('音频无法播放，请重新选择文件')
      }
    }
    const queued = playbackQueueRef.current.then(toggle, toggle)
    playbackQueueRef.current = queued.catch(() => undefined)
    return queued
  }, [audioUrl, showToast, tick])

  useEffect(() => () => {
    cancelAnimationFrame(animationRef.current); window.clearTimeout(toastTimerRef.current)
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current)
    if (backgroundObjectUrlRef.current) URL.revokeObjectURL(backgroundObjectUrlRef.current)
    for (const url of webCoverUrlsRef.current.values()) URL.revokeObjectURL(url)
    webCoverUrlsRef.current.clear()
  }, [])
  const value = useMemo<ChartContextValue>(() => ({
    chart, setChart, activeChartId, charts, libraryReady, storageStatus, audioUrl, backgroundUrl, coverUrl, audioRef, currentTime, isPlaying,
    historyLength: history.length, futureLength: future.length, toast,
    setCurrentTime, commitNotes, undo, redo, chooseAudio, chooseBackground, removeBackground, chooseCover, removeCover, flushActiveChart, importChart, exportChart, createChart, selectChart, deleteChart, revealLibrary, togglePlay, showToast,
  }), [chart, activeChartId, charts, libraryReady, storageStatus, audioUrl, backgroundUrl, coverUrl, currentTime, isPlaying, history.length, future.length, toast, setCurrentTime, commitNotes, undo, redo, chooseAudio, chooseBackground, removeBackground, chooseCover, removeCover, flushActiveChart, importChart, exportChart, createChart, selectChart, deleteChart, revealLibrary, togglePlay, showToast])
  return <ChartContext.Provider value={value}>
    <audio ref={audioRef} src={audioUrl || undefined} preload="auto" onLoadedMetadata={(event) => {
      const duration = event.currentTarget.duration * 1000
      if (Number.isFinite(duration)) setChart((current) => ({ ...current, duration }))
    }} onError={(event) => {
      const failedUrl = event.currentTarget.currentSrc
      if (!failedUrl) return
      window.setTimeout(() => {
        const audio = audioRef.current
        if (!audio?.error || audio.currentSrc !== failedUrl) return
        setAudioUrl((current) => {
          if (!current || new URL(current, window.location.href).href !== failedUrl) return current
          showToast('内部音频已不可用，请重新上传'); return ''
        })
      }, 0)
    }} onPlay={() => setIsPlaying(true)} onPause={(event) => {
      cancelAnimationFrame(animationRef.current)
      playbackClockRef.current.stop(event.currentTarget.currentTime * 1000)
      setIsPlaying(false)
    }} onEnded={() => {
      playbackClockRef.current.stop(chart.duration)
      setIsPlaying(false); setCurrentTimeState(chart.duration); cancelAnimationFrame(animationRef.current)
    }} />
    {children}
    {toast && <div className="chart-toast" role="status">{toast}</div>}
  </ChartContext.Provider>
}

export function useChart() {
  const value = useContext(ChartContext)
  if (!value) throw new Error('useChart must be used inside ChartProvider')
  return value
}
