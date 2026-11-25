import { chooseDifficulty, emptyDifficultyTrack, libraryMetadata, newChartMetadata, tiers, totalNotes } from './libraryMetadata'
import { GameToast } from '@/components/ui/game-controls'
import { editSnapshot, restoreEdit, type EditSnapshot } from './editHistory'
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { migrateLegacyChartPreferences, usePreferences } from '@/app/preferences'
import type { ChartInfoMedia, ChartLibraryItem } from '@/shared/electron'
import { PlaybackClock } from '@/features/playtest/PlaybackClock'
import { deleteWebChart, listWebCharts, readWebChart, writeWebChart } from './webLibrary'
import { createChartPackage, readChartPackage } from './chartPackage'
import { DEFAULT_CHART, normalizeManagedChart, type Chart, type ChartNote } from './types'
import { snapToBeatLine } from './tempoMap'
import { BpmDetectionDialog } from './BpmDetectionDialog'
import { cacheEditorAudio } from './editorAudio'
import { bpmDetectionCopy } from '@/config/app'
import type { BpmFailureReason } from './detectBpm'
import { applyAiPlan, type AiPlan } from './ai/aiChart'
import { noteImportIssue } from './noteImport'

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))
const text = (zh: string, en: string) => document.documentElement.lang.startsWith('zh') ? zh : en
const freshChart = () => normalizeManagedChart(DEFAULT_CHART)
const packagedAssetBlob = (asset: { data: Uint8Array; name: string }) => {
  const extension = asset.name.split('.').pop()?.toLowerCase() ?? ''
  const type = ({ mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', m4a: 'audio/mp4', flac: 'audio/flac', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', avif: 'image/avif', mp4: 'video/mp4', webm: 'video/webm' } as Record<string, string>)[extension] ?? ''
  return new Blob([asset.data.slice().buffer as ArrayBuffer], { type })
}
const webSummary = (id: string, chart: Chart, updatedAt: number, coverUrl = ''): ChartLibraryItem => {
  const library = libraryMetadata(chart.library)
  return { id, library, title: chart.title, artist: chart.artist, audioName: chart.audioName, noteCount: totalNotes(chart.notes, chart.tracks, library.levels, library.tier), updatedAt, coverUrl }
}

interface ChartContextValue {
  chart: Chart
  improvising: boolean
  setImprovising(value: boolean): void
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
  setPlaybackRate(rate: number): void
  commitNotes(notes: ChartNote[]): void
  importNotes(notes: ChartNote[], chartId: string, tier: number): Promise<'saved' | 'unsaved' | 'stale' | 'duration' | 'duplicate'>
  commitEdit(update: (chart: Chart) => Chart): void
  applyAiImport(plan: AiPlan): Promise<boolean>
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
  inspectAudio(id: string): Promise<string | Blob>
  inspectChart(id: string): Promise<Chart | null>
  saveChartInfo(id: string, chart: Chart, media: ChartInfoMedia): Promise<boolean>
  duplicateChart(id: string): Promise<string | null>
  createChart(initial: Chart, media: ChartInfoMedia): Promise<string | null>
  selectChart(id: string, tier?: number): Promise<boolean>
  deleteChart(id: string): Promise<boolean>
  revealLibrary(): Promise<void>
  togglePlay(playbackRate: number, subdivision: number, signal?: AbortSignal): Promise<void>
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
  const [improvising, setImprovising] = useState(false)
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
  const [history, setHistory] = useState<EditSnapshot[]>([])
  const [future, setFuture] = useState<EditSnapshot[]>([])
  const historyRef = useRef<EditSnapshot[]>([])
  const futureRef = useRef<EditSnapshot[]>([])
  const [messages, setMessages] = useState<{ id: number; text: string }[]>([])
  const toast = messages.at(-1)?.text ?? ''
  const [bpmRequest, setBpmRequest] = useState<{ sequence: number; id: string; url: string } | null>(null)
  const audioImportSequence = useRef(0)
  const audioRef = useRef<HTMLAudioElement>(null)
  const objectUrlRef = useRef('')
  const preparedAudioRef = useRef<ReturnType<typeof cacheEditorAudio> | null>(null)
  const releasePreparedAudio = useCallback(() => {
    const prepared = preparedAudioRef.current
    preparedAudioRef.current = null
    prepared?.dispose()
  }, [])
  const backgroundObjectUrlRef = useRef('')
  const webCoverUrlsRef = useRef(new Map<string, string>())
  const animationRef = useRef(0)
  const playbackClockRef = useRef(new PlaybackClock())
  const mediaWaitingRef = useRef(false)
  const playbackQueueRef = useRef<Promise<void>>(Promise.resolve())
  const playbackEpochRef = useRef(0)
  const toastTimers = useRef(new Set<number>())
  const chartRef = useRef(chart)
  const activeIdRef = useRef(activeChartId)
  const writeQueueRef = useRef<Promise<unknown>>(Promise.resolve())
  const queuedSnapshotRef = useRef<{ id: string; snapshot: Chart } | null>(null)
  const deletedIdsRef = useRef(new Set<string>())
  chartRef.current = chart
  activeIdRef.current = activeChartId

