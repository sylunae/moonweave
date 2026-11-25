import { useEffect, useLayoutEffect, useRef, type ComponentProps, type ReactNode } from 'react'
import { Search } from 'lucide-react'
import { Button } from './button'
import { Input } from './input'
import { ToggleGroup, ToggleGroupItem } from './toggle-group'

export function GameButton({ className = '', ...props }: ComponentProps<typeof Button>) {
  return <Button variant="outline" className={`game-button ${className}`} {...props} />
}

export function GameSearch({ placeholder, ...props }: ComponentProps<typeof Input>) {
  return <label className="game-search"><Search aria-hidden /><Input type="search" aria-label={placeholder} placeholder={placeholder} {...props} /><kbd>/</kbd></label>
}

export function GameTabs({ value, onChange, options, label }: { value: string; onChange(value: string): void; options: { value: string; label: string; count: number }[]; label: string }) {
  const group = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const root = group.current
    const active = root?.querySelector<HTMLElement>('[data-state=on]')
    if (!root || !active) return
    const position = () => {
      root.style.setProperty('--ink-left', active.offsetLeft + 'px')
      root.style.setProperty('--ink-width', active.offsetWidth + 'px')
    }
    position()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(position)
    observer.observe(root)
    observer.observe(active)
    return () => observer.disconnect()
  }, [value, options])
  return <ToggleGroup ref={group} type="single" value={value} onValueChange={next => next && onChange(next)} className="game-tabs" aria-label={label}>
    {options.map(option => <ToggleGroupItem value={option.value} key={option.value}>{option.label}<small>{option.count}</small></ToggleGroupItem>)}
  </ToggleGroup>
}

export function GameToast({ children }: { children: ReactNode }) {
  return <div className="chart-toast" role="status">{children}</div>
}

export function ClickParticles() {
  const layer = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const burst = (event: PointerEvent) => {
      const host = layer.current
      if (!host || document.documentElement.dataset.reduceMotion === 'true' || matchMedia('(prefers-reduced-motion: reduce)').matches) return
      if (event.button !== 0 || !(event.target instanceof Element) || !host.parentElement?.contains(event.target) || event.target.closest('input,select')) return
      const group = document.createElement('span')
      group.style.left = event.clientX + 'px'
      group.style.top = event.clientY + 'px'
      host.append(group)
      if (host.childElementCount > 6) host.firstElementChild?.remove()
      for (let i = 0; i < 7; i++) {
        const spark = document.createElement('i')
        const a = i * Math.PI * 2 / 7 + Math.random() * .5
        spark.style.setProperty('--dx', Math.cos(a) * (15 + Math.random() * 26) + 'px')
        spark.style.setProperty('--dy', Math.sin(a) * (15 + Math.random() * 26) + 'px')
        group.append(spark)
      }
      group.onanimationend = () => group.remove()
    }
    document.addEventListener('pointerdown', burst)
    return () => document.removeEventListener('pointerdown', burst)
  }, [])
  return <div ref={layer} className="click-particles" aria-hidden />
}
