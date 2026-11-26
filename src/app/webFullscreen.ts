export function requestFullscreenOnFirstClick() {
  if (window.sylunae || !document.fullscreenEnabled || window.matchMedia('(display-mode: fullscreen)').matches) return

  const root = document.documentElement
  if (typeof root.requestFullscreen !== 'function') return

  const onClick = (event: MouseEvent) => {
    if (!event.isTrusted || navigator.userActivation?.isActive === false) return

    window.removeEventListener('click', onClick)
    if (document.fullscreenElement) return
    void root.requestFullscreen({ navigationUI: 'hide' }).catch(() => undefined)
  }

  // Let app handlers use the gesture first, for example to open a file picker.
  window.addEventListener('click', onClick)
}
