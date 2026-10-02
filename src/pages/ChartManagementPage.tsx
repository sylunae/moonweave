import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { Download, FileUp, FolderOpen, Music2, Plus, Trash2 } from 'lucide-react'
import { navigate } from '@/app/navigation'
import { useI18n } from '@/app/i18n'
import { useSound } from '@/app/sound'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { useChart } from '@/features/chart/ChartProvider'

const formatUpdatedAt = (value: number, locale: string) => new Intl.DateTimeFormat(locale, {
  month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
}).format(value)

export default function ChartManagementPage() {
  const { locale, text } = useI18n()
  const { play } = useSound()
  const {
    activeChartId, charts, libraryReady, createChart, selectChart, deleteChart,
    importChart, exportChart, revealLibrary,
  } = useChart()
  const [deleteId, setDeleteId] = useState('')
  const [focusedId, setFocusedId] = useState(activeChartId)
  const listRef = useRef<HTMLDivElement>(null)
  const itemRefs = useRef(new Map<string, HTMLElement>())
  const scrollFrame = useRef<number | null>(null)
  const focusedIdRef = useRef(focusedId)
  const initiallyCentered = useRef(false)

  focusedIdRef.current = focusedId

  useEffect(() => {
    if (!charts.some((item) => item.id === focusedIdRef.current)) setFocusedId(activeChartId || charts[0]?.id || '')
  }, [activeChartId, charts])

  useEffect(() => {
    if (initiallyCentered.current || !focusedId) return
    const frame = requestAnimationFrame(() => {
      itemRefs.current.get(focusedId)?.scrollIntoView({ block: 'center' })
      initiallyCentered.current = true
    })
    return () => cancelAnimationFrame(frame)
  }, [focusedId])

  const focusChart = useCallback((id: string, behavior: ScrollBehavior = 'smooth') => {
    focusedIdRef.current = id
    setFocusedId(id)
    itemRefs.current.get(id)?.scrollIntoView({ block: 'center', behavior })
  }, [])

  const updateFocusFromScroll = useCallback(() => {
    scrollFrame.current = null
    const list = listRef.current
    if (!list) return
    const center = list.getBoundingClientRect().top + list.clientHeight / 2
    let nearestId = ''
    let nearestDistance = Number.POSITIVE_INFINITY
    for (const [id, element] of itemRefs.current) {
      const rect = element.getBoundingClientRect()
      const distance = Math.abs(rect.top + rect.height / 2 - center)
      if (distance < nearestDistance) { nearestDistance = distance; nearestId = id }
    }
    if (nearestId && nearestId !== focusedIdRef.current) {
      focusedIdRef.current = nearestId
      setFocusedId(nearestId)
      play('tick')
    }
  }, [play])

  const handleScroll = () => {
    if (scrollFrame.current === null) scrollFrame.current = requestAnimationFrame(updateFocusFromScroll)
  }

  useEffect(() => () => {
    if (scrollFrame.current !== null) cancelAnimationFrame(scrollFrame.current)
  }, [])

  const handleListKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!charts.length) return
    const index = Math.max(0, charts.findIndex((item) => item.id === focusedId))
    let next = index
    if (event.key === 'ArrowDown') next = Math.min(charts.length - 1, index + 1)
    else if (event.key === 'ArrowUp') next = Math.max(0, index - 1)
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = charts.length - 1
    else if (event.key === 'Enter') { event.preventDefault(); void openChart(charts[index].id); return }
    else return
    event.preventDefault()
    focusChart(charts[next].id)
    play('tick')
  }

  const openChart = async (id: string) => {
    if (await selectChart(id)) navigate('editor')
  }
  const createAndOpen = async () => {
    if (await createChart()) navigate('editor')
  }
  const importAndOpen = async () => {
    if (await importChart()) navigate('editor')
  }
  const focusedChart = charts.find((item) => item.id === focusedId)

  return <div className="page page-enter chart-management-page">
    <header className="page-header chart-page-header">
      <h1 className="sr-only">{text('我的谱面', 'My Charts')}</h1>
      <div className="page-actions">
        <Button variant="outline" onClick={() => void revealLibrary()}><FolderOpen />{text('存储位置', 'Storage location')}</Button>
        <Button variant="outline" onClick={() => void importAndOpen()}><FileUp />{text('导入谱面', 'Import chart')}</Button>
        <Button onClick={() => void createAndOpen()}><Plus />{text('新建谱面', 'New chart')}</Button>
      </div>
    </header>

    <section className="chart-library-stage">
      {libraryReady && charts.length === 0 ? <div className="chart-library-empty">
        <Music2 />
        <strong>{text('还没有谱面', 'No charts yet')}</strong>
        <Button onClick={() => void createAndOpen()}><Plus />{text('新建谱面', 'New chart')}</Button>
      </div> : <div className="chart-library-viewport">
        {focusedChart?.coverUrl && <div className="chart-library-backdrop" aria-hidden="true"><img key={focusedChart.coverUrl} src={focusedChart.coverUrl} alt="" /></div>}
        <div ref={listRef} className="chart-library-list" tabIndex={0} role="listbox" aria-label={text('谱面列表', 'Chart list')} aria-activedescendant={focusedId ? `chart-library-${focusedId}` : undefined} onScroll={handleScroll} onKeyDown={handleListKeyDown}>
          {charts.map((item, index) => {
            const focused = item.id === focusedId
            return <article
              id={`chart-library-${item.id}`}
              key={item.id}
              ref={(element) => { if (element) itemRefs.current.set(item.id, element); else itemRefs.current.delete(item.id) }}
              className={`chart-library-item${item.id === activeChartId ? ' active' : ''}`}
              data-focused={focused}
              data-sound={focused ? 'confirm' : 'press'}
              role="option"
              aria-selected={focused}
              onClick={() => focusChart(item.id)}
              onDoubleClick={() => void openChart(item.id)}
            >
              <span className="chart-library-index">{String(index + 1).padStart(2, '0')}</span>
              <span className="chart-cover">{item.coverUrl ? <img src={item.coverUrl} alt="" /> : <Music2 />}</span>
              <button className="chart-library-select" data-sound={focused ? 'confirm' : 'press'} onFocus={() => focusChart(item.id)} onClick={(event) => { event.stopPropagation(); focused ? void openChart(item.id) : focusChart(item.id) }}>
                <span className="chart-library-copy">
                  <strong>{item.title || text('未命名谱面', 'Untitled chart')}</strong>
                  <small>{item.artist || text('未知艺术家', 'Unknown artist')} <b>·</b> {item.noteCount} NOTES</small>
                </span>
                <span className="chart-library-meta"><time dateTime={new Date(item.updatedAt).toISOString()}>{formatUpdatedAt(item.updatedAt, locale)}</time></span>
              </button>
              <div className="chart-library-item-actions">
                <Button variant="ghost" size="icon-sm" title={text('导出谱面', 'Export chart')} aria-label={text(`导出 ${item.title || '未命名谱面'}`, `Export ${item.title || 'untitled chart'}`)} onClick={(event) => { event.stopPropagation(); void exportChart(item.id) }}><Download /></Button>
                <Button variant="ghost" size="icon-sm" title={text('删除谱面', 'Delete chart')} aria-label={text(`删除 ${item.title || '未命名谱面'}`, `Delete ${item.title || 'untitled chart'}`)} onClick={(event) => { event.stopPropagation(); setDeleteId(item.id) }}><Trash2 /></Button>
              </div>
            </article>
          })}
        </div>
      </div>}
    </section>

    <AlertDialog open={Boolean(deleteId)} onOpenChange={(open) => { if (!open) setDeleteId('') }}>
      <AlertDialogContent><AlertDialogHeader><AlertDialogTitle>{text('删除这份谱面？', 'Delete this chart?')}</AlertDialogTitle><AlertDialogDescription>{text('谱面数据与内部保存的音频、背景媒体都会被永久删除。此操作无法撤销。', 'The chart and its saved audio and background media will be permanently deleted. This cannot be undone.')}</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>{text('取消', 'Cancel')}</AlertDialogCancel><AlertDialogAction variant="destructive" onClick={() => { const id = deleteId; setDeleteId(''); void deleteChart(id) }}>{text('删除谱面', 'Delete chart')}</AlertDialogAction></AlertDialogFooter></AlertDialogContent>
    </AlertDialog>
  </div>
}
