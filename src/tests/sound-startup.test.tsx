// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { SoundProvider } from '@/app/sound'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

it('lets the first page render and respond while its interaction sound is still loading', () => {
  const play = vi.fn(() => new Promise<void>(() => {}))
  const Audio = vi.fn(function AudioStub() {
    return { currentTime: 0, volume: 1, play }
  })
  vi.stubGlobal('Audio', Audio)
  const onClick = vi.fn()

  render(<SoundProvider><button onClick={onClick}>Open library</button></SoundProvider>)
  const button = screen.getByRole('button', { name: 'Open library' })

  expect(Audio).not.toHaveBeenCalled()
  fireEvent.click(button)
  expect(onClick).toHaveBeenCalledOnce()
  expect(Audio).toHaveBeenCalledExactlyOnceWith(new URL('assets/sfx/press.wav', document.baseURI).href)
  expect(play).toHaveBeenCalledOnce()
})
