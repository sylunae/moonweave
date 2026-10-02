import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { BrandMark } from '@/components/BrandMark'
import { Button } from '@/components/ui/button'
import { useI18n } from './i18n'

export type UiSound = 'hover' | 'press' | 'confirm' | 'back' | 'toggle' | 'tick' | 'danger'

// Swap any file in public/assets/sfx without touching the interaction code.
export const UI_SOUND_ASSETS: Record<UiSound, string> = {
  hover: 'assets/sfx/hover.wav',
  press: 'assets/sfx/press.wav',
  confirm: 'assets/sfx/confirm.wav',
  back: 'assets/sfx/back.wav',
  toggle: 'assets/sfx/toggle.wav',
  tick: 'assets/sfx/tick.wav',
  danger: 'assets/sfx/danger.wav',
}

const POOL_SIZE = 4
const INTERACTIVE_SELECTOR = 'button, a, [role="button"], [role="tab"], [role="menuitem"], [role="option"], [data-sound], [data-slot="slider-thumb"], input, select, textarea'
const pools = new Map<UiSound, HTMLAudioElement[]>()
const poolIndices = new Map<UiSound, number>()
let preloadPromise: Promise<void> | null = null

const assetUrl = (path: string) => new URL(path, document.baseURI).href

function prepareSound(type: UiSound) {
  const source = assetUrl(UI_SOUND_ASSETS[type])
  const pool = Array.from({ length: POOL_SIZE }, () => {
    const audio = new Audio(source)
    audio.preload = 'auto'
    audio.volume = type === 'hover' || type === 'tick' ? .16 : .24
    return audio
  })
  pools.set(type, pool)
  return new Promise<void>((resolve, reject) => {
    const audio = pool[0]
    const loaded = () => { cleanup(); resolve() }
    const failed = () => { cleanup(); reject(new Error(`Unable to preload ${source}`)) }
    const cleanup = () => {
      audio.removeEventListener('canplaythrough', loaded)
      audio.removeEventListener('error', failed)
    }
    if (audio.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA) resolve()
    else {
      audio.addEventListener('canplaythrough', loaded, { once: true })
      audio.addEventListener('error', failed, { once: true })
      pool.forEach((item) => item.load())
    }
  })
}

function preloadSounds(onProgress: (loaded: number, total: number) => void) {
  if (preloadPromise) return preloadPromise
  const sounds = Object.keys(UI_SOUND_ASSETS) as UiSound[]
  let loaded = 0
  preloadPromise = Promise.all(sounds.map((sound) => prepareSound(sound).then(() => {
    loaded += 1
    onProgress(loaded, sounds.length)
  }))).then(() => undefined).catch((error) => {
    preloadPromise = null
    throw error
  })
  return preloadPromise
}

function playSound(type: UiSound) {
  const pool = pools.get(type)
  if (!pool?.length) return
  const index = poolIndices.get(type) ?? 0
  const audio = pool[index % pool.length]
  poolIndices.set(type, index + 1)
  audio.currentTime = 0
  void audio.play().catch(() => undefined)
}

interface SoundContextValue {
  play: (sound: UiSound) => void
}

const SoundContext = createContext<SoundContextValue>({ play: playSound })

function soundForElement(element: HTMLElement): UiSound | null {
  const requested = element.dataset.sound
  if (requested === 'none') return null
  if (requested && requested in UI_SOUND_ASSETS) return requested as UiSound
  if (element.matches('[data-variant="destructive"], [aria-label*="删除"], [aria-label*="Delete"]')) return 'danger'
  if (element.matches('input[type="checkbox"], input[type="radio"], select, [role="switch"], [role="option"]')) return 'toggle'
  return 'press'
}

function GlobalSoundEvents() {
  const hovered = useRef<HTMLElement | null>(null)
  const lastInputTick = useRef(0)

  useEffect(() => {
    const interactiveFrom = (target: EventTarget | null) => target instanceof Element
      ? target.closest<HTMLElement>(INTERACTIVE_SELECTOR)
      : null
    const onPointerOver = (event: PointerEvent) => {
      const element = interactiveFrom(event.target)
      if (!element || element === hovered.current || element.matches(':disabled, [aria-disabled="true"]')) return
      hovered.current = element
      playSound('hover')
    }
    const onPointerOut = (event: PointerEvent) => {
      const element = interactiveFrom(event.target)
      if (element && (!event.relatedTarget || !element.contains(event.relatedTarget as Node))) hovered.current = null
    }
    const onPointerDown = (event: PointerEvent) => {
      const element = interactiveFrom(event.target)
      if (!element || element.matches(':disabled, [aria-disabled="true"]')) return
      const sound = soundForElement(element)
      if (sound) playSound(sound)
    }
    const onKeyboardClick = (event: MouseEvent) => {
      if (event.detail !== 0) return
      const element = interactiveFrom(event.target)
      if (!element || element.matches(':disabled, [aria-disabled="true"]')) return
      const sound = soundForElement(element)
      if (sound) playSound(sound)
    }
    const onInput = (event: Event) => {
      const element = interactiveFrom(event.target)
      if (!element?.matches('input[type="range"], [data-slot="slider"]')) return
      const now = performance.now()
      if (now - lastInputTick.current > 55) { lastInputTick.current = now; playSound('tick') }
    }
    document.addEventListener('pointerover', onPointerOver, true)
    document.addEventListener('pointerout', onPointerOut, true)
    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('click', onKeyboardClick, true)
    document.addEventListener('input', onInput, true)
    return () => {
      document.removeEventListener('pointerover', onPointerOver, true)
      document.removeEventListener('pointerout', onPointerOut, true)
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('click', onKeyboardClick, true)
      document.removeEventListener('input', onInput, true)
    }
  }, [])
  return null
}

function SoundLoadingScreen({ onReady }: { onReady: () => void }) {
  const { text } = useI18n()
  const [progress, setProgress] = useState(0)
  const [failed, setFailed] = useState(false)
  const total = Object.keys(UI_SOUND_ASSETS).length

  const load = useCallback(() => {
    setFailed(false)
    setProgress(0)
    void preloadSounds((loaded) => setProgress(loaded)).then(onReady).catch(() => setFailed(true))
  }, [onReady])

  useEffect(load, [load])

  return <main className="resource-loader" role="status" aria-live="polite">
    <div className="resource-loader-brand"><BrandMark /><span>MOONWEAVE</span></div>
    <div className="resource-loader-ring" style={{ '--load-progress': `${Math.round(progress / total * 360)}deg` } as React.CSSProperties}>
      <strong>{Math.round(progress / total * 100)}</strong><span>%</span>
    </div>
    <div className="resource-loader-copy">
      <span className="eyebrow">SYSTEM PRELOAD</span>
      <strong>{failed ? text('资源加载失败', 'Resource loading failed') : text('正在同步交互音频', 'Syncing interaction audio')}</strong>
      <small>{failed ? text('请检查资源后重试', 'Check the resources and try again') : `${progress} / ${total}`}</small>
    </div>
    {failed && <Button onClick={load}>{text('重新加载', 'Reload')}</Button>}
  </main>
}

export function SoundGate({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false)
  const value = useMemo(() => ({ play: playSound }), [])
  if (!ready) return <SoundLoadingScreen onReady={() => setReady(true)} />
  return <SoundContext.Provider value={value}><GlobalSoundEvents />{children}</SoundContext.Provider>
}

export function useSound() {
  return useContext(SoundContext)
}
