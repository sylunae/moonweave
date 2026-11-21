export interface ThemePalette {
  bg: string
  surface: string
  surface2: string
  surface3: string
  sidebarBg: string
  text: string
  mutedText: string
  faint: string
  line: string
  brand: string
  accentSoft: string
  accentDeep: string
  redZone: string
  danger: string
  dangerSoft: string
  success: string
  successSoft: string
}

export interface ThemePalettes {
  light: ThemePalette
  dark: ThemePalette
}

export const themeColorFields: Array<{ key: keyof ThemePalette; label: string }> = [
  { key: 'bg', label: '页面背景' },
  { key: 'surface', label: '主要容器' },
  { key: 'surface2', label: '次级容器' },
  { key: 'surface3', label: '强调容器' },
  { key: 'sidebarBg', label: '侧边栏' },
  { key: 'text', label: '主要文字' },
  { key: 'mutedText', label: '次要文字' },
  { key: 'faint', label: '弱化文字' },
  { key: 'line', label: '边框分隔线' },
  { key: 'brand', label: '品牌主色' },
  { key: 'accentSoft', label: '浅强调色' },
  { key: 'accentDeep', label: '深强调色' },
  { key: 'redZone', label: '红区音符' },
  { key: 'danger', label: '危险状态' },
  { key: 'dangerSoft', label: '危险背景' },
  { key: 'success', label: '成功状态' },
  { key: 'successSoft', label: '成功背景' },
]

export const themeColorLabelsEn: Record<keyof ThemePalette, string> = {
  bg: 'Page background', surface: 'Primary surface', surface2: 'Secondary surface', surface3: 'Accent surface', sidebarBg: 'Sidebar',
  text: 'Primary text', mutedText: 'Secondary text', faint: 'Faint text', line: 'Borders and dividers', brand: 'Brand color',
  redZone: 'Red zone notes', accentSoft: 'Soft accent', accentDeep: 'Deep accent', danger: 'Danger state', dangerSoft: 'Danger background', success: 'Success state', successSoft: 'Success background',
}

export const themeCssVariables: Record<keyof ThemePalette, string> = {
  bg: '--bg', surface: '--surface', surface2: '--surface-2', surface3: '--surface-3', sidebarBg: '--sidebar-bg',
  text: '--text', mutedText: '--muted-text', faint: '--faint', line: '--line', brand: '--brand',
  redZone: '--red-zone', accentSoft: '--accent-soft', accentDeep: '--accent-deep', danger: '--danger', dangerSoft: '--danger-soft',
  success: '--success', successSoft: '--success-soft',
}

export const defaultThemePalettes: ThemePalettes = {
  light: {
    bg: '#eef2ff', surface: '#ffffff', surface2: '#e5e9f7', surface3: '#d9deef', sidebarBg: '#e7ebf8',
    text: '#101522', mutedText: '#596176', faint: '#747b93', line: '#c9d0e4', brand: '#0786a5',
    accentSoft: '#d7f7ff', accentDeep: '#075b70', redZone: '#a81d35', danger: '#bd285d', dangerSoft: '#ffe1eb',
    success: '#26744d', successSoft: '#dff7e9',
  },
  dark: {
    bg: '#070911', surface: '#0d101b', surface2: '#111522', surface3: '#171b29', sidebarBg: '#090c15',
    text: '#eef2ff', mutedText: '#747b93', faint: '#525a70', line: '#252a3a', brand: '#28d7ff',
    accentSoft: '#102733', accentDeep: '#8aeaff', redZone: '#b82540', danger: '#ff568f', dangerSoft: '#311521',
    success: '#67e8a4', successSoft: '#10271d',
  },
}

const colorPattern = /^#[0-9a-f]{6}$/i

export function normalizeThemePalettes(value?: Partial<Record<keyof ThemePalettes, Partial<ThemePalette>>>): ThemePalettes {
  const normalize = (mode: keyof ThemePalettes) => Object.fromEntries(themeColorFields.map(({ key }) => {
    const candidate = value?.[mode]?.[key]
    return [key, typeof candidate === 'string' && colorPattern.test(candidate) ? candidate.toLowerCase() : defaultThemePalettes[mode][key]]
  })) as unknown as ThemePalette
  return { light: normalize('light'), dark: normalize('dark') }
}

