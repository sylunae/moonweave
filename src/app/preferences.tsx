import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { accessibleForeground, defaultThemePalettes, normalizeThemePalettes, themeColorFields, themeCssVariables, type ThemePalettes } from './theme'

export type ThemeMode = 'system' | 'light' | 'dark'
export type TimingWindow = 'strict' | 'standard' | 'relaxed'
export type Language = 'zh' | 'en'

export interface Preferences {
  schemaVersion: 0 | 1
  language: Language
  theme: ThemeMode
  sidebarWidth: number
  sidebarCollapsed: boolean
  reduceMotion: boolean
  playKeys: string[]
  noteScrollSpeed: number
  trackBackgroundBlur: boolean
  playbackRate: number
  laneTilt: number
  timingWindow: TimingWindow
  judgmentLineHeight: number
  themePalettes: ThemePalettes
  particleAppearanceId: string | null
}

const STORAGE_KEY = 'moonweave.preferences'
export const SIDEBAR_MIN = 220
export const SIDEBAR_MAX = 440
export const SIDEBAR_COLLAPSED = 70
export const SIDEBAR_COLLAPSE_THRESHOLD = 176

export const defaultPreferences: Preferences = {
  schemaVersion: 1,
  language: 'zh',
  theme: 'dark',
  sidebarWidth: 252,
  sidebarCollapsed: false,
  reduceMotion: false,
  playKeys: ['D', 'F', 'J', 'K'],
  noteScrollSpeed: 8,
  trackBackgroundBlur: true,
  playbackRate: 1,
  laneTilt: 45,
  timingWindow: 'standard',
  judgmentLineHeight: 200,
  themePalettes: defaultThemePalettes,
  particleAppearanceId: null,
}

export function normalizePreferences(input: unknown): Preferences {
  if (!input || typeof input !== 'object') return defaultPreferences
  const value = input as Partial<Preferences>
  const theme = value.theme === 'light' || value.theme === 'dark' || value.theme === 'system' ? value.theme : defaultPreferences.theme
  const language = value.language === 'en' ? 'en' : 'zh'
  const sidebarWidth = typeof value.sidebarWidth === 'number' && Number.isFinite(value.sidebarWidth)
    ? Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, value.sidebarWidth))
    : defaultPreferences.sidebarWidth
  const playKeys = Array.isArray(value.playKeys) && value.playKeys.length === 4
    ? value.playKeys.map((key, index) => typeof key === 'string' && key ? key.slice(-1).toUpperCase() : defaultPreferences.playKeys[index])
    : defaultPreferences.playKeys
  const noteScrollSpeed = typeof value.noteScrollSpeed === 'number' && Number.isFinite(value.noteScrollSpeed)
    ? Math.min(12, Math.max(4, value.noteScrollSpeed))
    : defaultPreferences.noteScrollSpeed
  const playbackRate = value.playbackRate === 0.5 || value.playbackRate === 0.75 || value.playbackRate === 1
    ? value.playbackRate
    : defaultPreferences.playbackRate
  const laneTilt = typeof value.laneTilt === 'number' && Number.isFinite(value.laneTilt)
    ? Math.min(45, Math.max(0, value.laneTilt))
    : defaultPreferences.laneTilt
  const timingWindow = value.timingWindow === 'strict' || value.timingWindow === 'relaxed' || value.timingWindow === 'standard'
    ? value.timingWindow
    : defaultPreferences.timingWindow
  const judgmentLineHeight = typeof value.judgmentLineHeight === 'number' && Number.isFinite(value.judgmentLineHeight)
    ? Math.min(360, Math.max(100, value.judgmentLineHeight))
    : defaultPreferences.judgmentLineHeight
  return {
    schemaVersion: value.schemaVersion === 1 ? 1 : 0,
    language,
    theme,
    sidebarWidth,
    sidebarCollapsed: Boolean(value.sidebarCollapsed),
    reduceMotion: Boolean(value.reduceMotion),
    playKeys,
    noteScrollSpeed,
    trackBackgroundBlur: typeof value.trackBackgroundBlur === 'boolean' ? value.trackBackgroundBlur : defaultPreferences.trackBackgroundBlur,
    playbackRate,
    laneTilt,
    timingWindow,
    judgmentLineHeight,
    themePalettes: normalizeThemePalettes(value.themePalettes),
    particleAppearanceId: typeof value.particleAppearanceId === 'string' && value.particleAppearanceId.length <= 64
      ? value.particleAppearanceId : null,
  }
}

