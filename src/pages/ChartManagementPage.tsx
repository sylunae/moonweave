import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, FileUp, Library, Plus, Volume2, VolumeX } from 'lucide-react'
import { navigate } from '@/app/navigation'
import { useI18n } from '@/app/i18n'
import { useSound } from '@/app/sound'
import { PlayerMenu } from '@/components/PlayerMenu'
import { ClickParticles, GameButton, GameSearch, GameTabs } from '@/components/ui/game-controls'
import { HoldConfirm } from '@/components/ui/hold-confirm'
import { GameSelect } from '@/components/ui/game-select'
import { LibraryAtmosphere } from '@/features/chart/LibraryAtmosphere'
import { useCoverColor } from '@/features/chart/coverColor'
import { AlertDialog, AlertDialogContent, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel } from '@/components/ui/alert-dialog'
import { useChart } from '@/features/chart/ChartProvider'
import { DEFAULT_CHART, normalizeChart, type Chart } from '@/features/chart/types'
import { chooseDifficulty, tiers } from '@/features/chart/libraryMetadata'
import { ChartCard, ChartCover, DensityGraph, ChartStats } from '@/features/chart/LibraryCards'
import { LibraryPreview } from '@/features/chart/LibraryPreview'
import { LibraryForm } from '@/features/chart/LibraryForm'
import { usePlatform } from '@/features/platform/PlatformProvider'
import { appConfig } from '@/config/app'

