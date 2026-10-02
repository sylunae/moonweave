import { lazy, Suspense, useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react'
import { usePreferences, SIDEBAR_COLLAPSED } from '@/app/preferences'
import { NAVIGATE_EVENT } from '@/app/navigation'
import { isRouteId, type RouteId } from '@/config/app'
import { PageLoader } from '@/components/PageLoader'
import { Sidebar } from '@/components/Sidebar'
import { TooltipProvider } from '@/components/ui/tooltip'
import { ChartProvider } from '@/features/chart/ChartProvider'
import { PlatformProvider } from '@/features/platform/PlatformProvider'

const pages = {
  manage: lazy(() => import('@/pages/ChartManagementPage')),
  editor: lazy(() => import('@/pages/ChartEditorPage')),
  playtest: lazy(() => import('@/pages/PlaytestPage')),
} satisfies Record<RouteId, React.LazyExoticComponent<React.ComponentType>>
const SettingsDialog = lazy(() => import('@/components/SettingsDialog').then((module) => ({ default: module.SettingsDialog })))

function initialRoute(): RouteId {
  const value = new URLSearchParams(window.location.search).get('page')
  return value && isRouteId(value) ? value : 'manage'
}

export default function App() {
  const { preferences, setPreferences } = usePreferences()
  const [route, setRoute] = useState<RouteId>(initialRoute)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settingsMounted, setSettingsMounted] = useState(false)
  const [pageScrolled, setPageScrolled] = useState(false)
  const Page = useMemo(() => pages[route], [route])
  const renderedWidth = preferences.sidebarCollapsed ? SIDEBAR_COLLAPSED : preferences.sidebarWidth
  const hasAppTitlebar = Boolean(window.sylunae)

  useEffect(() => {
    const url = new URL(window.location.href)
    if (route === 'manage') url.searchParams.delete('page')
    else url.searchParams.set('page', route)
    window.history.replaceState(null, '', url)
    setPageScrolled(false)
  }, [route])

  useEffect(() => {
    const navigate = (event: Event) => setRoute((event as CustomEvent<RouteId>).detail)
    window.addEventListener(NAVIGATE_EVENT, navigate)
    return () => window.removeEventListener(NAVIGATE_EVENT, navigate)
  }, [])

  const resizeSidebar = useCallback((width: number, collapsed: boolean) => {
    setPreferences((current) => ({ ...current, sidebarWidth: width, sidebarCollapsed: collapsed }))
  }, [setPreferences])
  const openSettings = useCallback(() => { setSettingsMounted(true); setSettingsOpen(true) }, [])

  return <TooltipProvider><ChartProvider><PlatformProvider>
    <div className={`app-shell${hasAppTitlebar ? ' has-app-titlebar' : ''}`} style={{ '--sidebar-width': `${renderedWidth}px` } as CSSProperties}>
      <Sidebar active={route} collapsed={preferences.sidebarCollapsed} width={renderedWidth} expandedWidth={preferences.sidebarWidth} mobileOpen={mobileOpen} settingsOpen={settingsOpen} onSelect={setRoute} onResize={resizeSidebar} onOpenSettings={openSettings} onOpenMobile={() => setMobileOpen(true)} onCloseMobile={() => setMobileOpen(false)} />
      {hasAppTitlebar && <header className={`app-titlebar${pageScrolled ? ' scrolled' : ''}`}><div className="app-titlebar-drag" /><span>MOONWEAVE · CHART STUDIO</span></header>}
      <main className={`content-shell route-${route}`} onScroll={(event) => setPageScrolled(event.currentTarget.scrollTop > 0)}>
        <Suspense fallback={<PageLoader />}><Page /></Suspense>
      </main>
      <Suspense fallback={null}>{settingsMounted && <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />}</Suspense>
    </div>
  </PlatformProvider></ChartProvider></TooltipProvider>
}
