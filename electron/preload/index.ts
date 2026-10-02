import { contextBridge, ipcRenderer } from 'electron'
import type { SylunaeShellAPI, TitlebarTheme } from '../../src/shared/electron'

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
  readBundledChartPackage: (name: string) => ipcRenderer.invoke('library:read-bundled-package', name),
  listCharts: () => ipcRenderer.invoke('library:list'),
  readChart: (id: string) => ipcRenderer.invoke('library:read', id),
  writeChart: (id: string, chart: unknown) => ipcRenderer.invoke('library:write', id, chart),
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