export default function ChartManagementPage({ onSettings }: { onSettings(): void }) {
  const { text, locale, language } = useI18n()
  const sound = useSound()
  const api = useChart()
  const platform = usePlatform()
  const [playId, setPlayId] = useState('')
  useEffect(() => {
    if (!playId || playId !== api.activeChartId) return
    platform.startOfficialPlay({ kind: 'official', chart: api.chart, audioUrl: api.audioUrl, backgroundUrl: api.backgroundUrl, returnRoute: 'manage' })
    navigate('playtest')
    setPlayId('')
  }, [playId, api.activeChartId, api.chart, api.audioUrl, api.backgroundUrl, platform])
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState('all')
  const [sort, setSort] = useState('date')
  const [selection, setSelection] = useState(api.activeChartId)
  const [tierChoice, setTierChoice] = useState<{id: string; tier: number} | null>(null)
  const [limit, setLimit] = useState(60)
  const [mobileDetail, setMobileDetail] = useState(false)
  const [form, setForm] = useState<'new' | 'edit' | null>(null)
  const [pendingDelete, setPendingDelete] = useState<{id: string; title: string} | null>(null)
  const deleting = Boolean(pendingDelete)
  const [loaded, setLoaded] = useState<{id: string; chart: Chart} | null>(null)
  const [preview, setPreview] = useState<{id: string; tier: number; fraction: number} | null>(null)
  const previewTime = useRef<HTMLSpanElement>(null)
  const playhead = useRef<HTMLSpanElement>(null)
  const closePreview = useCallback(() => setPreview(null), [])
  const search = useRef<HTMLInputElement>(null)
  const list = useRef<HTMLDivElement>(null)
  const rowPositions = useRef(new Map<string, number>())
  const lock = useRef(false)
  const needle = query.trim().toLowerCase()
  const items = useMemo(() => api.charts.filter(c => (filter === 'all' || c.library.status === filter) && [c.title,c.artist,...c.library.tags].some(v => v.toLowerCase().includes(needle))).sort((a,b) => {
    if (sort === 'title') return a.title.localeCompare(b.title,locale)
    if (sort === 'notes') return b.noteCount-a.noteCount
    if (sort === 'level') return Math.max(...b.library.levels)-Math.max(...a.library.levels)
    return b.updatedAt-a.updatedAt
  }),[api.charts, filter, needle, sort, locale])
  const index = Math.max(0,items.findIndex(c => c.id === selection))
  const item = items[index]
  const sceneColor = useCoverColor(item?.coverUrl)
  const id = item?.id
  const activeChart = id === api.activeChartId ? api.chart : loaded?.id === id ? loaded?.chart : undefined
  const tier = tierChoice?.id === id && tierChoice && item?.library.levels[tierChoice.tier] ? tierChoice.tier : item?.library.tier ?? 1
  const chart = useMemo(() => activeChart && chooseDifficulty(activeChart,tier),[activeChart,tier])
  const previewing = !!preview && preview.id === id && preview.tier === tier
  useEffect(closePreview, [id, tier, form, deleting, closePreview])
  const startPreview = (fraction: number) => { if (id && chart) setPreview({id, tier, fraction}) }
  const previewLabel = previewing ? text('退出预览', 'Exit preview') : text('试听预览', 'Preview chart')
  useLayoutEffect(() => {
    if (!list.current) return
    const animate = document.documentElement.dataset.reduceMotion !== 'true' &&
      !window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const next = new Map<string, number>()
    const rows = Array.from(list.current.querySelectorAll<HTMLElement>('.record-row'), row => ({
      row, key: row.dataset.id!, top: row.offsetTop,
    }))
    const animations: Animation[] = []
    for (const { row, key, top } of rows) {
      const previous = rowPositions.current.get(key)
      next.set(key, top)
      if (animate && previous !== undefined && Math.abs(previous - top) > 2 && row.animate) {
        animations.push(row.animate([{ translate: `0 ${previous - top}px` }, { translate: '0 0' }],
          { duration: 360, easing: 'cubic-bezier(.2,.9,.3,1)' }))
      }
    }
    rowPositions.current = next
    return () => animations.forEach(animation => animation.cancel())
  }, [items, limit, index])
  const { inspectChart, showToast } = api
  useEffect(() => {
    if (!id || id === api.activeChartId) return
    let live = true
    inspectChart(id).then(value => { if (live && value) setLoaded({id,chart:value}) }).catch(err => { if (live) showToast(String(err)) })
    return () => { live = false }
  },[id,item?.updatedAt,api.activeChartId,inspectChart,showToast])
  useEffect(() => {
    const row = list.current?.querySelector<HTMLElement>('[aria-selected=true]')
    row?.scrollIntoView?.({ block: 'nearest' })
  },[id,index])
  const statuses: Record<string,string> = { all:text('全部','All'), published:text('已发布','Published'), draft:text('草稿','Draft'), private:text('仅自己','Private') }
  const reset = () => { setQuery(''); setFilter('all'); setLimit(60) }
  const select = (next: string) => { setSelection(next); setMobileDetail(true); sound.play('tick') }
  const run = async (operation: () => Promise<void>) => {
    if (lock.current) return
    lock.current = true
    try { await operation() } catch (error) { showToast(String(error)) } finally { lock.current = false }
  }
  const open = (route: 'editor' | 'playtest', target = id) => void run(async () => {
    if (!target) return
    if (target === id && chart && chart !== activeChart && !await api.saveLibraryChart(target,chart)) return
    if (await api.selectChart(target)) { if (route === 'playtest') setPlayId(target); else navigate(route) }
  })
  const chooseTier = (n: number) => { if (item?.library.levels[n]) { setTierChoice({id:item.id,tier:n}); sound.play('tick') } }
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (form || deleting || e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented || document.querySelector('[role=dialog],[role=alertdialog],[role=menu],[role=listbox][data-state=open]')) return
      const target = e.target instanceof Element ? e.target : null
      const k = e.key.toLowerCase()
      if (k === 'escape' && previewing) { e.preventDefault(); closePreview(); return }
      if (target === search.current) {
        if (k === 'escape') { setQuery(''); search.current?.blur() }
        if (k === 'enter' || k === 'arrowdown') { e.preventDefault(); list.current?.querySelector<HTMLElement>('[aria-selected=true]')?.focus() }
        return
      }
      if (target?.closest('input,textarea,select,[role=combobox],[data-slot=toggle-group]')) return
      if (k === '/') { e.preventDefault(); search.current?.focus(); return }
      if (!item) return
      if (['arrowup','arrowdown','home','end'].includes(k)) {
        e.preventDefault()
        const n = k === 'home' ? 0 : k === 'end' ? items.length-1 : Math.min(items.length-1,Math.max(0,index+(k === 'arrowdown' ? 1 : -1)))
        setSelection(items[n].id); sound.play('tick')
        requestAnimationFrame(() => list.current?.querySelector<HTMLElement>('[aria-selected=true]')?.focus({preventScroll:true}))
      } else if (k === 'arrowleft' || k === 'arrowright') {
        e.preventDefault(); const step = k === 'arrowleft' ? -1 : 1
        for (let i=tier+step;i>=0 && i<4;i+=step) if (item.library.levels[i]) { chooseTier(i); break }
      } else if (k === 'enter' && (!target?.closest('button') || target.closest('.record-row'))) { e.preventDefault(); open('editor') }
      else if (!e.repeat && chart) {
        if (k === 't') open('playtest')
        if (k === 'e') setForm('edit')
        if (k === 'delete') setPendingDelete({ id: item.id, title: item.title })
        if (k === 'escape') setMobileDetail(false)
      }
    }
    window.addEventListener('keydown',key)
    return () => window.removeEventListener('keydown',key)
  })
  const save = async (next: Chart, audio: boolean) => {
    let savedId: string | undefined = id
    try {
      if (form === 'new') savedId = await api.createChart(next) ?? undefined
      else if (!id || !await api.saveLibraryChart(id,next)) return false
      if (!savedId) return false
      reset(); setSelection(savedId); setLoaded({id:savedId,chart:next}); setMobileDetail(true)
      if (audio && await api.selectChart(savedId)) await api.chooseAudio()
      showToast(text('谱面信息已保存','Chart information saved')); return true
    } catch (e) { showToast(String(e)); return false }
  }
  const visibleCount = Math.max(limit,index+1)
  return <div className="chart-management-page" style={{ "--scene-color": sceneColor, "--beat": `${60 / (chart?.bpm || 120)}s`, "--selection-accent": ['var(--success)','var(--brand)','var(--warning)','var(--danger)'][tier] } as React.CSSProperties} data-detail={mobileDetail && !!item}>
    <LibraryAtmosphere selection={`${id ?? ''}-${tier}`} />
    <header className="library-toolbar"><h1><i aria-hidden />{appConfig.navigation[0].items[0].label[language]}<small>{api.charts.length}</small></h1>
      <GameSearch ref={search} value={query} placeholder={text('搜索标题、曲师、标签','Search titles, artists, tags')} onChange={e => { setQuery(e.target.value); setLimit(60); setMobileDetail(false); closePreview() }} />
      <GameTabs label={text('状态筛选','Status filter')} value={filter} options={Object.entries(statuses).map(([value,label]) => ({value,label,count:value === 'all' ? api.charts.length : api.charts.filter(i => i.library.status === value).length}))} onChange={v => {setFilter(v); setLimit(60); setMobileDetail(false);closePreview()}} />
      <GameSelect label={text('排序','Sort')} value={sort} onValueChange={setSort} options={[
        ['date',text('最近编辑','Last edited')], ['title',text('标题','Title')],
        ['notes',text('物量','Note count')], ['level',text('最高等级','Highest level')],
      ]} />
      <div className="library-tools"><GameButton size="icon" aria-label={text('音效开关','Toggle sound')} aria-pressed={sound.enabled} onClick={() => {
          sound.toggle()
          showToast(sound.enabled ? text('声音已关闭','Sound off') : text('声音已开启','Sound on'))
        }}>{sound.enabled ? <Volume2/> : <VolumeX/>}</GameButton>
        <GameButton disabled={!api.libraryReady} onClick={() => void run(async () => { const n = await api.importChart(); if(n){reset(); select(n)} })}><FileUp/>{text('导入谱面','Import')}</GameButton>
        <GameButton className="primary" disabled={!api.libraryReady} onClick={() => setForm('new')}><Plus/>{text('新建谱面','New chart')}</GameButton>
        <PlayerMenu onSettings={() => { closePreview(); onSettings() }} onStorage={() => void run(api.revealLibrary)} /></div>
    </header>
    <div className="library-stage">
      <div className="chart-library-list" data-scroll-region ref={list} role="listbox" aria-label={text('谱面列表','Chart list')} onScroll={e => {const el=e.currentTarget; if(el.scrollTop+el.clientHeight>el.scrollHeight-240 && limit<items.length)setLimit(limit+60)}}>
        {items.slice(0,visibleCount).map((c,i) => <ChartCard key={c.id} item={c} index={i} tier={i === index ? tier : c.library.levels.map(Boolean).lastIndexOf(true)} distance={Math.abs(i-index)} query={query.trim()} status={statuses[c.library.status]} onSelect={() => select(c.id)} onOpen={() => open('editor',c.id)} />)}
      </div>
      {!item && <div className="library-empty"><Library/><h2>{!api.libraryReady ? text('正在读取谱面库…','Loading library…') : api.charts.length ? text('没有匹配的谱面','No matching charts') : text('还没有谱面','No charts yet')}</h2>{api.libraryReady && <GameButton onClick={() => api.charts.length ? reset() : setForm('new')}>{api.charts.length ? text('清除筛选','Clear filters') : text('新建谱面','New chart')}</GameButton>}</div>}
      {item && <section className="library-detail"><GameButton className="library-back" onClick={() => { closePreview(); setMobileDetail(false) }}><ArrowLeft/>{text('谱面列表','Charts')}</GameButton>
        <div className="detail-scroll" data-scroll-region><div className="record-heading" key={id}>
          <button type="button" className="jacket-stage" disabled={!chart} aria-label={previewLabel} aria-pressed={previewing} onClick={() => previewing ? closePreview() : startPreview(0)} onPointerMove={event => {
            if (event.pointerType === 'touch') return
            const stage = event.currentTarget
            const rect = stage.getBoundingClientRect()
            const x = (event.clientX - rect.left) / rect.width
            const y = (event.clientY - rect.top) / rect.height
            stage.style.setProperty('--ry', (x - .5) * 18 + 'deg')
            stage.style.setProperty('--rx', (.5 - y) * 18 + 'deg')
            stage.style.setProperty('--gx', x * 100 + '%')
            stage.style.setProperty('--gy', y * 100 + '%')
          }} onPointerLeave={event => {
            for (const property of ['--rx','--ry','--gx','--gy']) event.currentTarget.style.removeProperty(property)
          }}><ChartCover item={item}>
            {previewing && chart && <LibraryPreview id={item.id} chart={chart} fraction={preview.fraction} playhead={playhead} elapsed={previewTime} onClose={closePreview} muted={!sound.enabled}/>}
            <span className="jacket-glare" aria-hidden />
          </ChartCover>
            <span className="preview-badge" aria-hidden><span className="preview-eq"><i/><i/><i/></span>
              <span>{previewing ? text('试听中', 'Playing') : previewLabel}{previewing && <> <span ref={previewTime}/></>}</span>
            </span></button>
          <div className="record-info"><em className={'record-status '+item.library.status}>{statuses[item.library.status]}</em><h2>{item.title}</h2><p>{item.artist || text('未知艺术家','Unknown artist')}{item.library.charter && ' · '+item.library.charter}</p><div>{item.library.tags.map((tag,i) => <button key={i} onClick={() => {setQuery(tag);setMobileDetail(false);closePreview()}}>{tag}</button>)}</div></div></div>
          <div className="tier-strip">{tiers.map((name,i) => <button key={name} disabled={!item.library.levels[i]} aria-pressed={i === tier} onClick={() => chooseTier(i)}><small>{name}</small><b>{item.library.levels[i] || '—'}</b></button>)}</div>
          <ChartStats chart={chart} /><DensityGraph chart={chart} tier={tier} onPreview={startPreview} playhead={previewing ? playhead : undefined} />
          <p>{item.library.description}</p><small className="record-date">◇　{new Date(item.updatedAt).toLocaleString(locale)}　{ text('最近编辑','Last edited') }</small>
        </div><div className="record-actions"><GameButton className="primary open-editor" disabled={!chart} onClick={() => open('editor')}>{text('进入制谱器','Open editor')}<kbd>Enter</kbd></GameButton>
          <GameButton disabled={!chart} onClick={() => open('playtest')}>{text('试玩','Play')}</GameButton><GameButton disabled={!activeChart} onClick={() => setForm('edit')}>{text('编辑信息','Edit info')}</GameButton>
          <GameButton onClick={() => void run(async () => { const n=await api.duplicateChart(item.id); if(n){reset();select(n);showToast(text('已复制为草稿','Copied to drafts'))} })}>{text('复制','Copy')}</GameButton>
          <GameButton onClick={() => void run(async () => {await api.exportChart(item.id)})}>{text('导出','Export')}</GameButton><GameButton className="danger" onClick={() => setPendingDelete({ id: item.id, title: item.title })}>{text('删除','Delete')}</GameButton></div>
      </section>}
    </div><footer className="library-keys">{[['↑ ↓',text('切歌','Select')],['← →',text('难度','Difficulty')],['T',text('试玩','Play')],['E',text('编辑','Edit')],['Del',text('删除','Delete')]].map(([k,label]) => <span key={k}><kbd>{k}</kbd>{label}</span>)}</footer><ClickParticles/>
    {form && (form === 'new' || activeChart) && <LibraryForm chart={form === 'new' ? normalizeChart(DEFAULT_CHART) : activeChart!} creating={form === 'new'} onClose={() => setForm(null)} onSave={save}/>}
    <AlertDialog open={deleting} onOpenChange={open => { if (!open) setPendingDelete(null) }}><AlertDialogContent><AlertDialogTitle>{text('删除谱面','Delete chart')}</AlertDialogTitle><AlertDialogDescription>{text('永久删除谱面及其保存的媒体？','Permanently delete this chart and its saved media?')}「{pendingDelete?.title}」</AlertDialogDescription><AlertDialogFooter><AlertDialogCancel>{text('取消','Cancel')}</AlertDialogCancel><HoldConfirm onConfirm={() => {setPendingDelete(null);if(pendingDelete)void run(async () => {await api.deleteChart(pendingDelete.id)})}}>{text('长按确认删除','Hold to delete')}</HoldConfirm></AlertDialogFooter></AlertDialogContent></AlertDialog>
  </div>
}
