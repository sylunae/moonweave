import { useLayoutEffect, useRef, useState } from 'react'
import { flushSync } from 'react-dom'

const historyKey = 'moonweaveMobileBack'
const layers: { dismiss(): void; modal: boolean }[] = []
let activeEntry = false
let traversalPending = false
let listening = false
let scheduled = false

export function isTouchWeb() {
  return !window.sylunae && (window.matchMedia?.('(pointer: coarse)').matches ?? false)
}

export function focusMobileDialog(event: Event) {
  if (!isTouchWeb() || !(event.target instanceof HTMLElement)) return
  event.preventDefault()
  event.target.focus({ preventScroll: true })
}

function reconcile() {
  if (traversalPending) return
  if (layers.length && !activeEntry) {
    window.history.pushState({ ...window.history.state, [historyKey]: true }, '')
    activeEntry = true
  } else if (!layers.length && activeEntry) {
    traversalPending = true
    window.history.back()
  } else if (!layers.length && listening) {
    window.removeEventListener('popstate', onPopState)
    listening = false
  }
}

function scheduleReconcile() {
  if (scheduled) return
  scheduled = true
  queueMicrotask(() => {
    scheduled = false
    reconcile()
  })
}

function onPopState(event: PopStateEvent) {
  const wasActive = activeEntry
  const wasProgrammatic = traversalPending
  activeEntry = event.state?.[historyKey] === true
  traversalPending = false
  if (wasActive && !activeEntry) {
    if (!wasProgrammatic) flushSync(() => {
      const focused = document.activeElement
      if (
        (focused instanceof HTMLInputElement && /^(date|datetime-local|email|month|number|password|search|tel|text|time|url|week)$/u.test(focused.type)) ||
        focused instanceof HTMLTextAreaElement ||
        (focused instanceof HTMLElement && focused.isContentEditable)
      ) {
        const dialog = focused.closest<HTMLElement>('[role="dialog"]')
        if (dialog) dialog.focus({ preventScroll: true })
        else focused.blur()
      } else {
        const topModal = layers.map((layer) => layer.modal).lastIndexOf(true)
        const layer = topModal === -1 ? layers.at(-1) : layers[topModal]
        layer?.dismiss()
      }
    })
    if (layers.length) {
      // Reuse the existing entry even when Back brought no new user activation.
      traversalPending = true
      window.history.forward()
      return
    }
  }
  scheduleReconcile()
}

export function useMobileBack(open: boolean, dismiss: () => void, modal = false, includeDesktopWeb = false) {
  const dismissRef = useRef(dismiss)
  useLayoutEffect(() => { dismissRef.current = dismiss }, [dismiss])
  useLayoutEffect(() => {
    if (!open || window.sylunae || (!includeDesktopWeb && !isTouchWeb())) return
    const layer = { dismiss: () => dismissRef.current(), modal }
    layers.push(layer)
    if (!listening) {
      activeEntry = window.history.state?.[historyKey] === true
      window.addEventListener('popstate', onPopState)
      listening = true
    }
    scheduleReconcile()
    return () => {
      layers.splice(layers.indexOf(layer), 1)
      scheduleReconcile()
    }
  }, [includeDesktopWeb, modal, open])
}

export function useMobileModal({
  open,
  defaultOpen,
  onOpenChange,
  onMobileBack,
}: {
  open?: boolean
  defaultOpen?: boolean
  onOpenChange?: (open: boolean) => void
  onMobileBack?: () => void
}) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(defaultOpen ?? false)
  const changeOpen = (next: boolean) => {
    if (open === undefined) setUncontrolledOpen(next)
    onOpenChange?.(next)
  }
  const resolvedOpen = open ?? uncontrolledOpen
  useMobileBack(resolvedOpen, onMobileBack ?? (() => changeOpen(false)), true)
  return { open: resolvedOpen, onOpenChange: changeOpen }
}
