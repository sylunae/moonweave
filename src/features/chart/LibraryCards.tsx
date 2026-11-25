import { useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type RefObject, type ReactNode } from 'react'
import { useI18n } from '@/app/i18n'
import type { ChartLibraryItem } from '@/shared/electron'
import { tiers } from './libraryMetadata'
import type { Chart } from './types'

export const clockTime = (ms: number) => Math.floor(ms / 60000) + ':' + String(Math.floor(ms / 1000) % 60).padStart(2,'0')

export function ChartCover({ item, children }: { item: ChartLibraryItem; children?: ReactNode }) {
  // Preview renderer can mount over the jacket without replacing the cover.
  return <span className="record-art">
    {item.coverUrl ? <img src={item.coverUrl} alt="" loading="lazy" /> : <span className="record-art-type" aria-hidden><small>MOONWEAVE</small><b>{item.title.slice(0,2).toUpperCase() || 'MW'}</b><i>4K ／ CHART</i></span>}
    {children}
  </span>
}
export function highlight(value: string, query: string) {
  const index = value.toLowerCase().indexOf(query.toLowerCase())
  return query && index >= 0 ? <>{value.slice(0,index)}<mark>{value.slice(index,index+query.length)}</mark>{value.slice(index+query.length)}</> : value
}
export function ChartCard({ item, index, distance, tier, query, status, onSelect, onOpen }: { item: ChartLibraryItem; index: number; distance: number; tier: number; query: string; status: string; onSelect(): void; onOpen(): void }) {
  const { text, locale } = useI18n()
  return <button className="record-row" role="option" aria-selected={distance === 0} tabIndex={distance === 0 ? 0 : -1} data-id={item.id} style={{ '--level-color': ['var(--success)','var(--accent-deep)','var(--warning)','var(--danger)'][tier], '--shift': (distance === 0 ? 22 : Math.max(-2,14 - Math.sqrt(distance)*8)) + 'px' } as CSSProperties} onClick={onSelect} onDoubleClick={onOpen}>
    <span className="record-inner"><span className="record-index">{String(index + 1).padStart(2,'0')}</span><ChartCover item={item} />
    <span className="record-copy"><strong>{highlight(item.title || text('未命名谱面','Untitled'),query)}</strong><span><em className={'record-status '+item.library.status}>{status}</em>{highlight(item.artist || text('未知艺术家','Unknown artist'),query)}<span className="record-dots" aria-hidden>{item.library.levels.map((level,i) => level ? <i key={i} data-tier={i} /> : null)}</span><small className="record-notes">{item.noteCount} NOTES</small></span></span>
    <span className="record-level"><b>{item.library.levels[tier] || '—'}</b><small>{new Date(item.updatedAt).toLocaleDateString(locale,{month:'2-digit',day:'2-digit'})}</small></span></span>
  </button>
}
const formatCount = (value: number) => String(Math.round(value))
const formatRate = (value: number) => value.toFixed(1) + '/s'

function RollingStat({ label, value, format = formatCount }: {
  label: string; value?: number; format?(value: number): string
}) {
  const output = useRef<HTMLElement>(null)
  const displayed = useRef(0)
  useLayoutEffect(() => {
    const el = output.current
    if (!el || value === undefined) return
    const from = displayed.current
    const writeValue = (n: number) => {
      displayed.current = n
      el.textContent = format(n)
    }
    if (from === value || document.documentElement.dataset.reduceMotion === 'true' ||
        window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      writeValue(value)
      return
    }
    const start = performance.now()
    writeValue(from)
    let frame = 0
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / 480)
      writeValue(from + (value - from) * (1 - (1 - t) ** 3))
      if (t < 1) frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [value, format])
  return <div><small>{label}</small><b ref={output} aria-hidden>{value === undefined ? '—' : format(value)}</b>
    <span className="sr-only">{value === undefined ? '—' : format(value)}</span></div>
}

export function ChartStats({ chart }: { chart?: Chart }) {
  const { text } = useI18n()
  return <div className="record-stats">
    <RollingStat label={text('物量', 'Notes')} value={chart?.notes.length} />
    <RollingStat label="BPM" value={chart?.bpm} />
    <RollingStat label={text('时长', 'Duration')} value={chart?.duration} format={clockTime} />
    <RollingStat label={text('平均密度', 'Density')} value={chart && chart.notes.length * 1000 / chart.duration} format={formatRate} />
  </div>
}

const bucketCount = 64
export function noteDensityBins(chart?: Pick<Chart, 'duration' | 'notes'>) {
  const counts = Array<number>(bucketCount).fill(0)
  if (chart && chart.duration > 0) {
    for (const note of chart.notes) {
      const index = Math.floor(note.time / chart.duration * bucketCount)
      counts[Math.max(0, Math.min(bucketCount - 1, index))]++
    }
  }
  return counts
}

export function DensityGraph({ chart, tier, onPreview, playhead }: { chart?: Chart; tier: number; playhead?: RefObject<HTMLSpanElement | null>; onPreview?(fraction: number): void }) {
  const { text } = useI18n()
  const [hover, setHover] = useState<number | null>(null)
  const bins = useMemo(() => noteDensityBins(chart), [chart])
  const peak = Math.max(1, ...bins)
  const duration = chart?.duration ?? 0
  const caption = !chart ? text('读取中…', 'Loading…') : !chart.notes.length ? text('尚无音符', 'No notes yet') :
    hover === null ? '0:00 – ' + clockTime(duration) :
    clockTime(duration * hover / bucketCount) + ' – ' + clockTime(duration * (hover + 1) / bucketCount) + ' · ' + bins[hover] + ' ' + text('个音符', 'notes')
  return <figure className="density-graph" aria-busy={!chart}>
    <figcaption><span>{tiers[tier]} · {text('物量密度', 'Note density')}</span><span>{caption}</span></figcaption>
    <button type="button" className="library-density-bars" disabled={!chart} aria-label={text('从物量图位置试听', 'Preview from density graph')} onPointerMove={event => {
      const bounds = event.currentTarget.getBoundingClientRect()
      const index = Math.floor((event.clientX - bounds.left) * bucketCount / bounds.width)
      setHover(Math.max(0, Math.min(bucketCount - 1, index)))
    }} onPointerLeave={() => setHover(null)} onClick={event => {
      const bounds = event.currentTarget.getBoundingClientRect()
      const fraction = event.detail && bounds.width ? (event.clientX - bounds.left) / bounds.width : 0
      onPreview?.(Math.max(0, Math.min(1 - 1 / bucketCount, fraction)))
    }}>
      {bins.map((count, i) => <i aria-hidden key={i} data-hot={hover === i} style={{height: `max(2px, ${count / peak * 100}%)`, transitionDelay: i * 4 + 'ms, 0ms'}} />)}
      {playhead && <span className="density-playhead" ref={playhead} aria-hidden/>}
    </button>
  </figure>
}