  const showToast = useCallback((message: string) => {
    const id = window.setTimeout(() => {
      toastTimers.current.delete(id)
      setMessages(current => current.filter(entry => entry.id !== id))
    }, 2600)
    toastTimers.current.add(id)
    setMessages(current => [...current.slice(-2), { id, text: message }])
  }, [])
  const stopPlayback = useCallback(() => {
    mediaWaitingRef.current = false
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
    const audio = audioRef.current
    if (audio && preparedAudioRef.current?.url === audio.src) {
      if (url) audio.src = url
      else audio.removeAttribute('src')
    }
    releasePreparedAudio()
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current)
    objectUrlRef.current = revoke ? url : ''
    setAudioUrl(url)
  }, [releasePreparedAudio])
  const replaceBackgroundUrl = useCallback((url: string, revoke = false) => {
    if (backgroundObjectUrlRef.current) URL.revokeObjectURL(backgroundObjectUrlRef.current)
    backgroundObjectUrlRef.current = revoke ? url : ''
    setBackgroundUrl(url)
  }, [])
  const resetSession = useCallback((loaded: Chart, url = '', background = '', cover = '') => {
    audioImportSequence.current += 1; setBpmRequest(null)
    stopPlayback(); chartRef.current = loaded; setChart(loaded); historyRef.current = []; futureRef.current = []; setHistory([]); setFuture([]); setCurrentTimeState(0)
    replaceAudioUrl(url, url.startsWith('blob:')); replaceBackgroundUrl(background, background.startsWith('blob:')); setCoverUrl(cover)
  }, [replaceAudioUrl, replaceBackgroundUrl, stopPlayback])

  const updateSummary = useCallback((item: ChartLibraryItem, preserveCover = true) => {
    setCharts((items) => {
      const existing = items.find((candidate) => candidate.id === item.id)
      const next = preserveCover && !item.coverUrl && existing?.coverUrl ? { ...item, coverUrl: existing.coverUrl } : item
      return [next, ...items.filter((candidate) => candidate.id !== item.id)].sort((a, b) => b.updatedAt - a.updatedAt)
    })
  }, [])
  const queueWrite = useCallback(<T,>(id: string, snapshot: Chart, write: () => Promise<T>) => {
    if (!id) return Promise.resolve(false as const)
    queuedSnapshotRef.current = { id, snapshot }
    setStorageStatus('saving')
    const operation = async () => {
      if (deletedIdsRef.current.has(id)) return false as const
      const result = await write()
      setStorageStatus('saved')
      return result
    }
    const queued = writeQueueRef.current.then(operation, operation).catch((error) => {
      setStorageStatus('error'); showToast(error instanceof Error ? error.message : text('谱面保存失败', 'Failed to save chart')); return false as const
    })
    writeQueueRef.current = queued
    return queued
  }, [showToast])
  const persistSnapshot = useCallback((id: string, snapshot: Chart, assets: { audio?: Blob; background?: Blob | null; cover?: Blob | null; coverUrl?: string } = {}, autosave = false) =>
    queueWrite(id, snapshot, async () => {
      if (autosave && (activeIdRef.current !== id || chartRef.current !== snapshot)) return true
      const item = window.moonweave
        ? await window.moonweave.writeChart(id, snapshot)
        : webSummary(id, snapshot, (await writeWebChart(id, snapshot, assets)).updatedAt, assets.coverUrl)
      updateSummary(item, window.moonweave ? false : assets.cover === undefined)
      return true
    }), [queueWrite, updateSummary])
  const flushActiveChart = useCallback(() => persistSnapshot(activeIdRef.current, chartRef.current), [persistSnapshot])
  const migrateLegacyPreferences = useCallback((input: unknown) => {
    setPreferences((current) => migrateLegacyChartPreferences(current, input))
  }, [setPreferences])

  const readManagedChart = useCallback(async (id: string) => {
    if (window.moonweave) {
      const record = await window.moonweave.readChart(id)
      if (!record) return null
      migrateLegacyPreferences(record.chart)
      return { chart: normalizeManagedChart(record.chart), audioUrl: record.audioUrl, backgroundUrl: record.backgroundUrl, coverUrl: record.coverUrl }
    }
    const record = await readWebChart(id)
    if (!record) return null
    migrateLegacyPreferences(record.chart)
    return {
      chart: normalizeManagedChart(record.chart),
      audioUrl: record.audio ? URL.createObjectURL(record.audio) : '',
      backgroundUrl: record.background ? URL.createObjectURL(record.background) : '',
      coverUrl: record.cover ? webCoverUrlsRef.current.get(id) || (() => { const url = URL.createObjectURL(record.cover); webCoverUrlsRef.current.set(id, url); return url })() : '',
    }
  }, [migrateLegacyPreferences])

  const readChartForExport = useCallback(async (id: string) => {
    if (window.moonweave) {
      const record = await window.moonweave.readChart(id)
      return record ? normalizeManagedChart(record.chart) : null
    }
    const record = await readWebChart(id)
    return record ? normalizeManagedChart(record.chart) : null
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
            return webSummary(record.id, normalizeManagedChart(record.chart), record.updatedAt, cover)
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
        if (!cancelled) { setStorageStatus('error'); showToast(error instanceof Error ? error.message : text('谱面库初始化失败', 'Failed to initialize chart library')) }
      }
    })()
    return () => { cancelled = true }
  }, [readManagedChart, resetSession, showToast])

  useEffect(() => {
    if (!libraryReady || !activeChartId) return
    // Explicit imports/flushes already queued this exact snapshot, including failed writes.
    // Do not hide their result behind a duplicate debounce; manual save can retry failures.
    if (queuedSnapshotRef.current?.id === activeChartId && queuedSnapshotRef.current.snapshot === chart) return
    setStorageStatus('saving')
    const timer = window.setTimeout(() => {
      if (queuedSnapshotRef.current?.id !== activeChartId || queuedSnapshotRef.current.snapshot !== chart) void persistSnapshot(activeChartId, chart, {}, true)
    }, 550)
    return () => window.clearTimeout(timer)
  }, [activeChartId, chart, libraryReady, persistSnapshot])

  const selectChart = useCallback(async (id: string, tier?: number) => {
    if (!id) return false
    if (id === activeIdRef.current) {
      const next = tier === undefined ? chartRef.current : chooseDifficulty(chartRef.current, tier)
      if (next !== chartRef.current) {
        stopPlayback()
        if (audioRef.current) audioRef.current.currentTime = 0
        playbackClockRef.current.reset(0)
        chartRef.current = next; setChart(next); setCurrentTimeState(0)
        historyRef.current = []; futureRef.current = []; setHistory([]); setFuture([])
      }
      return true
    }
    if (activeIdRef.current && !await flushActiveChart()) return false
    const record = await readManagedChart(id)
    if (!record) { showToast(text('找不到这份谱面', 'Chart not found')); return false }
    const next = tier === undefined ? record.chart : chooseDifficulty(record.chart, tier)
    activeIdRef.current = id; setActiveChartId(id); resetSession(next, record.audioUrl, record.backgroundUrl, record.coverUrl)
    return true
  }, [flushActiveChart, readManagedChart, resetSession, showToast, stopPlayback])

  const writeChartInfo = useCallback((id: string, next: Chart, media: ChartInfoMedia, creating = false) =>
    queueWrite(id, activeIdRef.current === id ? chartRef.current : next, async () => {
      if (window.moonweave) {
        const record = await window.moonweave.writeChartInfo(id, next, media)
        const saved = normalizeManagedChart(record.chart)
        updateSummary(webSummary(id, saved, record.updatedAt, record.coverUrl), false)
        return { chart: saved, audioUrl: record.audioUrl, backgroundUrl: record.backgroundUrl, coverUrl: record.coverUrl }
      }
      const saved = { ...next }
      if (media.audio) { saved.audioPath = 'indexeddb'; saved.audioName = media.audio.name }
      if (media.cover !== undefined) {
        saved.coverPath = media.cover ? 'indexeddb' : ''
        saved.coverName = media.cover?.name ?? ''
      }
      if (media.background !== undefined) {
        saved.backgroundPath = media.background ? 'indexeddb' : ''
        saved.backgroundName = media.background?.name ?? ''
        saved.backgroundType = !media.background ? '' : /\.(mp4|webm)$/i.test(media.background.name) ? 'video' : 'image'
        if (saved.backgroundType !== 'video') saved.backgroundVideoStartTime = 0
      }
      const record = await writeWebChart(id, saved, media)
      const coverUrls = webCoverUrlsRef.current
      if (media.cover !== undefined) {
        const previous = coverUrls.get(id)
        if (previous) URL.revokeObjectURL(previous)
        coverUrls.delete(id)
        if (record.cover) coverUrls.set(id, URL.createObjectURL(record.cover))
      }
      const coverUrl = coverUrls.get(id) ?? ''
      const loadMedia = creating || id === activeIdRef.current
      updateSummary(webSummary(id, saved, record.updatedAt, coverUrl), media.cover === undefined)
      return {
        chart: saved, coverUrl,
        audioUrl: loadMedia && media.audio ? URL.createObjectURL(media.audio) : '',
        backgroundUrl: loadMedia && media.background ? URL.createObjectURL(media.background) : '',
      }
    }), [queueWrite, updateSummary])
  const createChart = useCallback(async (initial: Chart, media: ChartInfoMedia) => {
    if (!media.audio) return null
    if (activeIdRef.current && !await flushActiveChart()) return null
    const id = crypto.randomUUID()
    const library = newChartMetadata(initial.library)
    const tracks = Object.fromEntries(tiers.flatMap((_, tier) =>
      tier === library.tier ? [] : [[tier, emptyDifficultyTrack()]]))
    const created = { ...initial, library, tracks }
    const record = await writeChartInfo(id, created, media, true)
    if (!record) return null
    queuedSnapshotRef.current = { id, snapshot: record.chart }
    activeIdRef.current = id; setActiveChartId(id); resetSession(record.chart, record.audioUrl, record.backgroundUrl, record.coverUrl)
    if (record.audioUrl) setBpmRequest({ sequence: audioImportSequence.current, id, url: record.audioUrl })
    return id
  }, [flushActiveChart, resetSession, writeChartInfo])
  const inspectAudio = useCallback(async (id: string) => {
    if (id === activeIdRef.current) return audioUrl
    if (window.moonweave) return (await window.moonweave.readChart(id))?.audioUrl || ''
    return (await readWebChart(id))?.audio || ''
  }, [audioUrl])
  const inspectChart = useCallback(async (id: string) => id === activeIdRef.current ? chartRef.current : readChartForExport(id), [readChartForExport])
  const saveChartInfo = useCallback(async (id: string, next: Chart, media: ChartInfoMedia) => {
    const record = await writeChartInfo(id, next, media)
    if (!record) return false
    if (activeIdRef.current === id) {
      queuedSnapshotRef.current = { id, snapshot: record.chart }
      chartRef.current = record.chart
      setChart(record.chart)
      historyRef.current = []; futureRef.current = []; setHistory([]); setFuture([])
      if (media.audio) {
        stopPlayback()
        replaceAudioUrl(record.audioUrl, record.audioUrl.startsWith('blob:'))
        setCurrentTimeState(0)
        setBpmRequest({ sequence: ++audioImportSequence.current, id, url: record.audioUrl })
      }
      if (media.background !== undefined) replaceBackgroundUrl(record.backgroundUrl, record.backgroundUrl.startsWith('blob:'))
      if (media.cover !== undefined) setCoverUrl(record.coverUrl)
    }
    return true
  }, [replaceAudioUrl, replaceBackgroundUrl, stopPlayback, writeChartInfo])
  const duplicateChart = useCallback(async (id: string) => {
    if (activeIdRef.current === id && !await flushActiveChart()) return null
    if (window.moonweave) {
      const item = await window.moonweave.duplicateChart(id)
      updateSummary(item)
      return item.id
    }
    const record = await readWebChart(id)
    if (!record) return null
    const newId = crypto.randomUUID()
    const copy = { ...record.chart, title: record.chart.title + text('（副本）', ' (Copy)'), library: { ...libraryMetadata(record.chart.library), status: 'draft' as const } }
    const url = record.cover ? URL.createObjectURL(record.cover) : ''
    if (!await persistSnapshot(newId, copy, { audio: record.audio, background: record.background, cover: record.cover, coverUrl: url })) {
      if (url) URL.revokeObjectURL(url)
      return null
    }
    if (url) webCoverUrlsRef.current.set(newId, url)
    return newId
  }, [flushActiveChart, persistSnapshot, updateSummary])
  const deleteChart = useCallback(async (id: string) => {
    deletedIdsRef.current.add(id)
    await writeQueueRef.current
    try {
      if (window.moonweave) await window.moonweave.deleteChart(id)
      else await deleteWebChart(id)
    } catch (error) {
      deletedIdsRef.current.delete(id)
      throw error
    }
    if (!window.moonweave) {
      const cover = webCoverUrlsRef.current.get(id)
      if (cover) URL.revokeObjectURL(cover)
      webCoverUrlsRef.current.delete(id)
    }
    const remaining = charts.filter((item) => item.id !== id)
    setCharts(remaining)
    if (id !== activeIdRef.current) { showToast(text('谱面已删除', 'Chart deleted')); return true }
    if (remaining.length) {
      const record = await readManagedChart(remaining[0].id)
      if (record) { setActiveChartId(remaining[0].id); resetSession(record.chart, record.audioUrl, record.backgroundUrl, record.coverUrl) }
      else { setActiveChartId(''); resetSession(freshChart()) }
    } else { setActiveChartId(''); resetSession(freshChart()) }
    setStorageStatus('saved')
    showToast(text('谱面及其内部媒体已删除', 'Chart and its saved media deleted'))
    return true
  }, [charts, readManagedChart, resetSession, showToast])

  const chooseAudio = useCallback(async () => {
    const id = activeIdRef.current
    if (!id) return
    const sequence = ++audioImportSequence.current
    setBpmRequest(null)
    const isCurrent = () => id === activeIdRef.current && sequence === audioImportSequence.current
    if (window.moonweave) {
      const result = await window.moonweave.chooseAudio(id)
      if (!result || !isCurrent()) return
      stopPlayback()
      const next = { ...chartRef.current, audioPath: result.audioPath, audioName: result.name }
      chartRef.current = next; setChart(next); replaceAudioUrl(result.url); setCurrentTimeState(0)
      await persistSnapshot(id, next)
      if (isCurrent()) { setBpmRequest({ sequence, id, url: result.url }); showToast(text(bpmDetectionCopy.analyzing.zh, bpmDetectionCopy.analyzing.en)) }
      return
    }
    const [file] = await chooseLocalFiles('audio/*,.flac,.m4a')
    if (!file || !isCurrent()) return
    stopPlayback()
    const next = { ...chartRef.current, audioPath: 'indexeddb', audioName: file.name }
    const url = URL.createObjectURL(file)
    chartRef.current = next; setChart(next); replaceAudioUrl(url, true); setCurrentTimeState(0)
    await persistSnapshot(id, next, { audio: file })
    if (isCurrent()) { setBpmRequest({ sequence, id, url }); showToast(text(bpmDetectionCopy.analyzing.zh, bpmDetectionCopy.analyzing.en)) }
  }, [persistSnapshot, replaceAudioUrl, showToast, stopPlayback])

  const chooseBackground = useCallback(async () => {
    const id = activeIdRef.current
    if (!id) return
    if (window.moonweave) {
      const result = await window.moonweave.chooseBackground(id)
      if (!result) return
      const next = { ...chartRef.current, backgroundPath: result.backgroundPath, backgroundName: result.name, backgroundType: result.backgroundType, backgroundVideoStartTime: 0 }
      setChart(next); replaceBackgroundUrl(result.url); await persistSnapshot(id, next); showToast(text('背景媒体已复制到应用内部', 'Background media copied into the app'))
      return
    }
    const [file] = await chooseLocalFiles('image/png,image/jpeg,image/webp,image/avif,video/mp4,video/webm')
    if (!file) return
    const backgroundType = file.type.startsWith('video/') || /\.(mp4|webm)$/i.test(file.name) ? 'video' as const : 'image' as const
    const next = { ...chartRef.current, backgroundPath: 'indexeddb', backgroundName: file.name, backgroundType, backgroundVideoStartTime: 0 }
    const url = URL.createObjectURL(file)
    setChart(next); replaceBackgroundUrl(url, true); await persistSnapshot(id, next, { background: file }); showToast(text('背景媒体已保存到浏览器谱面库', 'Background media saved to the browser chart library'))
  }, [persistSnapshot, replaceBackgroundUrl, showToast])

  const removeBackground = useCallback(async () => {
    const id = activeIdRef.current
    if (!id) return
    if (window.moonweave) await window.moonweave.removeBackground(id)
    const next = { ...chartRef.current, backgroundPath: '', backgroundName: '', backgroundType: '' as const, backgroundVideoStartTime: 0 }
    setChart(next); replaceBackgroundUrl(''); await persistSnapshot(id, next, window.moonweave ? {} : { background: null }); showToast(text('已恢复默认试玩背景', 'Default playtest background restored'))
  }, [persistSnapshot, replaceBackgroundUrl, showToast])

  const chooseCover = useCallback(async () => {
    const id = activeIdRef.current
    if (!id) return
    if (window.moonweave) {
      const result = await window.moonweave.chooseCover(id)
      if (!result) return
      const next = { ...chartRef.current, coverPath: result.coverPath, coverName: result.name }
      setChart(next); setCoverUrl(result.url); await persistSnapshot(id, next); showToast(text('曲目封面已保存到应用内部', 'Cover art saved in the app'))
      return
    }
    const [file] = await chooseLocalFiles('image/png,image/jpeg,image/webp,image/avif')
    if (!file) return
    const previousUrl = webCoverUrlsRef.current.get(id)
    if (previousUrl) URL.revokeObjectURL(previousUrl)
    const url = URL.createObjectURL(file)
    webCoverUrlsRef.current.set(id, url)
    const next = { ...chartRef.current, coverPath: 'indexeddb', coverName: file.name }
    setChart(next); setCoverUrl(url); await persistSnapshot(id, next, { cover: file, coverUrl: url }); showToast(text('曲目封面已保存到浏览器谱面库', 'Cover art saved to the browser chart library'))
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
    setChart(next); setCoverUrl(''); await persistSnapshot(id, next, window.moonweave ? {} : { cover: null, coverUrl: '' }); showToast(text('已移除曲目封面', 'Cover art removed'))
  }, [persistSnapshot, showToast])

  const exportChart = useCallback(async (id: string) => {
    if (!id) return false
    let exportedChart: Chart
    if (id === activeIdRef.current) {
      if (!await flushActiveChart()) return false
      exportedChart = chartRef.current
    } else {
      const storedChart = await readChartForExport(id)
      if (!storedChart) { showToast(text('找不到这份谱面', 'Chart not found')); return false }
      exportedChart = storedChart
    }
    if (window.moonweave) {
      const target = await window.moonweave.exportChart({ id, chart: exportedChart })
      if (target) showToast(text('谱面已导出；关联媒体也已复制到同一目录', 'Chart exported; linked media was copied to the same folder'))
      return Boolean(target)
    }
    const record = await readWebChart(id)
    if (!record) { showToast(text('找不到这份谱面', 'Chart not found')); return false }
    const assets: Parameters<typeof createChartPackage>[1] = {}
    if (record.audio) assets.audio = { data: new Uint8Array(await record.audio.arrayBuffer()), name: exportedChart.audioName || 'audio.mp3' }
    if (record.background) assets.background = { data: new Uint8Array(await record.background.arrayBuffer()), name: exportedChart.backgroundName || 'background.png' }
    if (record.cover) assets.cover = { data: new Uint8Array(await record.cover.arrayBuffer()), name: exportedChart.coverName || 'cover.png' }
    const packageBytes = await createChartPackage(exportedChart, assets)
    const blob = new Blob([packageBytes.slice().buffer as ArrayBuffer], { type: 'application/vnd.moonweave.chart+zip' })
    const url = URL.createObjectURL(blob); const anchor = document.createElement('a')
    anchor.href = url; anchor.download = `${exportedChart.title.replace(/[<>:\"/\\|?*]/g, '_')}.mwchart`; anchor.click()
    URL.revokeObjectURL(url); showToast(text('谱面资源包已导出', 'Chart package exported'))
    return true
  }, [flushActiveChart, readChartForExport, showToast])

  const importChart = useCallback(async () => {
    await flushActiveChart()
    try {
      if (window.moonweave) {
        const record = await window.moonweave.importChart()
        if (!record) return null
        migrateLegacyPreferences(record.chart)
        const loaded = normalizeManagedChart(record.chart)
        setActiveChartId(record.id); resetSession(loaded, record.audioUrl, record.backgroundUrl, record.coverUrl)
        updateSummary(webSummary(record.id, loaded, record.updatedAt, record.coverUrl), false); showToast(text('谱面资源已导入内部谱面库', 'Chart resources imported into the local library'))
        return record.id
      }
      const files = await chooseLocalFiles('.mwchart,application/json,.json,audio/*,.flac,.m4a,image/png,image/jpeg,image/webp,image/avif,video/mp4,video/webm', true)
      const packageFile = files.find((file) => file.name.toLowerCase().endsWith('.mwchart'))
      if (packageFile) {
        const packaged = await readChartPackage(new Uint8Array(await packageFile.arrayBuffer()))
        const loaded = normalizeManagedChart(packaged.chart)
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
        showToast(text('谱面资源包已导入浏览器谱面库', 'Chart package imported into the browser library'))
        return id
      }
      const json = files.find((file) => file.name.toLowerCase().endsWith('.json'))
      if (!json) return null
      const imported = JSON.parse(await json.text())
      migrateLegacyPreferences(imported)
      const loaded = normalizeManagedChart(imported)
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
      showToast(audio || background || cover ? text('谱面与所选媒体已导入浏览器谱面库', 'Chart and selected media imported into the browser library') : text('谱面已导入；可继续上传媒体', 'Chart imported; you can upload media next'))
      return id
    } catch (error) { showToast(error instanceof Error ? error.message : text('谱面文件格式无效', 'Invalid chart file format')); return null }
  }, [flushActiveChart, migrateLegacyPreferences, persistSnapshot, resetSession, showToast, updateSummary])

  const revealLibrary = useCallback(async () => {
    if (window.moonweave) { await window.moonweave.revealLibrary(); return }
    showToast(text('网页谱面保存在当前站点的浏览器 IndexedDB 中', 'Web charts are stored in this site’s browser IndexedDB'))
  }, [showToast])

  const setCurrentTime = useCallback((time: number) => {
    const value = clamp(time, 0, chartRef.current.duration)
    setCurrentTimeState(value)
    const audio = audioRef.current
    if (!audio) return
    audio.currentTime = value / 1000
    if (audio.paused || audio.seeking || audio.readyState < HTMLMediaElement.HAVE_FUTURE_DATA || mediaWaitingRef.current) playbackClockRef.current.reset(value)
    else playbackClockRef.current.start(value, performance.now(), audio.playbackRate, { waitForProgress: true })
  }, [])
  const commitEdit = useCallback((update: (chart: Chart) => Chart) => {
    const previous = chartRef.current
    const next = update(previous)
    if (next === previous) return
    historyRef.current = [...historyRef.current.slice(-79), editSnapshot(previous)]
    futureRef.current = []
    setHistory(historyRef.current); setFuture([])
    chartRef.current = next; setChart(next)
  }, [])
  const commitNotes = useCallback((notes: ChartNote[]) => {
    commitEdit((previous) => ({ ...previous, notes: [...notes].sort((a, b) => a.time - b.time) }))
  }, [commitEdit])
  const importNotes = useCallback<ChartContextValue['importNotes']>(async (notes, chartId, tier) => {
    if (activeIdRef.current !== chartId || libraryMetadata(chartRef.current.library).tier !== tier || !notes.length) return 'stale'
    const issue = noteImportIssue(notes, chartRef.current.duration)
    if (issue) return issue
    stopPlayback()
    commitNotes(notes)
    return await flushActiveChart() ? 'saved' : 'unsaved'
  }, [commitNotes, flushActiveChart, stopPlayback])
  const applyAiImport = useCallback(async (plan: AiPlan) => {
    applyAiPlan(chartRef.current, activeIdRef.current, plan)
    stopPlayback()
    commitEdit((previous) => applyAiPlan(previous, activeIdRef.current, plan))
    return flushActiveChart()
  }, [commitEdit, flushActiveChart, stopPlayback])
  const undo = useCallback(() => {
    const previous = historyRef.current.at(-1)
    if (!previous) return
    futureRef.current = [editSnapshot(chartRef.current), ...futureRef.current]
    historyRef.current = historyRef.current.slice(0, -1)
    const next = restoreEdit(chartRef.current, previous)
    chartRef.current = next; setChart(next)
    setHistory(historyRef.current); setFuture(futureRef.current)
  }, [])
  const redo = useCallback(() => {
    const next = futureRef.current[0]
    if (!next) return
    historyRef.current = [...historyRef.current, editSnapshot(chartRef.current)]
    futureRef.current = futureRef.current.slice(1)
    const restored = restoreEdit(chartRef.current, next)
    chartRef.current = restored; setChart(restored)
    setHistory(historyRef.current); setFuture(futureRef.current)
  }, [])
  const unavailableBpm = useCallback((reason: BpmFailureReason) => showToast(text(bpmDetectionCopy[reason].zh, bpmDetectionCopy[reason].en)), [showToast])
  const tick = useCallback(() => {
    const audio = audioRef.current
    if (!audio || audio.paused || audio.ended) return
    const time = audio.seeking || audio.readyState < HTMLMediaElement.HAVE_FUTURE_DATA || mediaWaitingRef.current
      ? audio.currentTime * 1000
      : playbackClockRef.current.getTime(audio.currentTime * 1000)
    setCurrentTimeState(clamp(time, 0, chartRef.current.duration))
    animationRef.current = requestAnimationFrame(tick)
  }, [])
  const setPlaybackRate = useCallback((rate: number) => {
    if (rate !== 0.5 && rate !== 0.75 && rate !== 1) return
    setPreferences((current) => ({ ...current, playbackRate: rate }))
    const audio = audioRef.current
    if (!audio || audio.playbackRate === rate) return
    audio.playbackRate = rate
    if (!audio.paused && !audio.ended) {
      playbackClockRef.current.setRate(audio.currentTime * 1000, performance.now(), rate)
    }
  }, [setPreferences])
  const togglePlay = useCallback((playbackRate: number, subdivision: number, signal?: AbortSignal) => {
    const epoch = playbackEpochRef.current
    const toggle = async () => {
      if (epoch !== playbackEpochRef.current || signal?.aborted) return
      const audio = audioRef.current
      if (!audioUrl || !audio) { showToast(text('请先在编辑器右侧的谱面信息中选择歌曲音频', 'Select song audio from Chart Info on the right side of the editor first')); return }
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

      try {
        if (/\.mp3$/i.test(chartRef.current.audioName) && chartRef.current.duration <= 600_000) {
          const prepared = preparedAudioRef.current ??= cacheEditorAudio(audioUrl)
          const url = await prepared.ready
          if (prepared !== preparedAudioRef.current || epoch !== playbackEpochRef.current || signal?.aborted) return
          if (url && audio.src !== url) {
            const position = audio.ended ? 0 : audio.currentTime
            audio.src = url
            audio.currentTime = position
          }
        }
        audio.playbackRate = playbackRate
        await audio.play()
        if (epoch !== playbackEpochRef.current || audio.paused) return
        cancelAnimationFrame(animationRef.current)
        if (audio.seeking || audio.readyState < HTMLMediaElement.HAVE_FUTURE_DATA || mediaWaitingRef.current) playbackClockRef.current.stop(audio.currentTime * 1000)
        else playbackClockRef.current.start(audio.currentTime * 1000, performance.now(), audio.playbackRate, { waitForProgress: true })
        setIsPlaying(true)
        animationRef.current = requestAnimationFrame(tick)
      } catch {
        setIsPlaying(false)
        showToast(text('音频无法播放，请重新选择文件', 'Audio could not be played; select the file again'))
      }
    }
    const queued = playbackQueueRef.current.then(toggle, toggle)
    playbackQueueRef.current = queued.catch(() => undefined)
    return queued
  }, [audioUrl, showToast, tick])

  useEffect(() => () => {
    releasePreparedAudio()
    cancelAnimationFrame(animationRef.current); toastTimers.current.forEach(id => window.clearTimeout(id))
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current)
    if (backgroundObjectUrlRef.current) URL.revokeObjectURL(backgroundObjectUrlRef.current)
    for (const url of webCoverUrlsRef.current.values()) URL.revokeObjectURL(url)
    webCoverUrlsRef.current.clear()
  }, [])
  const value = useMemo<ChartContextValue>(() => ({
    improvising, setImprovising, chart, setChart, activeChartId, charts, libraryReady, storageStatus, audioUrl, backgroundUrl, coverUrl, audioRef, currentTime, isPlaying,
    historyLength: history.length, futureLength: future.length, toast,
    setCurrentTime, setPlaybackRate, commitNotes, commitEdit, importNotes, applyAiImport, undo, redo, chooseAudio, chooseBackground, removeBackground, chooseCover, removeCover, flushActiveChart, importChart, exportChart, createChart, inspectAudio, inspectChart, saveChartInfo, duplicateChart, selectChart, deleteChart, revealLibrary, togglePlay, showToast,
  }), [improvising, chart, activeChartId, charts, libraryReady, storageStatus, audioUrl, backgroundUrl, coverUrl, currentTime, isPlaying, history.length, future.length, toast, setCurrentTime, setPlaybackRate, commitNotes, commitEdit, importNotes, applyAiImport, undo, redo, chooseAudio, chooseBackground, removeBackground, chooseCover, removeCover, flushActiveChart, importChart, exportChart, createChart, inspectAudio, inspectChart, saveChartInfo, duplicateChart, selectChart, deleteChart, revealLibrary, togglePlay, showToast])
  return <ChartContext.Provider value={value}>
    <audio ref={audioRef} src={audioUrl || undefined} preload="auto" onLoadedMetadata={(event) => {
      if (event.currentTarget.currentSrc === preparedAudioRef.current?.url) return
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
          showToast(text('内部音频已不可用，请重新上传', 'Saved audio is unavailable; upload it again')); return ''
        })
      }, 0)
    }} onSeeking={(event) => {
      // Media events are queued. An older seeking event must not stop a clock
      // that has already resumed after the latest seek.
      const audio = event.currentTarget
      if (audio.seeking) playbackClockRef.current.stop(audio.currentTime * 1000)
    }} onSeeked={(event) => {
      const audio = event.currentTarget
      if (audio.seeking) return
      // seeked can precede playing (not enough buffered data), or follow it.
      // Reconcile the current readiness instead of retaining an old waiting flag.
      mediaWaitingRef.current = audio.readyState < HTMLMediaElement.HAVE_FUTURE_DATA
      if (!audio.seeking && !audio.paused && !audio.ended && !mediaWaitingRef.current) {
        playbackClockRef.current.start(audio.currentTime * 1000, performance.now(), audio.playbackRate, { waitForProgress: true })
      } else {
        playbackClockRef.current.stop(audio.currentTime * 1000)
      }
    }} onWaiting={(event) => {
      const audio = event.currentTarget
      if (audio.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA) return
      mediaWaitingRef.current = true
      playbackClockRef.current.stop(audio.currentTime * 1000)
    }} onPlaying={(event) => {
      const audio = event.currentTarget
      if (audio.paused || audio.ended || audio.readyState < HTMLMediaElement.HAVE_FUTURE_DATA) return
      mediaWaitingRef.current = false
      if (!audio.seeking) {
        playbackClockRef.current.start(audio.currentTime * 1000, performance.now(), audio.playbackRate, { waitForProgress: true })
      }
    }} onPlay={() => setIsPlaying(true)} onPause={(event) => {
      // pause is queued by the browser and may arrive after playback resumed.
      if (!event.currentTarget.paused) return
      cancelAnimationFrame(animationRef.current)
      playbackClockRef.current.stop(event.currentTarget.currentTime * 1000)
      setIsPlaying(false)
    }} onEnded={() => {
      playbackClockRef.current.stop(chart.duration)
      setIsPlaying(false); setCurrentTimeState(chart.duration); cancelAnimationFrame(animationRef.current)
    }} />
    {children}
    {bpmRequest && <BpmDetectionDialog key={bpmRequest.sequence} url={bpmRequest.url} onUnavailable={unavailableBpm} onApply={(bpm) => {
      if (activeIdRef.current !== bpmRequest.id || audioImportSequence.current !== bpmRequest.sequence) return
      commitEdit((previous) => ({ ...previous, bpm }))
      showToast(text(bpmDetectionCopy.applied.zh, bpmDetectionCopy.applied.en))
    }} />}
    <div className="chart-toasts">{messages.map(entry => <GameToast key={entry.id}>{entry.text}</GameToast>)}</div>
  </ChartContext.Provider>
}

export function useChart() {
  const value = useContext(ChartContext)
  if (!value) throw new Error('useChart must be used inside ChartProvider')
  return value
}
