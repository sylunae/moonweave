// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { BackgroundVideoPreview } from '@/features/chart/BackgroundVideoPreview'

vi.mock('@/app/i18n', () => ({ useI18n: () => ({ text: (_zh: string, en: string) => en }) }))

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

it('plays muted video against the existing chart audio clock and realigns after a seek', () => {
  vi.stubGlobal('ResizeObserver', class {
    observe() {}
    unobserve() {}
    disconnect() {}
  })
  const audio = document.createElement('audio')
  let audioPaused = false
  Object.defineProperty(audio, 'paused', { get: () => audioPaused })
  Object.defineProperty(audio, 'readyState', { value: HTMLMediaElement.HAVE_FUTURE_DATA })
  const chartPlay = vi.spyOn(audio, 'play')
  const togglePlay = vi.fn()
  const props = {
    src: 'blob:background', audioRef: { current: audio }, hasAudio: true, currentTime: 0, duration: 30_000,
    startTime: 500, isPlaying: false, onTogglePlay: togglePlay, onSeek: vi.fn(), onClose: vi.fn(),
  }
  const { container, rerender, unmount } = render(<BackgroundVideoPreview {...props} />)
  const video = container.querySelector('video')!
  let videoPaused = true
  Object.defineProperty(video, 'paused', { get: () => videoPaused })
  Object.defineProperty(video, 'readyState', { value: HTMLMediaElement.HAVE_FUTURE_DATA })
  Object.defineProperty(video, 'duration', { value: 4 })
  const playVideo = vi.spyOn(video, 'play').mockImplementation(async () => { videoPaused = false })
  const pauseVideo = vi.spyOn(video, 'pause').mockImplementation(() => { videoPaused = true })

  expect(video.muted).toBe(true)
  expect(video.loop).toBe(true)
  expect(screen.getByText('Waiting for video to start')).toBeTruthy()
  fireEvent(video, new Event('loadedmetadata'))
  expect(playVideo).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Play' }))
  expect(togglePlay).toHaveBeenCalledOnce()
  expect(chartPlay).not.toHaveBeenCalled()

  act(() => {
    audio.currentTime = 5.5
    audio.playbackRate = 0.75
    audio.dispatchEvent(new Event('playing'))
  })
  rerender(<BackgroundVideoPreview {...props} isPlaying currentTime={5500} />)
  expect(video.currentTime).toBe(1)
  expect(video.playbackRate).toBe(0.75)
  expect(playVideo).toHaveBeenCalledOnce()
  expect(screen.queryByText('Waiting for video to start')).toBeNull()

  audio.currentTime = 5.55
  fireEvent(audio, new Event('seeked'))
  expect(video.currentTime).toBeCloseTo(1.05)
  audioPaused = true
  fireEvent(audio, new Event('pause'))
  expect(pauseVideo).toHaveBeenCalledOnce()

  audio.currentTime = 0
  rerender(<BackgroundVideoPreview {...props} startTime={-250} />)
  expect(video.currentTime).toBe(0.25)
  audioPaused = false
  fireEvent(audio, new Event('playing'))
  unmount()
  expect(pauseVideo).toHaveBeenCalledTimes(2)
})
