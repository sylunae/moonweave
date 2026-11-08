import { useRef } from 'react'
import { useI18n } from '@/app/i18n'
import { editorEffects } from '@/config/app'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select'
import { curvePoints, curvePresets, curveProgress, validBezier, type BezierPoints, type CurveName } from './curves'
import type { EffectDraft } from './EffectsModule'

export function CurveEditor({ draft, from, onChange }: { draft: EffectDraft; from: number; onChange(draft: EffectDraft): void }) {
  const { text } = useI18n()
  const svg = useRef<SVGSVGElement>(null)
  const drag = useRef<number | null>(null)
  const name = draft.curve ?? 'linear'
  const raw = curvePoints(name, draft.bezier)
  const points = validBezier([...raw]) ? raw : curvePresets.easeInOut
  const target = Number(draft.multiplier)
  const decreasing = Number.isFinite(target) && target < from
  const y = (p: number) => 140 - (decreasing ? 1 - p : p) * 120
  const path = Array.from({ length: 81 }, (_, i) => `${i ? 'L' : 'M'} ${20 + i * 3.5} ${y(curveProgress(i / 80, points))}`).join(' ')
  const setPoints = (next: BezierPoints) => onChange({ ...draft, curve: 'custom', bezier: next, controlTexts: undefined })
  const move = (clientX: number, clientY: number) => {
    if (drag.current === null || !svg.current) return
    const box = svg.current.getBoundingClientRect()
    const clamp = (value: number) => Math.round(Math.max(0, Math.min(1, value)) * 1000) / 1000
    const next = [...points] as BezierPoints
    next[drag.current * 2] = clamp((clientX - box.left) / box.width * 320 / 280 - 20 / 280)
    const progress = clamp((140 - (clientY - box.top) / box.height * 160) / 120)
    next[drag.current * 2 + 1] = decreasing ? 1 - progress : progress
    setPoints(next)
  }
  return <div className="effect-curve-editor">
    <label><span>{text(editorEffects.curve.zh, editorEffects.curve.en)}</span>
      <Select value={name} onValueChange={(curve: CurveName) => onChange({ ...draft, curve, bezier: draft.bezier ?? [0.42, 0, 0.58, 1], controlTexts: undefined })}>
        <SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{Object.entries(editorEffects.curves).map(([value, label]) => <SelectItem key={value} value={value}>{text(label.zh, label.en)}</SelectItem>)}</SelectContent>
      </Select>
    </label>
    <figure className="effect-curve-preview">
      <figcaption><span>{text(editorEffects.preview.zh, editorEffects.preview.en)}</span><strong>×{Number(from.toFixed(3))} → ×{Number.isFinite(target) ? target : '—'}</strong></figcaption>
      <svg ref={svg} viewBox="0 0 320 160" aria-label={text(editorEffects.preview.zh, editorEffects.preview.en)}
        onPointerMove={(e) => { if (drag.current !== null) move(e.clientX, e.clientY) }}
        onPointerUp={() => { drag.current = null }} onPointerCancel={() => { drag.current = null }}>
        <path className="effect-curve-grid" d="M20 20H300 M20 80H300 M20 140H300 M20 20V140 M160 20V140 M300 20V140" />
        {name === 'custom' && <path className="effect-curve-handles" d={`M20 ${y(0)}L${20 + points[0] * 280} ${y(points[1])} M300 ${y(1)}L${20 + points[2] * 280} ${y(points[3])}`} />}
        <path className="effect-curve-line" d={path} />
        {name === 'custom' && [0, 1].map((index) => <circle key={index} className="effect-curve-handle" cx={20 + points[index * 2] * 280} cy={y(points[index * 2 + 1])} r="7"
          onPointerDown={(e) => { e.preventDefault(); drag.current = index; e.currentTarget.setPointerCapture(e.pointerId) }} />)}
      </svg>
      <div className="effect-curve-axis"><span>{text(editorEffects.start.zh, editorEffects.start.en)}</span><span>{text(editorEffects.end.zh, editorEffects.end.en)}</span></div>
    </figure>
    {name === 'custom' && <>
      <div className="effect-control-fields">{['X1', 'Y1', 'X2', 'Y2'].map((label, index) => <label key={label}><span>{label}</span><Input inputMode="decimal" aria-label={`${text(editorEffects.control.zh, editorEffects.control.en)} ${label}`} value={draft.controlTexts?.[index] ?? String(points[index])} onChange={(e) => {
        const texts = draft.controlTexts ? [...draft.controlTexts] : points.map(String)
        texts[index] = e.target.value
        onChange({ ...draft, controlTexts: texts, bezier: texts.map((v) => v.trim() ? Number(v) : NaN) as BezierPoints })
      }} /></label>)}</div>
      <Button variant="ghost" size="sm" onClick={() => setPoints([0.42, 0, 0.58, 1])}>{text('重置控制点', 'Reset control points')}</Button>
    </>}
  </div>
}
