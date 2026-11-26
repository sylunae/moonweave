import { documentLanguage, getStartupLanguage, readStoredPreferences, resolveTheme } from './app/startupPreferences'
import { startupCopy } from './config/brand'

const preferences = readStoredPreferences() ?? {}
const language = getStartupLanguage(preferences.language)
const theme = resolveTheme(preferences.theme, window.matchMedia('(prefers-color-scheme: dark)').matches)
const html = document.documentElement

html.lang = documentLanguage(language)
html.dataset.theme = theme
html.classList.toggle('dark', theme === 'dark')
html.dataset.reduceMotion = preferences.reduceMotion ? 'true' : 'false'

const splash = document.getElementById('boot-splash')
if (splash) {
  const status = splash.querySelector('[data-boot-status]')
  if (status) status.textContent = startupCopy[language]
  splash.toggleAttribute('data-desktop', Boolean(window.sylunae))
}

void window.sylunae?.system.setTitlebarTheme(theme)
