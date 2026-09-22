import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { migrateLegacyChartPreferences, usePreferences } from '@/app/preferences'
import type { ChartLibraryItem } from '@/shared/electron'
import { PlaybackClock } from '@/features/playtest/PlaybackClock'
import { deleteWebChart, listWebCharts, readWebChart, writeWebChart } from './webLibrary'
import { DEFAULT_CHART, normalizeChart, type Chart, type ChartNote } from './types'
import { snapToBeatLine } from './tempoMap'

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))
const freshChart = () => normalizeChart(DEFAULT_CHART)
const webSummary = (id: string, chart: Chart, updatedAt: number): ChartLibraryItem => ({
  id, title: chart.title, artist: chart.artist, audioName: chart.audioName, noteCount: chart.notes.length, updatedAt,
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
  saveChart(): Promise<void>
  loadChart(): Promise<void>
  createChart(): Promise<void>
  selectChart(id: string): Promise<void>
  deleteChart(id: string): Promise<void>
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
  const [currentTime, setCurrentTimeState] = useState(0)
  const [isPlaying, setIsPlaying] = useState(false)
  const [history, setHistory] = useState<ChartNote[][]>([])
  const [future, setFuture] = useState<ChartNote[][]>([])
  const [toast, setToast] = useState('')
  const audioRef = useRef<HTMLAudioElement>(null)
  const objectUrlRef = useRef('')
  const backgroundObjectUrlRef = useRef('')
  const animationRef = useRef(0)
  const playbackClockRef = useRef(new PlaybackClock())
  const playbackQueueRef = useRef<Promise<void>>(Promise.resolve())
  const playbackEpochRef = useRef(0)
  const toastTimerRef = useRef(0)
  const chartRef = useRef(chart)
  const activeIdRef = useRef(activeChartId)
  const writeQueueRef = useRef(Promise.resolve())
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
  const resetSession = useCallback((loaded: Chart, url = '', background = '') => {
    stopPlayback(); setChart(loaded); setHistory([]); setFuture([]); setCurrentTimeState(0)
    replaceAudioUrl(url, url.startsWith('blob:')); replaceBackgroundUrl(background, background.startsWith('blob:'))
  }, [replaceAudioUrl, replaceBackgroundUrl, stopPlayback])

  const updateSummary = useCallback((item: ChartLibraryItem) => {
    setCharts((items) => [item, ...items.filter((candidate) => candidate.id !== item.id)].sort((a, b) => b.updatedAt - a.updatedAt))
  }, [])
  const persistSnapshot = useCallback((id: string, snapshot: Chart, assets: { audio?: Blob; background?: Blob | null } = {}) => {
    if (!id) return Promise.resolve()
    setStorageStatus('saving')
    const operation = async () => {
      if (deletedIdsRef.current.has(id)) return
      const item = window.moonweave
        ? await window.moonweave.writeChart(id, snapshot)
        : webSummary(id, snapshot, (await writeWebChart(id, snapshot, assets)).updatedAt)
      updateSummary(item); setStorageStatus('saved')
    }
    const queued = writeQueueRef.current.then(operation, operation).catch((error) => {
      setStorageStatus('error'); showToast(error instanceof Error ? error.message : '谱面保存失败')
    })
    writeQueueRef.current = queued
    return queued
  }, [showToast, updateSummary])
  const flushActive = useCallback(() => persistSnapshot(activeIdRef.current, chartRef.current), [persistSnapshot])
  const migrateLegacyPreferences = useCallback((input: unknown) => {
    setPreferences((current) => migrateLegacyChartPreferences(current, input))
  }, [setPreferences])

  const readManagedChart = useCallback(async (id: string) => {
    if (window.moonweave) {
      const record = await window.moonweave.readChart(id)
      if (!record) return null
      migrateLegacyPreferences(record.chart)
      return { chart: normalizeChart(record.chart), audioUrl: record.audioUrl, backgroundUrl: record.backgroundUrl }
    }
    const record = await readWebChart(id)
    if (!record) return null
    migrateLegacyPreferences(record.chart)
    return {
      chart: normalizeChart(record.chart),
      audioUrl: record.audio ? URL.createObjectURL(record.audio) : '',
      backgroundUrl: record.background ? URL.createObjectURL(record.background) : '',
    }
  }, [migrateLegacyPreferences])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        let items: ChartLibraryItem[] = window.moonweave
          ? await window.moonweave.listCharts()
          : (await listWebCharts()).map((record) => webSummary(record.id, normalizeChart(record.chart), record.updatedAt)).sort((a, b) => b.updatedAt - a.updatedAt)
        if (cancelled) return
        if (!items.length) {
          const id = crypto.randomUUID(); const initial = freshChart()
          await persistSnapshot(id, initial)
          items = [webSummary(id, initial, Date.now())]
        }
        const record = await readManagedChart(items[0].id)
        if (!record || cancelled) return
        setCharts(items); setActiveChartId(items[0].id); resetSession(record.chart, record.audioUrl, record.backgroundUrl); setLibraryReady(true); setStorageStatus('saved')
      } catch (error) {
        if (!cancelled) { setStorageStatus('error'); showToast(error instanceof Error ? error.message : '谱面库初始化失败') }
      }
    })()
    return () => { cancelled = true }
  }, [persistSnapshot, readManagedChart, resetSession, showToast])

  useEffect(() => {
    if (!libraryReady || !activeChartId) return
    setStorageStatus('saving')
    const timer = window.setTimeout(() => { void persistSnapshot(activeChartId, chart) }, 550)
    return () => window.clearTimeout(timer)
  }, [activeChartId, chart, libraryReady, persistSnapshot])

  const selectChart = useCallback(async (id: string) => {
    if (!id || id === activeIdRef.current) return
    await flushActive()
    const record = await readManagedChart(id)
    if (!record) { showToast('找不到这份谱面'); return }
    setActiveChartId(id); resetSession(record.chart, record.audioUrl, record.backgroundUrl)
  }, [flushActive, readManagedChart, resetSession, showToast])
  const createChart = useCallback(async () => {
    await flushActive()
    const id = crypto.randomUUID(); const created = freshChart()
    await persistSnapshot(id, created)
    setActiveChartId(id); resetSession(created); showToast('已新建谱面')
  }, [flushActive, persistSnapshot, resetSession, showToast])
  const deleteChart = useCallback(async (id: string) => {
    deletedIdsRef.current.add(id)
    await writeQueueRef.current
    if (window.moonweave) await window.moonweave.deleteChart(id)
    else await deleteWebChart(id)
    const remaining = charts.filter((item) => item.id !== id)
    setCharts(remaining)
    if (id !== activeIdRef.current) { showToast('谱面已删除'); return }
    if (remaining.length) {
      const record = await readManagedChart(remaining[0].id)
      if (record) { setActiveChartId(remaining[0].id); resetSession(record.chart, record.audioUrl, record.backgroundUrl) }
    } else {
      const nextId = crypto.randomUUID(); const created = freshChart()
      await persistSnapshot(nextId, created); setActiveChartId(nextId); resetSession(created)
    }
    showToast('谱面及其内部媒体已删除')
  }, [charts, persistSnapshot, readManagedChart, resetSession, showToast])

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
      const next = { ...chartRef.current, backgroundPath: result.backgroundPath, backgroundName: result.name, backgroundType: result.backgroundType }
      setChart(next); replaceBackgroundUrl(result.url); await persistSnapshot(id, next); showToast('背景媒体已复制到应用内部')
      return
    }
    const [file] = await chooseLocalFiles('image/png,image/jpeg,image/webp,image/avif,video/mp4,video/webm')
    if (!file) return
    const backgroundType = file.type.startsWith('video/') || /\.(mp4|webm)$/i.test(file.name) ? 'video' as const : 'image' as const
    const next = { ...chartRef.current, backgroundPath: 'indexeddb', backgroundName: file.name, backgroundType }
    const url = URL.createObjectURL(file)
    setChart(next); replaceBackgroundUrl(url, true); await persistSnapshot(id, next, { background: file }); showToast('背景媒体已保存到浏览器谱面库')
  }, [persistSnapshot, replaceBackgroundUrl, showToast])

  const removeBackground = useCallback(async () => {
    const id = activeIdRef.current
    if (!id) return
    if (window.moonweave) await window.moonweave.removeBackground(id)
    const next = { ...chartRef.current, backgroundPath: '', backgroundName: '', backgroundType: '' as const }
    setChart(next); replaceBackgroundUrl(''); await persistSnapshot(id, next, window.moonweave ? {} : { background: null }); showToast('已恢复默认试玩背景')
  }, [persistSnapshot, replaceBackgroundUrl, showToast])

  const saveChart = useCallback(async () => {
    await flushActive()
    if (window.moonweave) {
      const target = await window.moonweave.exportChart({ id: activeIdRef.current, chart: chartRef.current })
      if (target) showToast('谱面已导出；关联媒体也已复制到同一目录')
      return
    }
    const blob = new Blob([JSON.stringify(chartRef.current, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob); const anchor = document.createElement('a')
    anchor.href = url; anchor.download = `${chartRef.current.title.replace(/[<>:\"/\\|?*]/g, '_')}.moon.json`; anchor.click()
    URL.revokeObjectURL(url); showToast('谱面 JSON 已导出')
  }, [flushActive, showToast])

  const loadChart = useCallback(async () => {
    await flushActive()
    try {
      if (window.moonweave) {
        const record = await window.moonweave.importChart()
        if (!record) return
        migrateLegacyPreferences(record.chart)
        const loaded = normalizeChart(record.chart)
        setActiveChartId(record.id); resetSession(loaded, record.audioUrl, record.backgroundUrl)
        updateSummary(webSummary(record.id, loaded, record.updatedAt)); showToast(record.audioUrl ? '谱面与音频已导入内部谱面库' : '谱面已导入内部谱面库')
        return
      }
      const files = await chooseLocalFiles('application/json,.json,audio/*,.flac,.m4a,image/png,image/jpeg,image/webp,image/avif,video/mp4,video/webm', true)
      const json = files.find((file) => file.name.toLowerCase().endsWith('.json'))
      if (!json) return
      const imported = JSON.parse(await json.text())
      migrateLegacyPreferences(imported)
      const loaded = normalizeChart(imported)
      const expected = (loaded.audioName || loaded.audioPath.split(/[\\/]/).pop() || '').toLowerCase()
      const audio = files.find((file) => file !== json && (file.type.startsWith('audio/') || file.name.toLowerCase() === expected))
      const expectedBackground = (loaded.backgroundName || loaded.backgroundPath.split(/[\\/]/).pop() || '').toLowerCase()
      const supportedBackgroundTypes = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/avif', 'video/mp4', 'video/webm'])
      const hasSupportedBackgroundExtension = (file: File) => /\.(png|jpe?g|webp|avif|mp4|webm)$/i.test(file.name)
      const backgroundFiles = files.filter((file) => file !== json && (supportedBackgroundTypes.has(file.type) || hasSupportedBackgroundExtension(file)))
      const background = backgroundFiles.find((file) => expectedBackground && file.name.toLowerCase() === expectedBackground) ?? backgroundFiles[0]
      loaded.audioPath = audio ? 'indexeddb' : ''; if (audio) loaded.audioName = audio.name
      loaded.backgroundPath = background ? 'indexeddb' : ''
      if (background) { loaded.backgroundName = background.name; loaded.backgroundType = background.type.startsWith('video/') || /\.(mp4|webm)$/i.test(background.name) ? 'video' : 'image' }
      else { loaded.backgroundName = ''; loaded.backgroundType = '' }
      const id = crypto.randomUUID(); await persistSnapshot(id, loaded, { audio, background })
      setActiveChartId(id); resetSession(loaded, audio ? URL.createObjectURL(audio) : '', background ? URL.createObjectURL(background) : '')
      showToast(audio || background ? '谱面与所选媒体已导入浏览器谱面库' : '谱面已导入；可继续上传媒体')
    } catch (error) { showToast(error instanceof Error ? error.message : '谱面文件格式无效') }
  }, [flushActive, migrateLegacyPreferences, persistSnapshot, resetSession, showToast, updateSummary])

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
  }, [])
  const value = useMemo<ChartContextValue>(() => ({
    chart, setChart, activeChartId, charts, libraryReady, storageStatus, audioUrl, backgroundUrl, audioRef, currentTime, isPlaying,
    historyLength: history.length, futureLength: future.length, toast,
    setCurrentTime, commitNotes, undo, redo, chooseAudio, chooseBackground, removeBackground, saveChart, loadChart, createChart, selectChart, deleteChart, revealLibrary, togglePlay, showToast,
  }), [chart, activeChartId, charts, libraryReady, storageStatus, audioUrl, backgroundUrl, currentTime, isPlaying, history.length, future.length, toast, setCurrentTime, commitNotes, undo, redo, chooseAudio, chooseBackground, removeBackground, saveChart, loadChart, createChart, selectChart, deleteChart, revealLibrary, togglePlay, showToast])
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