function rgb(color: string) {
  const value = Number.parseInt(color.slice(1), 16)
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255]
}

function luminance(color: string) {
  return rgb(color).map((channel) => {
    const value = channel / 255
    return value <= .03928 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4
  }).reduce((total, value, index) => total + value * [.2126, .7152, .0722][index], 0)
}

export function contrastRatio(foreground: string, background: string) {
  const [first, second] = [luminance(foreground), luminance(background)].sort((a, b) => b - a)
  return (first + .05) / (second + .05)
}

export function getThemeContrastIssue(palettes: ThemePalettes, language: 'zh' | 'en' = 'zh') {
  const checks: Array<{ foreground: keyof ThemePalette; backgrounds: Array<keyof ThemePalette>; minimum: number }> = [
    { foreground: 'text', backgrounds: ['bg', 'surface', 'surface2', 'surface3', 'sidebarBg'], minimum: 4.5 },
    { foreground: 'mutedText', backgrounds: ['bg', 'surface', 'surface2', 'sidebarBg'], minimum: 3 },
    { foreground: 'faint', backgrounds: ['bg', 'surface', 'sidebarBg'], minimum: 1.8 },
    { foreground: 'accentDeep', backgrounds: ['accentSoft'], minimum: 3 },
    { foreground: 'danger', backgrounds: ['dangerSoft', 'surface'], minimum: 3 },
    { foreground: 'redZone', backgrounds: ['surface'], minimum: 3 },
    { foreground: 'success', backgrounds: ['successSoft'], minimum: 3 },
  ]
  for (const mode of ['light', 'dark'] as const) {
    for (const check of checks) {
      for (const background of check.backgrounds) {
        const ratio = contrastRatio(palettes[mode][check.foreground], palettes[mode][background])
        if (ratio < check.minimum) {
          const foregroundLabel = language === 'zh' ? themeColorFields.find(({ key }) => key === check.foreground)?.label ?? check.foreground : themeColorLabelsEn[check.foreground]
          const backgroundLabel = language === 'zh' ? themeColorFields.find(({ key }) => key === background)?.label ?? background : themeColorLabelsEn[background]
          return language === 'zh'
            ? `${mode === 'light' ? '浅色' : '深色'}配色的「${foregroundLabel} / ${backgroundLabel}」对比度为 ${ratio.toFixed(1)}:1，至少需要 ${check.minimum}:1。`
            : `The “${foregroundLabel} / ${backgroundLabel}” contrast in the ${mode} palette is ${ratio.toFixed(1)}:1; at least ${check.minimum}:1 is required.`
        }
      }
    }
  }
  return null
}

export function accessibleForeground(...backgrounds: string[]) {
  const score = (foreground: string) => Math.min(...backgrounds.map((background) => contrastRatio(foreground, background)))
  return score('#ffffff') >= score('#202020') ? '#ffffff' : '#202020'
}

export function serializeThemePalettes(palettes: ThemePalettes, language: 'zh' | 'en' = 'zh') {
  const block = (selector: string, palette: ThemePalette) => `${selector} {\n${themeColorFields.map(({ key }) => `  ${themeCssVariables[key]}: ${palette[key]};`).join('\n')}\n}`
  return `${language === 'zh' ? '/* 全局配色：保留变量名并使用六位十六进制色码。 */' : '/* Global palette: keep variable names and use six-digit hex colors. */'}\n\n${block(':root', palettes.light)}\n\n${block(":root[data-theme='dark']", palettes.dark)}`
}

export function parseThemePalettes(css: string, current: ThemePalettes, language: 'zh' | 'en' = 'zh') {
  const next = normalizeThemePalettes(current)
  let changed = 0
  for (const [, selector, declarations] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const mode = selector.includes('dark') ? 'dark' : selector.includes(':root') ? 'light' : null
    if (!mode) continue
    for (const { key } of themeColorFields) {
      const variable = themeCssVariables[key].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const match = declarations.match(new RegExp(`${variable}\\s*:\\s*(#[0-9a-fA-F]{6})\\s*;?`))
      if (match) { next[mode][key] = match[1].toLowerCase(); changed += 1 }
    }
  }
  if (!changed) throw new Error(language === 'zh' ? '没有识别到支持的颜色变量。' : 'No supported color variables were found.')
  return next
}
