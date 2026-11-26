export type TitlebarTheme = 'light' | 'dark'
export const SYSTEM_LANGUAGES_ARG = '--moonweave-system-languages='

export interface SylunaeShellAPI {
  readonly platform: 'electron'
  readonly preferredLanguages: readonly string[]
  readonly versions: Readonly<Record<'electron' | 'chrome' | 'node', string>>
  system: {
    openExternal(url: string): Promise<boolean>
    setTitlebarTheme(theme: TitlebarTheme): Promise<void>
  }
}

import type { Chart } from '../features/chart/types'

export interface ChartLibraryItem {
  id: string
  title: string
  artist: string
  audioName: string
  library: import('../features/chart/libraryMetadata').LibraryMetadata
  noteCount: number
  updatedAt: number
  coverUrl: string
}

export interface ManagedChart {
  id: string
  chart: unknown
  updatedAt: number
  audioUrl: string
  backgroundUrl: string
  coverUrl: string
}

export interface ChartInfoMedia {
  audio?: File
  background?: File | null
  cover?: File | null
  youtubeImportId?: string
}

export interface YoutubeChartImport {
  title: string
  artist: string
  duration: number
  audioName: string
  cover?: Uint8Array
}

export type YoutubeImportResult =
  | { ok: true; media: YoutubeChartImport }
  | { ok: false; reason: 'link' | 'tools' | 'busy' | 'duration' | 'failed' }

export interface YoutubeImportAPI {
  status(): Promise<'unsupported' | 'installing' | 'ready' | 'missing'>
  install(): Promise<void>
  download(id: string, url: string): Promise<YoutubeImportResult>
  discard(id: string): Promise<void>
}

export interface MoonweaveAPI {
  youtube?: YoutubeImportAPI
  readBundledChartPackage(name: string): Promise<Uint8Array>
  listCharts(): Promise<ChartLibraryItem[]>
  readChart(id: string): Promise<ManagedChart | null>
  readAudioForAnalysis(id: string): Promise<Uint8Array | null>
  writeChart(id: string, chart: Chart): Promise<ChartLibraryItem>
  writeChartInfo(id: string, chart: Chart, media: ChartInfoMedia): Promise<ManagedChart>
  duplicateChart(id: string): Promise<ChartLibraryItem>
  deleteChart(id: string): Promise<boolean>
  chooseAudio(id: string): Promise<{ audioPath: string; url: string; name: string } | null>
  chooseBackground(id: string): Promise<{ backgroundPath: string; backgroundType: 'image' | 'video'; url: string; name: string } | null>
  removeBackground(id: string): Promise<boolean>
  chooseCover(id: string): Promise<{ coverPath: string; url: string; name: string } | null>
  removeCover(id: string): Promise<boolean>
  importChart(): Promise<ManagedChart | null>
  exportChart(payload: { id: string; chart: Chart }): Promise<string | null>
  revealLibrary(): Promise<string>
}
