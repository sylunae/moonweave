import { Library, Piano } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

export const editorEffects = {
  title: { zh: '特效', en: 'Effects' },
  scrollSpeed: { zh: '变速', en: 'Scroll speed' },
} as const

export type RouteId = 'manage' | 'editor' | 'playtest'

export interface NavigationItem {
  id: Exclude<RouteId, 'playtest'>
  label: { zh: string; en: string }
  description: { zh: string; en: string }
  icon: LucideIcon
}

export interface NavigationGroup {
  items: NavigationItem[]
}

export const appConfig = {
  name: import.meta.env.VITE_APP_NAME || '织月制谱',
  englishName: 'Moonweave',
  shortName: '织月制谱',
  eyebrow: 'CHART STUDIO',
  description: import.meta.env.VITE_APP_DESCRIPTION || '织月制谱（Moonweave Chart Editor）——专注于 4K 下落式节奏谱面的桌面制谱工具。',
  navigation: [{
    items: [
      { id: 'manage', label: { zh: '我的谱面', en: 'My Charts' }, description: { zh: '管理内部谱面库', en: 'Manage the local chart library' }, icon: Library },
      { id: 'editor', label: { zh: '编辑器', en: 'Editor' }, description: { zh: '编辑当前谱面', en: 'Edit the current chart' }, icon: Piano },
    ],
  }] satisfies NavigationGroup[],
} as const

export function isRouteId(value: string): value is RouteId {
  return value === 'manage' || value === 'editor' || value === 'playtest'
}
