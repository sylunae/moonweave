import { FileCog, Gamepad2, Music4, Piano } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

export type RouteId = 'setup' | 'editor' | 'playtest'

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
  navigation: [{
    id: 'chart-making', label: '谱面制作', icon: Music4,
    children: [
      { id: 'setup', label: '谱面配置', description: '歌曲与玩法参数', icon: FileCog },
      { id: 'editor', label: '制谱编辑器', description: '4K 时间轴与音符编辑', icon: Piano },
      { id: 'playtest', label: '谱面试玩', description: 'WebGL2 高性能预览', icon: Gamepad2 },
    ] satisfies NavigationItem[],
  }],
} as const

export function isRouteId(value: string): value is RouteId {
  return appConfig.navigation.some((group) => group.children.some((item) => item.id === value))
}
