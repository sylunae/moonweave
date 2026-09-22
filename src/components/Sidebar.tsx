import { memo, useCallback, useEffect, useRef, useState, type PointerEvent } from 'react'
import { Menu, Settings } from 'lucide-react'
import { SIDEBAR_COLLAPSED, SIDEBAR_COLLAPSE_THRESHOLD, SIDEBAR_MAX, SIDEBAR_MIN } from '@/app/preferences'
import { appConfig, type RouteId } from '@/config/app'
import { BrandMark } from './BrandMark'

interface SidebarProps {
  active: RouteId
  collapsed: boolean
  width: number
  expandedWidth: number
  mobileOpen: boolean
  settingsOpen: boolean
  onSelect: (route: RouteId) => void
  onResize: (width: number, collapsed: boolean) => void
  onOpenSettings: () => void
  onOpenMobile: () => void
  onCloseMobile: () => void
}

export const Sidebar = memo(function Sidebar({
  active, collapsed, width, expandedWidth, mobileOpen, settingsOpen, onSelect, onResize, onOpenSettings, onOpenMobile, onCloseMobile,
}: SidebarProps) {
  const drag = useRef<{ x: number; lastX: number; width: number; shell: HTMLElement; handle: HTMLDivElement; pointerId: number; frame: number | null } | null>(null)
  const [mobileViewport, setMobileViewport] = useState(() => window.matchMedia('(max-width: 760px)').matches)
  const compact = collapsed && !mobileViewport

  const select = (route: RouteId) => { onSelect(route); onCloseMobile() }
  const previewWidth = (rawWidth: number) => {
    const next = rawWidth <= SIDEBAR_COLLAPSE_THRESHOLD ? SIDEBAR_COLLAPSED : Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, rawWidth))
    drag.current?.shell.style.setProperty('--sidebar-width', `${next}px`)
    document.body.classList.toggle('sidebar-preview-collapsed', next === SIDEBAR_COLLAPSED)
    document.body.classList.toggle('sidebar-preview-expanded', next !== SIDEBAR_COLLAPSED)
  }
  const stopResizeAt = useCallback((clientX?: number) => {
    const current = drag.current
    if (!current) return
    if (current.frame !== null) cancelAnimationFrame(current.frame)
    const rawWidth = current.width + (clientX ?? current.lastX) - current.x
    const nextCollapsed = rawWidth <= SIDEBAR_COLLAPSE_THRESHOLD
    const nextWidth = nextCollapsed ? expandedWidth : Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, rawWidth))
    drag.current = null
    if (current.handle.hasPointerCapture(current.pointerId)) current.handle.releasePointerCapture(current.pointerId)
    document.body.classList.remove('sidebar-resizing', 'sidebar-preview-collapsed', 'sidebar-preview-expanded')
    onResize(nextWidth, nextCollapsed)
  }, [expandedWidth, onResize])
  const startResize = (event: PointerEvent<HTMLDivElement>) => {
    if (window.matchMedia('(max-width: 760px)').matches) return
    const shell = event.currentTarget.closest<HTMLElement>('.app-shell')
    if (!shell) return
    stopResizeAt()
    drag.current = { x: event.clientX, lastX: event.clientX, width, shell, handle: event.currentTarget, pointerId: event.pointerId, frame: null }
    event.currentTarget.setPointerCapture(event.pointerId)
    document.body.classList.add('sidebar-resizing')
  }
  const resize = (event: PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return
    drag.current.lastX = event.clientX
    const next = drag.current.width + event.clientX - drag.current.x
    if (drag.current.frame !== null) cancelAnimationFrame(drag.current.frame)
    drag.current.frame = requestAnimationFrame(() => previewWidth(next))
  }
  const stopResize = (event: PointerEvent<HTMLDivElement>) => {
    stopResizeAt(event.clientX)
  }

  useEffect(() => {
    const media = window.matchMedia('(max-width: 760px)')
    const updateViewport = () => setMobileViewport(media.matches)
    const stopFromPointer = (event: globalThis.PointerEvent) => {
      if (drag.current?.pointerId === event.pointerId) stopResizeAt(event.clientX)
    }
    const stopFromInterruption = () => stopResizeAt()
    const stopWhenHidden = () => { if (document.hidden) stopResizeAt() }
    media.addEventListener('change', updateViewport)
    window.addEventListener('pointerup', stopFromPointer, true)
    window.addEventListener('pointercancel', stopFromPointer, true)
    window.addEventListener('blur', stopFromInterruption)
    document.addEventListener('visibilitychange', stopWhenHidden)
    return () => {
      media.removeEventListener('change', updateViewport)
      window.removeEventListener('pointerup', stopFromPointer, true)
      window.removeEventListener('pointercancel', stopFromPointer, true)
      window.removeEventListener('blur', stopFromInterruption)
      document.removeEventListener('visibilitychange', stopWhenHidden)
      if (drag.current?.frame !== null && drag.current?.frame !== undefined) cancelAnimationFrame(drag.current.frame)
      document.body.classList.remove('sidebar-resizing', 'sidebar-preview-collapsed', 'sidebar-preview-expanded')
    }
  }, [stopResizeAt])

  return <>
    <button className="mobile-menu" onClick={onOpenMobile} aria-label="打开导航"><Menu size={20} /></button>
    {mobileOpen && <button className="sidebar-backdrop" onClick={onCloseMobile} aria-label="关闭导航" />}
    <aside className={`sidebar${collapsed ? ' collapsed' : ''}${mobileOpen ? ' mobile-open' : ''}`} inert={mobileViewport && !mobileOpen ? true : undefined}>
      <button className="brand" onClick={() => select('editor')} aria-label="打开制谱编辑器">
        <BrandMark />
        <span className="brand-copy"><strong>{appConfig.name}</strong><small>{appConfig.eyebrow}</small></span>
      </button>

      <nav aria-label="主导航">
        <div className="nav-caption">工作区</div>
        {appConfig.navigation.map(({ id, label, icon: Icon }) => <button
          key={id}
          className={active === id || (id === 'editor' && active === 'playtest') ? 'active' : ''}
          onClick={() => select(id)}
          title={label}
          aria-current={active === id || (id === 'editor' && active === 'playtest') ? 'page' : undefined}
        ><Icon size={19} strokeWidth={1.7} /><span>{label}</span></button>)}
      </nav>

      <div className="sidebar-footer">
        <button className={settingsOpen ? 'active' : ''} onClick={() => { onOpenSettings(); onCloseMobile() }} title="设置" aria-haspopup="dialog" aria-expanded={settingsOpen}>
          <Settings size={19} strokeWidth={1.7} /><span>{compact ? '' : '设置'}</span>
        </button>
      </div>

      <div className="sidebar-resize-handle" role="separator" aria-orientation="vertical" aria-label="调整导航栏宽度" aria-valuemin={SIDEBAR_COLLAPSED} aria-valuemax={SIDEBAR_MAX} aria-valuenow={collapsed ? SIDEBAR_COLLAPSED : width} onPointerDown={startResize} onPointerMove={resize} onPointerUp={stopResize} onPointerCancel={stopResize} onLostPointerCapture={() => stopResizeAt()} />
    </aside>
  </>
})
