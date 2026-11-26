import type { Plugin } from 'vite'
import { defaultThemePalettes, themeCssVariables } from '../app/theme'

export const englishAppName = 'Moonweave'

export const startupCopy = {
  zh: '正在启动应用…',
  en: 'Starting the app…',
} as const

export function startupHtml(): Plugin {
  const startupColors = ['bg', 'surface', 'text', 'mutedText', 'line', 'brand', 'accentDeep'] as const
  const themeRule = (theme: keyof typeof defaultThemePalettes, selector: string) =>
    `:where(${selector}) { ${startupColors.map((key) => `${themeCssVariables[key]}: ${defaultThemePalettes[theme][key]};`).join(' ')} }`

  return {
    name: 'moonweave-startup-html',
    transformIndexHtml: {
      order: 'post',
      handler(html) {
        const stylesheetSlot = '<!-- app-stylesheets -->'
        if (!html.includes(stylesheetSlot)) return html

        const stylesheets: string[] = []
        // Let the browser paint the splash while fetching Vite's application stylesheet.
        return html.replace(/^[ \t]*(<link rel="stylesheet"[^>]*>)[ \t]*\r?\n/gm, (_, tag: string) => {
          stylesheets.push(tag)
          return ''
        }).replace(stylesheetSlot, stylesheets.join('\n    '))
          .replaceAll('<!-- startup-wordmark -->', englishAppName)
          .replace('/* startup-theme-colors */', [
            themeRule('light', ':root'),
            themeRule('dark', ':root[data-theme="dark"]'),
          ].join('\n      '))
      },
    },
  }
}
