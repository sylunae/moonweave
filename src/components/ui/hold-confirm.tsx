import { useEffect, useRef, useState, type ReactNode } from 'react'
import { GameButton } from './game-controls'

export function HoldConfirm({ children, onConfirm }: { children: ReactNode; onConfirm(): void }) {
  const timer = useRef(0)
  const [holding, setHolding] = useState(false)
  const cancel = () => { clearTimeout(timer.current); timer.current = 0; setHolding(false) }
  const start = () => {
    if (timer.current) return
    setHolding(true)
    timer.current = window.setTimeout(() => { cancel(); onConfirm() }, 900)
  }
  useEffect(() => {
    window.addEventListener('blur', cancel)
    return () => { clearTimeout(timer.current); window.removeEventListener('blur', cancel) }
  }, [])
  return <GameButton className="hold-confirm" data-holding={holding} onPointerDown={e => { if (e.button === 0) start() }} onPointerUp={cancel} onPointerLeave={cancel} onPointerCancel={cancel} onBlur={cancel} onKeyDown={e => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); if (!e.repeat) start() } }} onKeyUp={cancel}>{children}</GameButton>
}
