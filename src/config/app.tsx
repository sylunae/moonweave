import { Library, Piano } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

export type RouteId = 'home' | 'manage' | 'editor' | 'playtest'

export interface NavigationItem {
  id: Exclude<RouteId, 'home' | 'playtest'>
  label: string
  description: string
  icon: LucideIcon
}

export interface NavigationGroup {
  label: string
  items: NavigationItem[]
}

export const appConfig = {
  name: import.meta.env.VITE_APP_NAME || 'Moonweave',
  shortName: 'Moonweave',
  eyebrow: 'CHART STUDIO',
  description: import.meta.env.VITE_APP_DESCRIPTION || '专注于 4K 下落式节奏谱面的桌面制谱工具。',
  navigation: [{
    label: '谱面制作',
    items: [
      { id: 'manage', label: '管理', description: '管理内部谱面库', icon: Library },
      { id: 'editor', label: '编辑器', description: '编辑当前谱面', icon: Piano },
    ],
  }] satisfies NavigationGroup[],
} as const

export function isRouteId(value: string): value is RouteId {
  return value === 'home' || value === 'manage' || value === 'editor' || value === 'playtest'
}
