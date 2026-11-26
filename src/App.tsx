import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { NAVIGATE_EVENT } from '@/app/navigation'
import { isRouteId, type RouteId } from '@/config/app'
import { EarlyAccessDialog } from '@/components/EarlyAccessDialog'
import { PageLoader } from '@/components/PageLoader'
import { TooltipProvider } from '@/components/ui/tooltip'
import { ChartProvider } from '@/features/chart/ChartProvider'
import { PlatformProvider } from '@/features/platform/PlatformProvider'

const pages = {
  manage: lazy(() => import('@/pages/ChartManagementPage')),
  editor: lazy(() => import('@/pages/ChartEditorPage')),
  playtest: lazy(() => import('@/pages/PlaytestPage')),
} satisfies Record<RouteId, React.LazyExoticComponent<React.ComponentType<{ onSettings(): void; settingsOpen: boolean }>>>
const SettingsDialog = lazy(() => import('@/components/SettingsDialog').then((module) => ({ default: module.SettingsDialog })))

function initialRoute(): RouteId {
  const value = new URLSearchParams(window.location.search).get('page')
  return value && isRouteId(value) ? value : 'manage'
}

function DismissBootSplash() {
  useLayoutEffect(() => {
    const splash = document.getElementById('boot-splash')
    if (!splash || splash.hasAttribute('data-leaving')) return
    if (!splash.animate || document.documentElement.dataset.reduceMotion === 'true' || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      splash.remove()
      return
    }

    splash.setAttribute('data-leaving', '')
    splash.setAttribute('aria-hidden', 'true')
    for (const animation of splash.getAnimations?.({ subtree: true }) ?? []) animation.updatePlaybackRate(7)
    const fade = splash.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 160, easing: 'ease-out', fill: 'forwards' })
    void fade.finished.then(() => splash.remove(), () => splash.remove())
  }, [])
  return null
}

export default function App({ showEarlyAccessNotice }: { showEarlyAccessNotice: boolean }) {
  const [route, setRoute] = useState<RouteId>(initialRoute)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settingsMounted, setSettingsMounted] = useState(false)
  const settingsTrigger = useRef<HTMLElement | null>(null)
  const [pageScrolled, setPageScrolled] = useState(false)
  const Page = useMemo(() => pages[route], [route])
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

  const openSettings = useCallback(() => {
    settingsTrigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    setSettingsMounted(true)
    setSettingsOpen(true)
  }, [])

  const restoreSettingsFocus = useCallback((event: Event) => {
    if (!settingsTrigger.current?.isConnected) return
    event.preventDefault()
    settingsTrigger.current.focus()
  }, [])

  return <TooltipProvider><ChartProvider><PlatformProvider>
    <div className={`app-shell${hasAppTitlebar ? ' has-app-titlebar' : ''}`}>
      {hasAppTitlebar && route !== 'playtest' && <header className={`app-titlebar${pageScrolled ? ' scrolled' : ''}`}><div className="app-titlebar-drag" /><span>MOONWEAVE · CHART STUDIO</span></header>}
      <main className={`content-shell route-${route}`} onScroll={(event) => setPageScrolled(event.currentTarget.scrollTop > 0)}>
        <Suspense fallback={<PageLoader />}>
          <Page onSettings={openSettings} settingsOpen={settingsOpen} />
          <DismissBootSplash />
        </Suspense>
      </main>
      {showEarlyAccessNotice && <EarlyAccessDialog />}
      <Suspense fallback={null}>{settingsMounted && <SettingsDialog
        key={route === 'playtest' ? 'play' : 'general'}
        initialSection={route === 'playtest' ? 'play' : 'appearance'}
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        onCloseAutoFocus={restoreSettingsFocus}
      />}</Suspense>
    </div>
  </PlatformProvider></ChartProvider></TooltipProvider>
}
