import { useEffect, useRef, useState } from 'react'

const sampleSize = 48
const cacheLimit = 64
type ColorBucket = { weight: number; red: number; green: number; blue: number }

export function dominantCoverColor(pixels: Uint8ClampedArray) {
  const buckets = new Map<number, ColorBucket>()
  for (let i = 0; i < pixels.length; i += 4) {
    const red = pixels[i]
    const green = pixels[i + 1]
    const blue = pixels[i + 2]
    const alpha = pixels[i + 3]
    if (alpha < 128) continue
    // Group nearby shades so the most common color can include gradients and image noise.
    const key = (red >> 5) * 64 + (green >> 5) * 8 + (blue >> 5)
    const weight = alpha / 255
    const bucket = buckets.get(key) ?? { weight: 0, red: 0, green: 0, blue: 0 }
    bucket.weight += weight
    bucket.red += red * weight
    bucket.green += green * weight
    bucket.blue += blue * weight
    buckets.set(key, bucket)
  }

  let dominant: ColorBucket | undefined
  for (const bucket of buckets.values()) {
    if (!dominant || bucket.weight > dominant.weight) dominant = bucket
  }
  if (!dominant) return null
  const { red, green, blue, weight } = dominant
  return `rgb(${Math.round(red / weight)} ${Math.round(green / weight)} ${Math.round(blue / weight)})`
}

function sampleCover(image: HTMLImageElement) {
  if (!image.naturalWidth || !image.naturalHeight) return null
  const canvas = document.createElement('canvas')
  const scale = Math.min(1, sampleSize / Math.max(image.naturalWidth, image.naturalHeight))
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale))
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale))
  const context = canvas.getContext('2d')
  if (!context) return null
  context.drawImage(image, 0, 0, canvas.width, canvas.height)
  return dominantCoverColor(context.getImageData(0, 0, canvas.width, canvas.height).data)
}

export function useCoverColor(coverUrl?: string) {
  const [color, setColor] = useState<string | null>(null)
  const cache = useRef(new Map<string, string | null>())

  useEffect(() => {
    if (!coverUrl) {
      setColor(null)
      return
    }
    const cached = cache.current.get(coverUrl)
    if (cached !== undefined) {
      setColor(cached)
      return
    }

    const image = new Image()
    image.crossOrigin = 'anonymous'
    image.onload = () => {
      let result: string | null = null
      try {
        result = sampleCover(image)
        if (cache.current.size >= cacheLimit) {
          const oldest = cache.current.keys().next().value
          if (oldest !== undefined) cache.current.delete(oldest)
        }
        cache.current.set(coverUrl, result)
      } catch {
        // Some images cannot be read back from a canvas.
      }
      setColor(result)
    }
    image.onerror = () => setColor(null)
    image.src = coverUrl
    return () => {
      image.onload = image.onerror = null
      image.removeAttribute('src')
    }
  }, [coverUrl])

  return coverUrl ? color ?? undefined : undefined
}
