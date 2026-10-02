import { ClipboardPaste, Code2, Copy, RotateCcw, ShieldCheck } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { usePreferences } from '@/app/preferences'
import { useI18n } from '@/app/i18n'
import { defaultThemePalettes, getThemeContrastIssue, normalizeThemePalettes, parseThemePalettes, serializeThemePalettes, themeColorFields, themeColorLabelsEn, themeCssVariables, type ThemePalette, type ThemePalettes } from '@/app/theme'
import { Button } from './ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/tabs'
import { Textarea } from './ui/textarea'

export function ThemePaletteEditor() {
  const { preferences, setPreferences } = usePreferences()
  const { language, text } = useI18n()
  const [editingMode, setEditingMode] = useState<keyof ThemePalettes>(preferences.theme === 'dark' ? 'dark' : 'light')
  const [cssCode, setCssCode] = useState(() => serializeThemePalettes(preferences.themePalettes, preferences.language))
  const [message, setMessage] = useState('')
  const cssInput = useRef<HTMLTextAreaElement>(null)

  useEffect(() => setCssCode(serializeThemePalettes(preferences.themePalettes, language)), [language, preferences.themePalettes])

  const commit = (palettes: ThemePalettes, successMessage = '') => {
    const issue = getThemeContrastIssue(palettes, language)
    if (issue) { setMessage(text(`未应用：${issue}`, `Not applied: ${issue}`)); return false }
    setPreferences((current) => ({ ...current, themePalettes: palettes }))
    setMessage(successMessage)
    return true
  }
  const updateColor = (key: keyof ThemePalette, value: string) => {
    commit({ ...preferences.themePalettes, [editingMode]: { ...preferences.themePalettes[editingMode], [key]: value.toLowerCase() } })
  }
  const copyCss = async () => {
    const code = serializeThemePalettes(preferences.themePalettes, language)
    setCssCode(code)
    try { await navigator.clipboard.writeText(code) }
    catch { cssInput.current?.select(); document.execCommand('copy') }
    setMessage(text('CSS 已复制。', 'CSS copied.'))
  }
  const applyCss = () => {
    try {
      const parsed = parseThemePalettes(cssCode, preferences.themePalettes, language)
      if (commit(parsed, text('CSS 色板已应用。', 'CSS palette applied.'))) setCssCode(serializeThemePalettes(parsed, language))
    } catch (error) {
      setMessage(error instanceof Error ? error.message : text('CSS 色板无法识别。', 'The CSS palette could not be recognized.'))
    }
  }
  const reset = () => {
    const palettes = normalizeThemePalettes(defaultThemePalettes)
    setPreferences((current) => ({ ...current, themePalettes: palettes }))
    setCssCode(serializeThemePalettes(palettes, language))
    setMessage(text('已恢复默认配色。', 'Default palette restored.'))
  }

  return <section className="settings-pane palette-pane">
    <div className="settings-title"><span><Code2 size={18} /></span><div><h3>{text('全局配色', 'Global palette')}</h3><p>{text('逐项调色，或复制 CSS 交给 AI 调整后粘贴回来。', 'Adjust colors individually, or copy the CSS, edit it with AI, and paste it back.')}</p></div></div>
    <Tabs value={editingMode} onValueChange={(value) => setEditingMode(value as keyof ThemePalettes)}>
      <TabsList className="palette-tabs"><TabsTrigger value="light">{text('浅色配色', 'Light palette')}</TabsTrigger><TabsTrigger value="dark">{text('深色配色', 'Dark palette')}</TabsTrigger></TabsList>
      {(['light', 'dark'] as const).map((mode) => <TabsContent value={mode} key={mode} className="palette-grid">
        {themeColorFields.map(({ key, label }) => <label className="color-field" key={key}>
          <input type="color" value={preferences.themePalettes[mode][key]} onChange={(event) => updateColor(key, event.target.value)} aria-label={text(`${label}颜色`, `${themeColorLabelsEn[key]} color`)} />
          <span><strong>{language === 'zh' ? label : themeColorLabelsEn[key]}</strong><code>{themeCssVariables[key]}</code></span>
          <output>{preferences.themePalettes[mode][key]}</output>
        </label>)}
      </TabsContent>)}
    </Tabs>
    <div className="palette-safety"><ShieldCheck size={15} /><span>{text('已启用对比度检查；不可读的颜色组合不会保存。', 'Contrast checks are enabled; unreadable color combinations will not be saved.')}</span></div>
    <div className="palette-code-heading"><div><strong>{text('CSS 色板', 'CSS palette')}</strong><small>{text('保留变量名，并使用六位十六进制色码。', 'Keep variable names and use six-digit hex colors.')}</small></div><div><Button variant="outline" size="sm" onClick={reset}><RotateCcw />{text('恢复默认', 'Reset')}</Button><Button variant="outline" size="sm" onClick={() => void copyCss()}><Copy />{text('复制 CSS', 'Copy CSS')}</Button></div></div>
    <Textarea ref={cssInput} className="palette-code" value={cssCode} onChange={(event) => { setCssCode(event.target.value); setMessage('') }} spellCheck={false} aria-label={text('全局配色 CSS', 'Global palette CSS')} />
    <div className="palette-code-actions"><span role="status">{message}</span><Button onClick={applyCss}><ClipboardPaste />{text('应用 CSS', 'Apply CSS')}</Button></div>
  </section>
}
