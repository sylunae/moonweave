import { useEffect, useLayoutEffect, useRef, useState, type ComponentPropsWithoutRef, type CSSProperties } from 'react'
import { readParticleAssets, type ParticleAtlas } from './particleLibrary'

const effectAssets = `${import.meta.env.BASE_URL}assets/particle`
export const defaultTapSprite = `${effectAssets}/claude/tap_hit_4k.png`
export const compactTapSprite = `${effectAssets}/claude/tap_hit_2048.png`
export const mobileTapSprite = `${effectAssets}/claude/tap_hit_1536.png`
export const defaultHoldSprite = `${effectAssets}/claude/hold_loop_4k.png`
export const mobileHoldSprite = `${effectAssets}/claude/hold_loop_1536.png`
export const redSprite = `${effectAssets}/challenge_white.png`

interface LoadedAtlas {
  url: string
  backgroundSize: string
  duration: number
  frames: Keyframe[]
  translatedFrames: Keyframe[]
}

function prepareFrames(columns: number, rows: number, frameDurations: number[]) {
  const duration = frameDurations.reduce((sum, delay) => sum + delay, 0)
  const frames: Keyframe[] = []
  const translatedFrames: Keyframe[] = []
  let elapsed = 0
  frameDurations.forEach((delay, index) => {
    const column = index % columns, row = Math.floor(index / columns)
    const backgroundPosition = `${column * 100 / Math.max(1, columns - 1)}% ${row * 100 / Math.max(1, rows - 1)}%`
    const offset = elapsed / duration
    elapsed += delay
    frames.push({ backgroundPosition, offset, easing: 'step-end' })
    translatedFrames.push({
      transform: `translate3d(${-column * 100 / columns}%, ${-row * 100 / rows}%, 0)`,
      offset,
      easing: 'step-end',
    })
  })
  frames.push({ ...frames[frames.length - 1], offset: 1 })
  translatedFrames.push({ ...translatedFrames[translatedFrames.length - 1], offset: 1 })
  return { backgroundSize: `${columns * 100}% ${rows * 100}%`, duration, frames, translatedFrames }
}

const defaultFrames = prepareFrames(4, 4, Array<number>(16).fill(25))

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
      return { url, ...prepareFrames(atlas.columns, atlas.rows, atlas.frameDurations) }
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
  playbackId?: number | null
  transformFrames?: boolean
}

export function ParticleSprite({ defaultSrc, atlas, loop = false, reduceMotion, playbackId, transformFrames = false, style, ...props }: ParticleSpriteProps) {
  const elementRef = useRef<HTMLElement>(null)
  const imageRef = useRef<HTMLImageElement>(null)
  const animationRef = useRef<Animation | null>(null)
  const pooled = playbackId !== undefined
  useLayoutEffect(() => {
    const element = transformFrames ? imageRef.current : elementRef.current
    const sequence = atlas ?? (transformFrames ? defaultFrames : undefined)
    if (!element?.animate || !sequence || reduceMotion || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const frames = transformFrames ? sequence.translatedFrames : sequence.frames
    const hideAfterTap = pooled && !loop
    const keyframes = hideAfterTap
      ? frames.map((frame, index) => ({ ...frame, opacity: index === frames.length - 1 ? 0 : 1 }))
      : frames
    const root = elementRef.current
    if (hideAfterTap) root?.setAttribute('data-atlas-fade', '')
    const animation = element.animate(keyframes, { duration: sequence.duration, iterations: loop ? Infinity : 1, fill: 'both' })
    animationRef.current = animation
    if (pooled) animation.pause()
    return () => {
      animation.cancel()
      animationRef.current = null
      if (hideAfterTap) root?.removeAttribute('data-atlas-fade')
    }
  }, [atlas, loop, pooled, reduceMotion, transformFrames])

  useLayoutEffect(() => {
    if (!pooled) return
    const animation = animationRef.current
    if (playbackId == null) {
      animation?.pause()
      return
    }
    if (animation) {
      animation.currentTime = 0
      animation.play()
    }
  }, [playbackId, pooled, atlas, reduceMotion, loop, transformFrames])

  const src = atlas?.url ?? defaultSrc
  if (transformFrames) {
    const [width, height] = (atlas ?? defaultFrames).backgroundSize.split(' ')
    return <i {...props} ref={elementRef} aria-hidden="true" data-custom-particle={atlas ? '' : undefined} style={{
      ...style,
      '--playtest-sprite-duration': atlas && !loop ? `${atlas.duration}ms` : undefined,
    } as CSSProperties}>
      <span className="particle-atlas-clip">
        <img ref={imageRef} src={src} alt="" draggable={false} style={{ width, height }} />
      </span>
    </i>
  }
  return <i {...props} ref={elementRef} aria-hidden="true" data-custom-particle={atlas ? '' : undefined} style={{
    ...style,
    backgroundImage: `url(${src})`,
    backgroundSize: atlas?.backgroundSize,
    '--playtest-sprite-duration': atlas && !loop ? `${atlas.duration}ms` : undefined,
  } as CSSProperties} />
}
