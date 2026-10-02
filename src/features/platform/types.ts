import type { Chart } from '@/features/chart/types'

export interface OfficialPlaySession {
  kind: 'official'
  chart: Chart
  audioUrl: string
  backgroundUrl: string
  returnRoute: 'manage' | 'editor'
}