export function migrateLegacyChartPreferences(current: Preferences, input: unknown): Preferences {
  if (current.schemaVersion >= 1) return current
  const chart = input && typeof input === 'object' ? input as { settings?: unknown } : {}
  const settings = chart.settings && typeof chart.settings === 'object'
    ? chart.settings as { keys?: unknown; scrollSpeed?: unknown; laneTilt?: unknown; timingWindow?: unknown }
    : {}
  return normalizePreferences({
    ...current,
    schemaVersion: 1,
    playKeys: settings.keys ?? current.playKeys,
    noteScrollSpeed: settings.scrollSpeed ?? current.noteScrollSpeed,
    laneTilt: settings.laneTilt ?? current.laneTilt,
    timingWindow: settings.timingWindow ?? current.timingWindow,
  })
}

function loadPreferences(): Preferences {
  try { return normalizePreferences(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}')) }
  catch { return defaultPreferences }
}

function resolveTheme(mode: ThemeMode, prefersDark: boolean) {
  return mode === 'system' ? (prefersDark ? 'dark' : 'light') : mode
}

interface PreferencesContextValue {
  preferences: Preferences
  setPreferences: (next: Preferences | ((current: Preferences) => Preferences)) => void
  resetPreferences: () => void
}

const PreferencesContext = createContext<PreferencesContextValue | null>(null)

export function PreferencesProvider({ children }: { children: React.ReactNode }) {
  const [preferences, setPreferencesState] = useState(loadPreferences)
  const setPreferences = useCallback((next: Preferences | ((current: Preferences) => Preferences)) => {
    setPreferencesState((current) => normalizePreferences(typeof next === 'function' ? next(current) : next))
  }, [])
  const resetPreferences = useCallback(() => setPreferencesState(defaultPreferences), [])

  useEffect(() => { localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences)) }, [preferences])

  useEffect(() => {
    document.documentElement.lang = preferences.language === 'zh' ? 'zh-CN' : 'en'
  }, [preferences.language])

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const apply = () => {
      const theme = resolveTheme(preferences.theme, media.matches)
      document.documentElement.dataset.theme = theme
      document.documentElement.classList.toggle('dark', theme === 'dark')
      document.documentElement.dataset.reduceMotion = preferences.reduceMotion ? 'true' : 'false'
      const palette = preferences.themePalettes[theme]
      themeColorFields.forEach(({ key }) => document.documentElement.style.setProperty(themeCssVariables[key], palette[key]))
      document.documentElement.style.setProperty('--brand-foreground', accessibleForeground(palette.brand, palette.accentDeep))
      document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')?.setAttribute('content', palette.bg)
      void window.sylunae?.system.setTitlebarTheme(theme)
    }
    apply()
    media.addEventListener('change', apply)
    return () => media.removeEventListener('change', apply)
  }, [preferences.theme, preferences.reduceMotion, preferences.themePalettes])

  const value = useMemo(() => ({ preferences, setPreferences, resetPreferences }), [preferences, setPreferences, resetPreferences])
  return <PreferencesContext.Provider value={value}>{children}</PreferencesContext.Provider>
}

export function usePreferences() {
  const value = useContext(PreferencesContext)
  if (!value) throw new Error('usePreferences must be used inside PreferencesProvider')
  return value
}
