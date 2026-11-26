import { useSyncExternalStore } from 'react'

const PORTRAIT = '(orientation: portrait)'
const MOBILE_WEB = '(pointer: coarse), (max-width: 760px), (max-height: 540px) and (max-width: 1024px)'

function subscribe(onChange: () => void) {
  const queries = [window.matchMedia?.(PORTRAIT), window.matchMedia?.(MOBILE_WEB)]
  for (const query of queries) query?.addEventListener('change', onChange)
  return () => {
    for (const query of queries) query?.removeEventListener('change', onChange)
  }
}

function isPortrait() {
  return window.matchMedia?.(PORTRAIT).matches ?? window.innerHeight >= window.innerWidth
}

function isMobileWeb() {
  return !window.sylunae && (window.matchMedia?.(MOBILE_WEB).matches ?? false)
}

export function usePlaytestViewport() {
  const portrait = useSyncExternalStore(subscribe, isPortrait)
  const mobileWeb = useSyncExternalStore(subscribe, isMobileWeb)
  return { portrait, canChooseTrackMode: !portrait && !mobileWeb }
}
