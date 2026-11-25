import { memo, useEffect, useRef, type CSSProperties } from 'react'

// Fixed particle paths keep the scene stable while searching and switching songs.
const motes = Array.from({ length: 26 }, (_, i) => ({
  left: (i * 37 % 101) + '%',
  '--drift': (8 + i % 7) + 's',
  '--delay': -(i * 2.73) + 's',
  '--size': (2 + i % 3) + 'px',
} as CSSProperties))

export const LibraryAtmosphere = memo(function LibraryAtmosphere({ selection }: { selection: string }) {
  const stage = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const layer = stage.current
    const page = layer?.parentElement
    if (!layer || !page) return
    let frame = 0
    let x = 0
    let y = 0
    const paint = () => {
      frame = 0
      layer.style.setProperty('--pan-x', x + 'px')
      layer.style.setProperty('--pan-y', y + 'px')
    }
    const schedule = () => { if (!frame) frame = requestAnimationFrame(paint) }
    const move = (event: PointerEvent) => {
      if (event.pointerType === 'touch' || document.documentElement.dataset.reduceMotion === 'true' || matchMedia('(prefers-reduced-motion: reduce)').matches) return
      const bounds = page.getBoundingClientRect()
      x = ((event.clientX - bounds.left) / bounds.width - .5) * 30
      y = ((event.clientY - bounds.top) / bounds.height - .5) * 20
      schedule()
    }
    const reset = () => { x = y = 0; schedule() }
    page.addEventListener('pointermove', move)
    page.addEventListener('pointerleave', reset)
    return () => {
      cancelAnimationFrame(frame)
      page.removeEventListener('pointermove', move)
      page.removeEventListener('pointerleave', reset)
    }
  }, [])
  return <div ref={stage} className="library-atmosphere" aria-hidden="true">
    <div className="stage-aura" />
    <div key={selection} className="stage-selection-flash" />
    <div className="stage-horizon"><div className="stage-rails" /></div>
    <div className="stage-dust">{motes.map((style, i) => <i key={i} style={style} />)}</div>
  </div>
})
