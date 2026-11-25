export function youtubeVideoId(input: unknown): string | null {
  if (typeof input !== 'string' || input.length > 4096) return null
  try {
    const url = new URL(input.trim())
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.port) return null
    const [, route, videoId] = url.pathname.split('/')
    const id = url.hostname === 'youtu.be' ? route
      : ['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com'].includes(url.hostname)
        ? route === 'watch' ? url.searchParams.get('v') : ['shorts', 'live', 'embed'].includes(route) ? videoId : null
        : null
    return id && /^[\w-]{11}$/.test(id) ? id : null
  } catch {
    return null
  }
}
