import { useCallback, useMemo } from 'react'
import { usePreferences } from './preferences'
export { currentText } from './currentText'

export function useI18n() {
  const { preferences, setPreferences } = usePreferences()
  const language = preferences.language
  const text = useCallback((zh: string, en: string) => language === 'zh' ? zh : en, [language])
  const toggleLanguage = useCallback(() => {
    setPreferences((current) => ({ ...current, language: current.language === 'zh' ? 'en' : 'zh' }))
  }, [setPreferences])
  return useMemo(() => ({ language, locale: language === 'zh' ? 'zh-CN' : 'en-US', text, toggleLanguage }), [language, text, toggleLanguage])
}
