export type TitlebarTheme = 'light' | 'dark'

export interface SylunaeShellAPI {
  readonly platform: 'electron'
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
  noteCount: number
  updatedAt: number
}

export interface ManagedChart {
  id: string
  chart: unknown
  updatedAt: number
  audioUrl: string
  backgroundUrl: string
}

export interface MoonweaveAPI {
  listCharts(): Promise<ChartLibraryItem[]>
  readChart(id: string): Promise<ManagedChart | null>
  writeChart(id: string, chart: Chart): Promise<ChartLibraryItem>
  deleteChart(id: string): Promise<boolean>
  chooseAudio(id: string): Promise<{ audioPath: string; url: string; name: string } | null>
  chooseBackground(id: string): Promise<{ backgroundPath: string; backgroundType: 'image' | 'video'; url: string; name: string } | null>
  removeBackground(id: string): Promise<boolean>
  importChart(): Promise<ManagedChart | null>
  exportChart(payload: { id: string; chart: Chart }): Promise<string | null>
  revealLibrary(): Promise<string>
}
