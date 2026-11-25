import { useEffect, useLayoutEffect, useRef, useState, type ComponentPropsWithoutRef, type CSSProperties } from 'react'
import { readParticleAssets, type ParticleAtlas } from './particleLibrary'

const effectAssets = `${import.meta.env.BASE_URL}assets/particle`
export const defaultTapSprite = `${effectAssets}/claude/tap_hit_4k.png`
export const defaultHoldSprite = `${effectAssets}/claude/hold_loop_4k.png`
export const redSprite = `${effectAssets}/challenge_white.png`

interface LoadedAtlas {
  url: string
  backgroundSize: string
  duration: number
  frames: Keyframe[]
}

function prepareAtlas(atlas: ParticleAtlas, url: string): LoadedAtlas {
  const { columns, rows, frameDurations } = atlas
  const duration = frameDurations.reduce((sum, delay) => sum + delay, 0)
  let elapsed = 0
  const frames = frameDurations.map((delay, index) => {
    const column = index % columns, row = Math.floor(index / columns)
    const backgroundPosition = `${column * 100 / Math.max(1, columns - 1)}% ${row * 100 / Math.max(1, rows - 1)}%`
    const offset = elapsed / duration
    elapsed += delay
    return { backgroundPosition, offset, easing: 'step-end' }
  })
  frames.push({ ...frames[frames.length - 1], offset: 1 })
  return { url, backgroundSize: `${columns * 100}% ${rows * 100}%`, duration, frames }
}

export function useParticleAppearance(id?: string | null) {
  const [loaded, setLoaded] = useState<{ id: string; assets: { tap: LoadedAtlas; hold: LoadedAtlas } | null }>()
  useEffect(() => {
    if (!id) return
    let cancelled = false
    const urls: string[] = []
    const release = () => urls.splice(0).forEach((url) => URL.revokeObjectURL(url))
    const loadAtlas = async (atlas: ParticleAtlas) => {
      const url = URL.createObjectURL(atlas.image)
      urls.push(url)
      const image = new Image()
      image.src = url
      await image.decode()
      return prepareAtlas(atlas, url)
    }
    void readParticleAssets(id).then(async (assets) => {
      if (cancelled) return
      if (!assets) { setLoaded({ id, assets: null }); return }
      const [tap, hold] = await Promise.all([loadAtlas(assets.tap), loadAtlas(assets.hold)])
      if (!cancelled) setLoaded({ id, assets: { tap, hold } })
    }).catch(() => {
      release()
      if (!cancelled) setLoaded({ id, assets: null })
    })
    return () => { cancelled = true; release(); setLoaded(undefined) }
  }, [id])
  return loaded?.id === id ? loaded?.assets : undefined
}

interface ParticleSpriteProps extends ComponentPropsWithoutRef<'i'> {
  defaultSrc: string
  atlas?: LoadedAtlas
  loop?: boolean
  reduceMotion?: boolean
}

export function ParticleSprite({ defaultSrc, atlas, loop = false, reduceMotion, style, ...props }: ParticleSpriteProps) {
  const elementRef = useRef<HTMLElement>(null)
  useLayoutEffect(() => {
    const element = elementRef.current
    if (!element || !atlas || reduceMotion || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const animation = element.animate(atlas.frames, { duration: atlas.duration, iterations: loop ? Infinity : 1, fill: 'both' })
    return () => animation.cancel()
  }, [atlas, loop, reduceMotion])

  return <i {...props} ref={elementRef} aria-hidden="true" data-custom-particle={atlas ? '' : undefined} style={{
    ...style,
    backgroundImage: `url(${atlas?.url ?? defaultSrc})`,
    backgroundSize: atlas?.backgroundSize,
    '--playtest-sprite-duration': atlas && !loop ? `${atlas.duration}ms` : undefined,
  } as CSSProperties} />
}
