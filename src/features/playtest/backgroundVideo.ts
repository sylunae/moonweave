export function syncBackgroundVideoTime(
  video: HTMLVideoElement,
  chartTime: number,
  startTime: number,
  playbackRate: number,
  tolerance = 0.15,
) {
  if (video.readyState === 0) return
  const requestedTime = Math.max(0, chartTime - startTime) / 1000
  const targetTime = Number.isFinite(video.duration) && video.duration > 0 ? requestedTime % video.duration : requestedTime
  // Allow normal decoder drift without interrupting playback with repeated seeks.
  if (!video.seeking && Math.abs(video.currentTime - targetTime) > tolerance) video.currentTime = targetTime
  if (video.playbackRate !== playbackRate) video.playbackRate = playbackRate
}

export function canPlayBackgroundVideo(audio: Pick<HTMLMediaElement, 'paused' | 'ended' | 'seeking' | 'readyState'>, chartTime: number, startTime: number) {
  return !audio.paused && !audio.ended && !audio.seeking
    && audio.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA && chartTime >= startTime && !document.hidden
}
