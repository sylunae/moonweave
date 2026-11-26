import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react'

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
const pools = new Map<UiSound, { audio: HTMLAudioElement[]; next: number }>()

let soundEnabled = true
function playSound(type: UiSound) {
  if (!soundEnabled) return
  let pool = pools.get(type)
  if (!pool) {
    pool = { audio: [], next: 0 }
    pools.set(type, pool)
  }

  const index = pool.next
  let audio = pool.audio[index]
  if (!audio) {
    audio = new Audio(new URL(UI_SOUND_ASSETS[type], document.baseURI).href)
    audio.volume = type === 'hover' || type === 'tick' ? .16 : .24
    pool.audio[index] = audio
  }
  pool.next = (index + 1) % POOL_SIZE
  audio.currentTime = 0
  void audio.play().catch(() => undefined)
}

interface SoundContextValue {
  enabled: boolean
  toggle(): void
  play: (sound: UiSound) => void
}

const SoundContext = createContext<SoundContextValue>({ play: playSound, enabled: true, toggle: () => {} })

function soundForElement(element: HTMLElement): UiSound | null {
  const requested = element.dataset.sound
  if (requested === 'none') return null
  if (requested && Object.hasOwn(UI_SOUND_ASSETS, requested)) return requested as UiSound
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
      if (!element || element === hovered.current || element.dataset.sound === 'none' || element.matches(':disabled, [aria-disabled="true"]')) return
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

export function SoundProvider({ children }: { children: React.ReactNode }) {
  const [enabled, setEnabled] = useState(soundEnabled)
  const value = useMemo(() => ({ play: playSound, enabled, toggle: () => { soundEnabled = !soundEnabled; setEnabled(soundEnabled) } }), [enabled])
  return <SoundContext.Provider value={value}><GlobalSoundEvents />{children}</SoundContext.Provider>
}

export function useSound() {
  return useContext(SoundContext)
}
