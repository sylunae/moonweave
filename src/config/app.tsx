import { Library, Piano } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

export const editorEffects = {
  title: { zh: '特效', en: 'Effects' },
  scrollSpeed: { zh: '变速', en: 'Scroll speed' },
} as const

export const bpmDetectionCopy = {
  analyzing: { zh: '音频已导入，正在检测 BPM…', en: 'Audio imported. Detecting BPM…' },
  title: { zh: '应用检测到的 BPM？', en: 'Apply detected BPM?' },
  uncertainTitle: { zh: 'BPM 检测结果不确定', en: 'Uncertain BPM estimate' },
  description: { zh: '仅修改初始 BPM，保留音符、特效、偏移和变速点的时间。可撤销。', en: 'Changes only the initial BPM. Note, effect, offset and tempo-change times are preserved. You can undo this.' },
  uncertain: { zh: '节奏不稳定或可能存在变速，请试听确认。', en: 'The rhythm is unclear or may change tempo. Check by listening.' },
  unavailable: { zh: '未找到稳定节奏，请手动设置 BPM。', en: 'No stable rhythm found. Set the BPM manually.' },
  unsupported: { zh: '已跳过 BPM 分析：支持 8 秒至 10 分钟、32 MB 以内的单声道或立体声音频。', en: 'BPM analysis skipped: supports mono/stereo audio from 8 seconds to 10 minutes, up to 32 MB.' },
  failed: { zh: 'BPM 分析失败：音频读取、解码或分析异常，请手动设置。', en: 'BPM analysis failed while reading, decoding or analyzing the audio. Set it manually.' },
  label: { zh: '初始 BPM（估算）', en: 'Initial BPM (estimate)' },
  half: { zh: '半速', en: 'Half' },
  double: { zh: '倍速', en: 'Double' },
  ignore: { zh: '忽略', en: 'Ignore' },
  apply: { zh: '应用 BPM', en: 'Apply BPM' },
  applied: { zh: '已应用初始 BPM，可撤销', en: 'Initial BPM applied. You can undo this.' },
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
