export type Language = 'zh' | 'en'
export type ThemeMode = 'system' | 'light' | 'dark'

export const PREFERENCES_STORAGE_KEY = 'moonweave.preferences'
export const defaultThemeMode = 'dark'

export function readStoredPreferences(): Record<string, unknown> | undefined {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(PREFERENCES_STORAGE_KEY) ?? '{}')
    if (value && typeof value === 'object') return value as Record<string, unknown>
  } catch { /* Storage may be unavailable or contain invalid JSON. */ }
}

export function resolveStartupLanguage(saved: unknown, locales: readonly string[]): Language {
  if (saved === 'zh' || saved === 'en') return saved
  for (const locale of locales) {
    const primary = locale.split('-')[0].toLowerCase()
    if (primary === 'zh' || primary === 'en') return primary
  }
  return 'en'
}

export function getStartupLanguage(saved?: unknown): Language {
  const system = window.sylunae?.preferredLanguages
  const locales = system?.length ? system : navigator.languages?.length ? navigator.languages : [navigator.language]
  return resolveStartupLanguage(saved, locales)
}

export function documentLanguage(language: Language) {
  return language === 'zh' ? 'zh-CN' : 'en'
}

export function resolveTheme(mode: unknown, prefersDark: boolean): 'light' | 'dark' {
  if (mode === 'system') return prefersDark ? 'dark' : 'light'
  return mode === 'light' || mode === 'dark' ? mode : defaultThemeMode
}
