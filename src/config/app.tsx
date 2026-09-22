import { Piano } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

export type RouteId = 'editor' | 'playtest'

export interface NavigationItem {
  id: RouteId
  label: string
  description: string
  icon: LucideIcon
}

export const appConfig = {
  name: import.meta.env.VITE_APP_NAME || 'Moonweave',
  shortName: 'Moonweave',
  eyebrow: 'CHART STUDIO',
  description: import.meta.env.VITE_APP_DESCRIPTION || '专注于 4K 下落式节奏谱面的桌面制谱工具。',
  navigation: [
    { id: 'editor', label: '谱面编辑器', description: '制谱、设置与试玩', icon: Piano },
  ] satisfies NavigationItem[],
} as const

export function isRouteId(value: string): value is RouteId {
  return value === 'editor' || value === 'playtest'
}
