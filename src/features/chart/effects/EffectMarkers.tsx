import { useMemo } from 'react'
import { Pause } from 'lucide-react'
import { useI18n } from '@/app/i18n'
import { editorEffects } from '@/config/app'
import { createEditorNoteIndex, visibleEditorNotes } from '../editorTimeline'
import { effectLabel } from './labels'
import type { ChartEffect } from './scrollSpeed'

interface Props {
  effects: ChartEffect[]
  from: number
  to: number
  height: number
  yAt(time: number): number
  onEdit(effect: ChartEffect): void
}

export function EffectMarkers({ effects, from, to, height, yAt, onEdit }: Props) {
  const { text } = useI18n()
  const { index, byId } = useMemo(() => ({
    index: createEditorNoteIndex(effects.map((effect) => ({ ...effect, lane: 0, kind: effect.transition === 'linear' ? 'hold' : 'note' }))),
    byId: new Map(effects.map((effect) => [effect.id, effect])),
  }), [effects])
  return <div className="effect-marker-rail" aria-label={text('特效标记', 'Effect markers')}>
    {visibleEditorNotes(index, from, to).map((marker) => {
      const effect = byId.get(marker.id)!
      const top = Math.max(0, yAt(effect.endTime ?? effect.time))
      const bottom = Math.min(height, yAt(effect.time))
      const curve = editorEffects.curves[effect.curve ?? 'linear']
      const label = `${effectLabel(effect, effects)} · ${effect.transition === 'linear' ? text(curve.zh, curve.en) : text('瞬时', 'Instant')}`
      return <button key={effect.id} className="effect-marker" title={label} aria-label={label} data-transition={effect.transition} style={{ top, height: Math.max(26, bottom - top) }} onPointerDown={(event) => event.stopPropagation()} onClick={() => onEdit(effect)}>
        <span>{effect.multiplier === 0 && <Pause aria-label={text('停速', 'Stop')} />}{effectLabel(effect, effects)}</span>
      </button>
    })}
  </div>
}
