import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { ChartInfoMedia, SylunaeShellAPI, TitlebarTheme } from '../../src/shared/electron'

const selectedPath = (file: File | null | undefined) => {
  if (file == null) return file
  const source = webUtils.getPathForFile(file)
  if (!source) throw new Error('请选择本地媒体文件 / Select a local media file')
  return source
}

const api: SylunaeShellAPI = Object.freeze({
  platform: 'electron',
  versions: Object.freeze({
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
  }),
  system: Object.freeze({
    openExternal: (url: string) => ipcRenderer.invoke('shell:open-external', url),
    setTitlebarTheme: (theme: TitlebarTheme) => ipcRenderer.invoke('shell:set-titlebar-theme', theme),
  }),
})

contextBridge.exposeInMainWorld('sylunae', api)

contextBridge.exposeInMainWorld('moonweave', Object.freeze({
  youtube: Object.freeze({
    status: () => ipcRenderer.invoke('youtube:status'),
    install: () => ipcRenderer.invoke('youtube:install'),
    download: (id: string, url: string) => ipcRenderer.invoke('youtube:download', id, url),
    discard: (id: string) => ipcRenderer.invoke('youtube:discard', id),
  }),
  readBundledChartPackage: (name: string) => ipcRenderer.invoke('library:read-bundled-package', name),
  listCharts: () => ipcRenderer.invoke('library:list'),
  readChart: (id: string) => ipcRenderer.invoke('library:read', id),
  readAudioForAnalysis: (id: string) => ipcRenderer.invoke('library:read-analysis-audio', id),
  duplicateChart: (id: string) => ipcRenderer.invoke('library:duplicate', id),
  writeChart: (id: string, chart: unknown) => ipcRenderer.invoke('library:write', id, chart),
  writeChartInfo: (id: string, chart: unknown, media: ChartInfoMedia) => ipcRenderer.invoke('library:write-info', id, chart, {
    audio: selectedPath(media.audio),
    background: selectedPath(media.background),
    cover: selectedPath(media.cover),
    youtubeImportId: media.youtubeImportId,
  }),
  deleteChart: (id: string) => ipcRenderer.invoke('library:delete', id),
  chooseAudio: (id: string) => ipcRenderer.invoke('library:choose-audio', id),
  chooseBackground: (id: string) => ipcRenderer.invoke('library:choose-background', id),
  removeBackground: (id: string) => ipcRenderer.invoke('library:remove-background', id),
  chooseCover: (id: string) => ipcRenderer.invoke('library:choose-cover', id),
  removeCover: (id: string) => ipcRenderer.invoke('library:remove-cover', id),
  importChart: () => ipcRenderer.invoke('library:import'),
  exportChart: (payload: unknown) => ipcRenderer.invoke('library:export', payload),
  revealLibrary: () => ipcRenderer.invoke('library:reveal'),
}))
